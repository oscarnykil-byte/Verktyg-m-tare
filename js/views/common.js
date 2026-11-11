// Delar som används av både objektvyn och rumsvyn.
import { putVisit } from '../db.js';
import { renderField } from '../fields.js';
import { bySection, formatValue, isEmpty, numericValue } from '../template.js';
import { debounce, h, openDialog, uid } from '../util.js';

/**
 * Sparar besöket en kort stund efter senaste ändringen och visar "Sparar …" / "Sparat" i sidhuvudet.
 * Anropa save() efter varje ändring, och await save.now() när något måste vara sparat direkt.
 */
export function autosaver(app, visit, afterSave) {
  const write = async () => {
    visit.updated = Date.now();
    await putVisit(visit);
    app.setSaved('saved');
    afterSave?.();
  };
  const later = debounce(write, 400);
  const save = () => { app.setSaved('saving'); later(); };
  save.flush = () => later.flush();
  save.now = async () => { await later.flush(); await write(); };
  app.onLeave = () => later.flush();
  return save;
}

/** Kort text för en sektions sammanfattning. Tomma svar och räknare på noll ger ''. */
function shortValue(f, v) {
  if (isEmpty(f, v) || (f.type === 'counter' && !v)) return '';
  if (f.type === 'group') {
    const num = f.subfields.find((s) => s.type === 'counter' || s.type === 'number');
    return String(num ? v.reduce((sum, row) => sum + (numericValue(num, row[num.id]) || 0), 0) : v.length);
  }
  if (f.type === 'note') return 'ifyllt';
  return formatValue(f, v);
}

/** Hopfällbart kort. open är mängden utfällda kort, så att valet överlever en omritning. */
export function fold(title, summary, body, open) {
  const el = h('details', { class: 'card fold', open: open.has(title) },
    h('summary', {}, h('span', { class: 'fold-title' }, title), summary),
    h('div', { class: 'fold-body' }, body));
  el.addEventListener('toggle', () => { if (el.open) open.add(title); else open.delete(title); });
  return el;
}

/**
 * Frågorna som kort, grupperade under mallens rubriker.
 * Sektioner utan obligatoriska frågor är hopfällda och visar en sammanfattning av det som är ifyllt.
 * @param changed anropas med frågan som ändrades
 * @param open    mängd med namnen på utfällda sektioner
 * @param recent  ger för en fråga dess mest använda alternativ, vanligast först
 */
export function fieldCards(fields, values, changed, { open = new Set(), recent = null } = {}) {
  return bySection(fields).map(([section, list]) => {
    let update = () => {};
    const body = list.map((f) => renderField(f, values[f.id], (v) => { values[f.id] = v; update(); changed(f); },
      { recent: recent?.(f) }));
    if (!section || list.some((f) => f.required)) {
      return h('section', { class: 'card' }, section && h('h3', {}, section), body);
    }
    const summary = h('span', { class: 'fold-sum' });
    update = () => {
      summary.textContent = list.map((f) => { const t = shortValue(f, values[f.id]); return t && `${f.label} ${t}`; })
        .filter(Boolean).join(' · ');
    };
    update();
    return fold(section, summary, body, open);
  });
}

/**
 * Egna fält som säljaren lägger till på plats när mallen inte räcker.
 * @param owner besöket eller rummet, med customFields och values
 */
export function customFieldsCard(owner, changed, open = new Set()) {
  owner.customFields ||= [];
  const list = h('div', {});
  const count = h('span', { class: 'fold-sum' });
  const draw = () => {
    count.textContent = owner.customFields.length ? `${owner.customFields.length} st` : '';
    list.replaceChildren(...owner.customFields.map((f) =>
      h('div', { class: 'custom-field' },
        renderField(f, owner.values[f.id], (v) => { owner.values[f.id] = v; changed(); }),
        h('button', {
          type: 'button', class: 'icon-btn', 'aria-label': `Ta bort ${f.label}`,
          onclick: () => {
            if (!confirm(`Ta bort det egna fältet "${f.label}"?`)) return;
            owner.customFields = owner.customFields.filter((x) => x !== f);
            delete owner.values[f.id];
            draw();
            changed();
          },
        }, '✕'))));
  };
  draw();
  if (owner.customFields.length) open.add('Egna fält');
  return fold('Egna fält', count, [
    h('p', { class: 'muted' }, 'Lägg till en egen fråga när mallen inte räcker till.'),
    list,
    h('button', {
      type: 'button', class: 'btn small',
      onclick: async () => {
        const field = await customFieldDialog();
        if (!field) return;
        owner.customFields.push(field);
        draw();
        changed();
      },
    }, '+ Eget fält'),
  ], open);
}

function customFieldDialog() {
  const label = h('input', { type: 'text', required: true, placeholder: 't.ex. Antal whiteboards' });
  const type = h('select', {},
    h('option', { value: 'text' }, 'Text'),
    h('option', { value: 'number' }, 'Tal'),
    h('option', { value: 'yesno' }, 'Ja / Nej'));
  return openDialog({
    title: 'Eget fält',
    okLabel: 'Lägg till',
    body: [
      h('label', { class: 'field' }, h('div', { class: 'field-label' }, 'Fråga / rubrik'), label),
      h('label', { class: 'field' }, h('div', { class: 'field-label' }, 'Typ av svar'), type),
    ],
    onOk: () => {
      if (!label.value.trim()) throw new Error('Skriv en rubrik.');
      return { id: 'c_' + uid(), label: label.value.trim(), type: type.value, custom: true };
    },
  });
}

export function notesCard(owner, changed) {
  return h('section', { class: 'card' },
    h('h3', {}, 'Anteckningar'),
    h('textarea', {
      rows: 4, value: owner.notes || '', 'aria-label': 'Anteckningar',
      oninput: (e) => { owner.notes = e.target.value; changed(); },
    }));
}

/** De mest använda alternativen för en envalsfråga bland besökets rum, vanligast först. */
export function recentOptions(visit, f) {
  if (f.type !== 'choice') return null;
  const counts = new Map();
  for (const room of visit.rooms) {
    const v = room.values[f.id];
    if (v) counts.set(v, (counts.get(v) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([option]) => option);
}

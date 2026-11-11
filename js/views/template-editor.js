// Mallredigeraren: här ändras frågor, alternativ och objektstyper utan kod.
import {
  FIELD_TYPES, SUBFIELD_TYPES, getShippedTemplate, getTemplate, newerShippedAvailable, saveTemplate, validateTemplate,
} from '../template.js';
import { fileSafe, h, openDialog, pickTextFile, shareOrDownload, toast, uid } from '../util.js';

export async function templateView(app) {
  app.setHeader({ title: 'Mall och frågor', back: '#/' });
  const template = structuredClone(getTemplate());
  const origin = template.origin;
  delete template.origin;

  const status = h('p', { class: 'muted' });
  const drawStatus = (o) => {
    const names = { default: 'Standardmall', imported: 'Inläst mall', custom: 'Ändrad på den här enheten' };
    status.textContent = `${names[o] || ''} · senast ändrad ${new Date(getTemplate().updated).toLocaleString('sv-SE', { dateStyle: 'short', timeStyle: 'short' })}`;
  };
  drawStatus(origin);

  const changed = async () => {
    await saveTemplate(structuredClone(template), 'custom');
    drawStatus('custom');
  };

  const replaceWith = async (next, newOrigin, message) => {
    await saveTemplate(next, newOrigin);
    toast(message);
    app.reload();
  };

  app.show(
    h('section', { class: 'card' },
      h('label', { class: 'field' },
        h('div', { class: 'field-label' }, 'Mallens namn'),
        h('input', { type: 'text', value: template.name, onchange: (e) => { template.name = e.target.value.trim() || 'Mall'; changed(); } })),
      status,
      h('p', { class: 'muted' }, 'Ändringar gäller nya besök. Påbörjade besök behåller mallen de skapades med.')),

    newerShippedAvailable() && h('section', { class: 'card warn-card' },
      h('h3', {}, 'En nyare standardmall finns'),
      h('p', { class: 'muted' }, 'Du har egna ändringar på den här enheten, så standardmallen har inte uppdaterats automatiskt.'),
      h('button', {
        class: 'btn small',
        onclick: () => confirm('Ersätta dina ändringar med den nya standardmallen?') &&
          replaceWith(structuredClone(getShippedTemplate()), 'default', 'Standardmallen används nu.'),
      }, 'Använd nya standardmallen')),

    objectTypesCard(template, changed),
    fieldListCard('Frågor om objektet', 'Ställs en gång per besök.', template.objectFields, 'object', template, changed),
    fieldListCard('Frågor per rum', 'Ställs för varje rum som läggs till.', template.roomFields, 'room', template, changed),

    h('section', { class: 'card' },
      h('h3', {}, 'Dela mallen'),
      h('p', { class: 'muted' }, 'Exportera mallen och skicka filen till säljarna. De läser in den här på sin enhet.'),
      h('div', { class: 'row' },
        h('button', {
          class: 'btn',
          onclick: () => {
            const { origin: _o, ...clean } = getTemplate();
            shareOrDownload(new Blob([JSON.stringify(clean, null, 2)], { type: 'application/json' }),
              `Mall_${fileSafe(clean.name)}.json`);
          },
        }, 'Exportera mall'),
        h('button', {
          class: 'btn',
          onclick: async () => {
            const text = await pickTextFile('.json,application/json');
            if (!text) return;
            try {
              const next = validateTemplate(JSON.parse(text));
              if (confirm(`Ersätta nuvarande mall med "${next.name}"?`)) replaceWith(next, 'imported', 'Mallen är inläst.');
            } catch (e) {
              toast(e instanceof SyntaxError ? 'Filen går inte att läsa.' : e.message);
            }
          },
        }, 'Läs in mall')),
      getShippedTemplate() && h('button', {
        class: 'btn danger',
        onclick: () => confirm('Återställa till standardmallen? Dina ändringar i mallen försvinner.') &&
          replaceWith(structuredClone(getShippedTemplate()), 'default', 'Standardmallen är återställd.'),
      }, 'Återställ standardmallen')));
}

// ---------- Objektstyper ----------

function objectTypesCard(template, changed) {
  const list = h('div', {});
  const draw = () => list.replaceChildren(...template.objectTypes.map((o, i) =>
    h('div', { class: 'edit-row' },
      h('input', {
        type: 'text', value: o.label, 'aria-label': 'Objektstyp',
        onchange: (e) => { o.label = e.target.value.trim() || o.label; e.target.value = o.label; changed(); },
      }),
      h('button', {
        type: 'button', class: 'icon-btn', 'aria-label': `Ta bort ${o.label}`,
        onclick: () => {
          if (template.objectTypes.length === 1) return toast('Minst en objektstyp måste finnas.');
          if (!confirm(`Ta bort objektstypen "${o.label}"?`)) return;
          template.objectTypes.splice(i, 1);
          for (const f of [...template.objectFields, ...template.roomFields]) {
            if (f.objectTypes) f.objectTypes = f.objectTypes.filter((id) => id !== o.id);
          }
          draw();
          changed();
        },
      }, '✕'))));
  draw();
  return h('section', { class: 'card' },
    h('h3', {}, 'Objektstyper'),
    h('p', { class: 'muted' }, 'Väljs när ett besök skapas och styr vilka frågor som visas.'),
    list,
    h('button', {
      type: 'button', class: 'btn small',
      onclick: () => { template.objectTypes.push({ id: 'o_' + uid(), label: 'Ny objektstyp' }); draw(); changed(); },
    }, '+ Objektstyp'));
}

// ---------- Frågelistor ----------

function describe(f, template) {
  const parts = [FIELD_TYPES[f.type]];
  if (f.section) parts.unshift(f.section);
  if (f.required) parts.push('obligatorisk');
  if (f.objectTypes?.length) {
    parts.push('bara ' + f.objectTypes.map((id) => template.objectTypes.find((o) => o.id === id)?.label).filter(Boolean).join(', '));
  }
  return parts.join(' · ');
}

function fieldListCard(title, hint, fields, scope, template, changed) {
  const list = h('div', {});
  const move = (i, d) => {
    const j = i + d;
    if (j < 0 || j >= fields.length) return;
    [fields[i], fields[j]] = [fields[j], fields[i]];
    draw();
    changed();
  };
  const draw = () => list.replaceChildren(...fields.map((f, i) =>
    h('div', { class: 'q-row' },
      h('button', {
        type: 'button', class: 'q-main',
        onclick: async () => {
          const next = await fieldDialog(f, scope, template);
          if (!next) return;
          fields[i] = next;
          draw();
          changed();
        },
      },
        h('div', { class: 'q-label' }, f.label),
        h('div', { class: 'muted' }, describe(f, template))),
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Flytta upp', disabled: i === 0, onclick: () => move(i, -1) }, '↑'),
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Flytta ned', disabled: i === fields.length - 1, onclick: () => move(i, 1) }, '↓'),
      // Frågor som summeringen bygger på (lokaltyp, yta, golvtyp) kan inte tas bort.
      h('button', {
        type: 'button', class: 'icon-btn', 'aria-label': `Ta bort ${f.label}`, disabled: !!f.role,
        title: f.role ? 'Används i summeringen och kan inte tas bort' : '',
        onclick: () => {
          if (!confirm(`Ta bort frågan "${f.label}"?`)) return;
          fields.splice(i, 1);
          draw();
          changed();
        },
      }, '✕'))));
  draw();
  return h('section', { class: 'card' },
    h('h3', {}, title),
    h('p', { class: 'muted' }, hint + ' Tryck på en fråga för att ändra den.'),
    list,
    h('button', {
      type: 'button', class: 'btn small',
      onclick: async () => {
        const next = await fieldDialog(null, scope, template);
        if (!next) return;
        fields.push(next);
        draw();
        changed();
      },
    }, '+ Ny fråga'));
}

// ---------- Dialog för en fråga ----------

/** scope: 'object', 'room' eller 'sub' (delfält i upprepande rader). */
function fieldDialog(original, scope, template) {
  const f = original ? structuredClone(original) : { id: 'f_' + uid(), label: '', type: 'text' };
  const types = scope === 'sub' ? SUBFIELD_TYPES : Object.keys(FIELD_TYPES).filter((t) => scope === 'room' || t !== 'area');

  const label = h('input', { type: 'text', value: f.label, required: true });
  const type = h('select', { disabled: !!f.role, onchange: () => { f.type = type.value; drawExtra(); } },
    types.map((t) => h('option', { value: t, selected: t === f.type }, FIELD_TYPES[t])));
  const section = h('input', { type: 'text', value: f.section || '', placeholder: 't.ex. Sanitet' });
  const help = h('input', { type: 'text', value: f.help || '' });
  const unit = h('input', { type: 'text', value: f.unit || '', placeholder: 't.ex. m, st, m²' });
  const options = h('textarea', { rows: 6, value: (f.options || []).join('\n') });
  const check = (key, text) => h('label', { class: 'check' },
    h('input', { type: 'checkbox', checked: !!f[key], onchange: (e) => { f[key] = e.target.checked; } }), text);
  const row = (text, control, hint) => h('label', { class: 'field' },
    h('div', { class: 'field-label' }, text), hint && h('div', { class: 'field-help' }, hint), control);

  const subList = h('div', {});
  const drawSubs = () => {
    f.subfields ||= [];
    subList.replaceChildren(...f.subfields.map((s, i) =>
      h('div', { class: 'q-row' },
        h('button', {
          type: 'button', class: 'q-main',
          onclick: async () => {
            const next = await fieldDialog(s, 'sub', template);
            if (next) { f.subfields[i] = next; drawSubs(); }
          },
        }, h('div', { class: 'q-label' }, s.label), h('div', { class: 'muted' }, FIELD_TYPES[s.type])),
        h('button', {
          type: 'button', class: 'icon-btn', 'aria-label': `Ta bort ${s.label}`,
          onclick: () => { f.subfields.splice(i, 1); drawSubs(); },
        }, '✕'))),
      h('button', {
        type: 'button', class: 'btn small',
        onclick: async () => {
          const next = await fieldDialog(null, 'sub', template);
          if (next) { f.subfields.push(next); drawSubs(); }
        },
      }, '+ Delfält'));
  };

  const extra = h('div', {});
  const drawExtra = () => {
    const t = f.type;
    extra.replaceChildren(...[
      t === 'number' && row('Enhet', unit),
      (t === 'choice' || t === 'multi') && row('Alternativ', options, 'Ett alternativ per rad.'),
      t === 'group' && h('div', { class: 'field' },
        h('div', { class: 'field-label' }, 'Delfält'),
        h('div', { class: 'field-help' }, 'Frågorna som besvaras för varje rad.'),
        subList),
      scope === 'room' && (t === 'number' || t === 'counter') && check('sum', 'Summera för hela objektet i summeringen'),
      scope === 'room' && t === 'choice' && check('breakdown', 'Visa yta per alternativ i summeringen'),
    ].filter(Boolean));
    if (t === 'group') drawSubs();
  };
  drawExtra();

  const typeChecks = scope !== 'sub' && h('div', { class: 'field' },
    h('div', { class: 'field-label' }, 'Gäller objektstyper'),
    h('div', { class: 'field-help' }, 'Inget ikryssat betyder att frågan alltid visas.'),
    template.objectTypes.map((o) => h('label', { class: 'check' },
      h('input', {
        type: 'checkbox', checked: !!f.objectTypes?.includes(o.id),
        onchange: (e) => {
          const set = new Set(f.objectTypes || []);
          if (e.target.checked) set.add(o.id); else set.delete(o.id);
          f.objectTypes = [...set];
        },
      }), o.label)));

  return openDialog({
    title: original ? 'Ändra fråga' : 'Ny fråga',
    okLabel: 'Klar',
    body: [
      row('Fråga / rubrik', label),
      row('Typ av svar', type, f.role && 'Typen är låst eftersom frågan används i summeringen.'),
      extra,
      scope !== 'sub' && check('required', 'Obligatorisk'),
      scope !== 'sub' && row('Rubrik att visas under', section, 'Frågor med samma rubrik visas tillsammans.'),
      scope !== 'sub' && row('Hjälptext', help),
      typeChecks,
    ],
    onOk: () => {
      const out = { id: f.id, label: label.value.trim(), type: f.type };
      if (!out.label) throw new Error('Skriv en rubrik för frågan.');
      if (f.role) out.role = f.role;
      if (scope !== 'sub') {
        if (f.required) out.required = true;
        if (section.value.trim()) out.section = section.value.trim();
        if (help.value.trim()) out.help = help.value.trim();
        if (f.objectTypes?.length) out.objectTypes = f.objectTypes;
      }
      if (out.type === 'number' && unit.value.trim()) out.unit = unit.value.trim();
      if (out.type === 'choice' || out.type === 'multi') {
        out.options = [...new Set(options.value.split('\n').map((s) => s.trim()).filter(Boolean))];
        if (!out.options.length) throw new Error('Lägg till minst ett alternativ.');
      }
      if (out.type === 'group') {
        if (!f.subfields?.length) throw new Error('Lägg till minst ett delfält.');
        out.subfields = f.subfields;
      }
      if (scope === 'room' && (out.type === 'number' || out.type === 'counter') && f.sum) out.sum = true;
      if (scope === 'room' && out.type === 'choice' && f.breakdown) out.breakdown = true;
      return out;
    },
  });
}

// Formuläret för ett rum.
import { deletePhoto, getVisit, photosForVisit, putVisit } from '../db.js';
import { photoSection } from '../photos.js';
import { renderField } from '../fields.js';
import { describeParsed, parseRoomText } from '../quick.js';
import { applyTypeDefaults, byRole, createRoom, fieldsFor, roomTemplateFields, roomTitle } from '../template.js';
import { debounce, h, uid } from '../util.js';
import { customFieldsCard, fieldCards, notesCard } from './common.js';

export async function roomView(app, { id, roomId }) {
  const visit = await getVisit(id);
  const room = visit?.rooms.find((r) => r.id === roomId);
  if (!room) return app.go(visit ? `#/visit/${id}/rum` : '#/');
  const photos = await photosForVisit(id);
  const index = visit.rooms.indexOf(room);
  const roomsHref = `#/visit/${id}/rum`;

  const title = () => `${index + 1}. ${roomTitle(visit, room, index)}`;
  const save = debounce(async () => {
    visit.updated = Date.now();
    await putVisit(visit);
    app.setTitle(title());
  }, 400);
  app.onLeave = () => save.flush();
  app.setHeader({ title: title(), back: roomsHref });

  const newRoom = async () => {
    await save.flush();
    const next = createRoom(uid(), visit.template, room);
    visit.rooms.push(next);
    visit.updated = Date.now();
    await putVisit(visit);
    app.go(`#/visit/${id}/room/${next.id}`);
  };

  // Frågorna ritas om när lokaltypen ändras, eftersom den styr både vilka frågor som visas och förvalen.
  const questions = h('div', { class: 'stack' });
  const drawQuestions = () => questions.replaceChildren(
    ...fieldCards(roomTemplateFields(visit, room), room.values, fieldChanged));
  const fieldChanged = (f) => {
    if (room.auto) delete room.auto[f.id]; // säljarens eget svar ska inte skrivas över av förval
    if (f.role === 'roomType') {
      applyTypeDefaults(visit.template, room);
      drawQuestions();
    }
    save();
  };
  drawQuestions();

  // Delar som snabbinmatningen kan ändra ritas i egna behållare så att de går att rita om.
  const countBox = h('div', {});
  const drawCount = () => countBox.replaceChildren(renderField({
    id: '_count', label: 'Antal likadana rum', type: 'counter', min: 1,
    help: 'Fyll i rummet en gång. Ytor och antal räknas gånger så här många.',
  }, room.count || 1, (n) => { room.count = n; save(); }));
  const notesBox = h('div', {});
  const drawNotes = () => notesBox.replaceChildren(notesCard(room, save));
  const redraw = () => { drawCount(); drawQuestions(); drawNotes(); };
  drawCount();
  drawNotes();

  app.show(
    quickCard(visit, room, () => { redraw(); save(); }),
    h('section', { class: 'card' },
      h('label', { class: 'field' },
        h('div', { class: 'field-label' }, 'Benämning'),
        h('div', { class: 'field-help' }, 'T.ex. rumsnummer eller namn. Lämnas den tom används lokaltypen.'),
        h('input', {
          type: 'text', value: room.name || '',
          oninput: (e) => { room.name = e.target.value; save(); },
        })),
      countBox),
    questions,
    customFieldsCard(room, save),
    notesBox,
    photoSection(id, room.id, photos),
    h('div', { class: 'row' },
      h('a', { class: 'btn primary', href: roomsHref }, 'Klar'),
      h('button', { class: 'btn', onclick: newRoom }, 'Spara och nytt rum')),
    h('button', {
      class: 'btn danger',
      onclick: async () => {
        if (!confirm('Ta bort rummet och dess foton?')) return;
        save.flush();
        for (const p of photos.filter((x) => x.roomId === room.id)) await deletePhoto(p.id);
        visit.rooms.splice(index, 1);
        visit.updated = Date.now();
        await putVisit(visit);
        app.onLeave = null;
        app.go(roomsHref);
      },
    }, 'Ta bort rummet'));
}

/**
 * Snabbinmatning: säljaren dikterar eller skriver en rad och fälten fylls i.
 * @param changed anropas när rummet har ändrats och ska ritas om och sparas
 */
function quickCard(visit, room, changed) {
  const template = visit.template;
  const input = h('textarea', {
    rows: 2, 'aria-label': 'Snabbinmatning',
    placeholder: 't.ex. WC, fyra kvadrat, klinker, två toaletter',
  });
  const result = h('div', { class: 'quick-result' });
  let before = null; // rummet före senaste ifyllningen, för Ångra

  const restore = () => {
    Object.assign(room, structuredClone(before));
    before = null;
    result.replaceChildren();
    changed();
  };

  const fill = () => {
    const text = input.value.trim();
    if (!text) return;
    const all = fieldsFor(template.roomFields, visit.objectTypeId);
    const parsed = parseRoomText(text, all);
    before = structuredClone({ values: room.values, auto: room.auto || {}, count: room.count || 1, notes: room.notes || '' });
    room.auto ||= {};

    // Lokaltypen först: den avgör förvalen och vilka frågor som gäller för rummet.
    const typeField = byRole(template, 'roomType');
    if (typeField && typeField.id in parsed.values) {
      room.values[typeField.id] = parsed.values[typeField.id];
      applyTypeDefaults(template, room);
    }
    const shown = new Set(roomTemplateFields(visit, room).map((f) => f.id));
    const hidden = [];
    for (const f of all) {
      const has = f.id in parsed.values || f.id in parsed.rows;
      if (!has) continue;
      if (!shown.has(f.id)) {
        hidden.push(f.label);
        delete parsed.values[f.id];
        delete parsed.rows[f.id];
      } else if (f.id in parsed.rows) {
        room.values[f.id] = [...(room.values[f.id] || []), ...parsed.rows[f.id]];
      } else {
        room.values[f.id] = parsed.values[f.id];
        delete room.auto[f.id]; // det säljaren sa går före förval
      }
    }
    if (parsed.count) room.count = parsed.count;

    const understood = describeParsed(parsed, all);
    const typeName = (typeField && room.values[typeField.id]) || 'rummet';
    result.replaceChildren(
      understood.length
        ? h('p', { class: 'quick-ok' }, 'Ifyllt: ' + understood.join(' · '))
        : h('p', { class: 'quick-miss' }, 'Inget gick att tolka. Prova en uppräkning, t.ex. "kontor, 12 kvadrat, linoleum".'),
      hidden.length > 0 && h('p', { class: 'quick-miss' },
        `Fylldes inte i eftersom frågan inte gäller ${typeName}: ${hidden.join(', ')}`),
      parsed.rest && h('p', { class: 'quick-miss' }, `Tolkades inte: ${parsed.rest}`),
      h('div', { class: 'row' },
        parsed.rest && h('button', {
          type: 'button', class: 'btn small',
          onclick: (e) => {
            room.notes = [room.notes, parsed.rest].filter(Boolean).join('\n');
            e.target.remove();
            changed();
          },
        }, 'Lägg i anteckningar'),
        h('button', { type: 'button', class: 'btn small', onclick: restore }, 'Ångra')));
    input.value = '';
    changed();
  };

  return h('section', { class: 'card' },
    h('h3', {}, 'Snabbinmatning'),
    h('p', { class: 'muted' }, 'Räkna upp det du ser, så fylls fälten i. Tryck på mikrofonen på tangentbordet för att diktera.'),
    input,
    h('button', { type: 'button', class: 'btn small', onclick: fill }, 'Fyll i'),
    result);
}

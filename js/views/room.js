// Formuläret för ett rum.
import { deletePhoto, getVisit, photosForVisit } from '../db.js';
import { renderField } from '../fields.js';
import { addPhotos, cameraInput, photoSection } from '../photos.js';
import { applyQuickText } from '../quick.js';
import { applyTypeDefaults, createRoom, roomTemplateFields, roomTitle } from '../template.js';
import { append, h, uid } from '../util.js';
import { autosaver, customFieldsCard, fieldCards, notesCard, recentOptions } from './common.js';

export async function roomView(app, { id, roomId }) {
  const visit = await getVisit(id);
  const room = visit?.rooms.find((r) => r.id === roomId);
  if (!room) return app.go(visit ? `#/visit/${id}/rum` : '#/');
  const photos = await photosForVisit(id);
  const index = visit.rooms.indexOf(room);
  const roomsHref = `#/visit/${id}/rum`;

  const title = () => `${index + 1}. ${roomTitle(visit, room, index)}`;
  app.setHeader({ title: title(), back: roomsHref });
  const save = autosaver(app, visit, () => app.setTitle(title()));

  const newRoom = async () => {
    visit.rooms.push(createRoom(uid(), visit.template, room));
    await save.now();
    app.go(`#/visit/${id}/room/${visit.rooms.at(-1).id}`);
  };

  // Frågorna ritas om när lokaltypen ändras, eftersom den styr både vilka frågor som visas och förvalen.
  const open = new Set(); // utfällda sektioner
  const questions = h('div', { class: 'stack' });
  const drawQuestions = () => questions.replaceChildren(
    ...fieldCards(roomTemplateFields(visit, room), room.values, fieldChanged,
      { open, recent: (f) => recentOptions(visit, f) }));
  const fieldChanged = (f) => {
    if (room.auto) delete room.auto[f.id]; // säljarens eget svar ska inte skrivas över av förval
    if (f.role === 'roomType') {
      applyTypeDefaults(visit.template, room);
      drawQuestions();
    }
    save();
  };

  // Delar som snabbinmatningen eller kameraknappen kan ändra ritas i egna behållare.
  const countBox = h('div', {});
  const drawCount = () => countBox.replaceChildren(renderField({
    id: '_count', label: 'Antal likadana rum', type: 'counter', min: 1,
    help: 'Fyll i rummet en gång. Ytor och antal räknas gånger så här många.',
  }, room.count || 1, (n) => { room.count = n; save(); }));
  const notesBox = h('div', {});
  const drawNotes = () => notesBox.replaceChildren(notesCard(room, save));
  const photoBox = h('div', {});
  const drawPhotos = () => photoBox.replaceChildren(photoSection(id, room.id, photos));
  const redraw = () => { drawCount(); drawQuestions(); drawNotes(); };
  redraw();
  drawPhotos();

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
    customFieldsCard(room, save, open),
    notesBox,
    photoBox,
    h('button', {
      class: 'btn danger',
      onclick: async () => {
        if (!confirm('Ta bort rummet och dess foton?')) return;
        for (const p of photos.filter((x) => x.roomId === room.id)) await deletePhoto(p.id);
        visit.rooms.splice(index, 1);
        await save.now();
        app.go(roomsHref);
      },
    }, 'Ta bort rummet'));

  // Fast rad längst ned: det man oftast gör härnäst ska aldrig kräva scrollning.
  const camera = cameraInput(async (files) => {
    await addPhotos(files, id, room.id, photos);
    drawPhotos();
  });
  app.setActions([
    camera,
    h('button', { class: 'btn', onclick: () => camera.click() }, 'Foto'),
    h('button', { class: 'btn', onclick: newRoom }, 'Nytt rum'),
    h('a', { class: 'btn primary', href: roomsHref }, 'Klar'),
  ]);
}

/**
 * Snabbinmatning: säljaren dikterar eller skriver en rad och fälten fylls i.
 * @param changed anropas när rummet har ändrats och ska ritas om och sparas
 */
function quickCard(visit, room, changed) {
  const input = h('textarea', {
    rows: 2, 'aria-label': 'Snabbinmatning',
    placeholder: 't.ex. WC, fyra kvadrat, klinker, två toaletter',
  });
  const result = h('div', { class: 'quick-result' });

  const fill = () => {
    const text = input.value.trim();
    if (!text) return;
    const before = structuredClone({ values: room.values, auto: room.auto || {}, count: room.count || 1, notes: room.notes || '' });
    const r = applyQuickText(visit, room, text);
    result.replaceChildren();
    append(result, [
      quickReceipt(r),
      h('div', { class: 'row' },
        r.rest && h('button', {
          type: 'button', class: 'btn small',
          onclick: (e) => {
            room.notes = [room.notes, r.rest].filter(Boolean).join('\n');
            e.target.remove();
            changed();
          },
        }, 'Lägg i anteckningar'),
        h('button', {
          type: 'button', class: 'btn small',
          onclick: () => { Object.assign(room, before); result.replaceChildren(); changed(); },
        }, 'Ångra')),
    ]);
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

/** Kvitto på vad snabbinmatningen gjorde. restNote beskriver vad som hände med det otolkade. */
export function quickReceipt(r, restNote = 'Tolkades inte') {
  return [
    r.understood.length
      ? h('p', { class: 'quick-ok' }, 'Ifyllt: ' + r.understood.join(' · '))
      : h('p', { class: 'quick-miss' }, 'Inget gick att tolka. Prova en uppräkning, t.ex. "kontor, 12 kvadrat, linoleum".'),
    r.hidden.length > 0 && h('p', { class: 'quick-miss' },
      `Fylldes inte i eftersom frågan inte gäller ${r.typeName}: ${r.hidden.join(', ')}`),
    r.rest && h('p', { class: 'quick-miss' }, `${restNote}: ${r.rest}`),
  ];
}

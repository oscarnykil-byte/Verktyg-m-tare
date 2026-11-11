// Formuläret för ett rum.
import { deletePhoto, getVisit, photosForVisit, putVisit } from '../db.js';
import { photoSection } from '../photos.js';
import { fieldsFor, roomTitle } from '../template.js';
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
    const next = { id: uid(), name: '', values: {}, customFields: [], notes: '' };
    visit.rooms.push(next);
    visit.updated = Date.now();
    await putVisit(visit);
    app.go(`#/visit/${id}/room/${next.id}`);
  };

  app.show(
    h('section', { class: 'card' },
      h('label', { class: 'field' },
        h('div', { class: 'field-label' }, 'Benämning'),
        h('div', { class: 'field-help' }, 'T.ex. rumsnummer eller namn. Lämnas den tom används lokaltypen.'),
        h('input', {
          type: 'text', value: room.name || '',
          oninput: (e) => { room.name = e.target.value; save(); },
        }))),
    fieldCards(fieldsFor(visit.template.roomFields, visit.objectTypeId), room.values, save),
    customFieldsCard(room, save),
    notesCard(room, save),
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

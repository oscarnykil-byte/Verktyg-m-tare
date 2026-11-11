// Ett besök, med flikarna Rum, Objekt och Summering. Rum kommer först: det är där rundvandringen sker.
import { deletePhoto, deleteVisit, getVisit, photosForVisit, putVisit } from '../db.js';
import { exportBackup, exportExcel, exportPdf } from '../export.js';
import { addPhotos, cameraInput, photoSection } from '../photos.js';
import { applyQuickText } from '../quick.js';
import { computeSummary, roomMissingCount } from '../summary.js';
import { byRole, createRoom, fieldsFor, formatValue, getTemplate, roomCount, roomTitle } from '../template.js';
import { append, fmtNum, h, toast, uid } from '../util.js';
import { autosaver, customFieldsCard, fieldCards, notesCard } from './common.js';
import { quickReceipt } from './room.js';

export async function visitView(app, { id, tab = 'rum' }) {
  const visit = await getVisit(id);
  if (!visit) return app.go('#/');
  const photos = await photosForVisit(id);

  app.setHeader({ title: visit.customer || 'Besök', back: '#/' });
  const save = autosaver(app, visit);
  const drawTabs = () => app.setTabs([
    { label: `Rum (${visit.rooms.length})`, href: `#/visit/${id}/rum`, active: tab === 'rum' },
    { label: 'Objekt', href: `#/visit/${id}/objekt`, active: tab === 'objekt' },
    { label: 'Summering', href: `#/visit/${id}/summering`, active: tab === 'summering' },
  ]);
  drawTabs();

  if (tab === 'rum') roomsTab(app, visit, photos, save, drawTabs);
  else if (tab === 'summering') summaryTab(app, visit);
  else objectTab(app, visit, photos, save);
}

// ---------- Objekt ----------

function objectTab(app, visit, photos, save) {
  const base = (label, key, attrs = {}) =>
    h('label', { class: 'field' },
      h('div', { class: 'field-label' }, label, attrs.required && h('span', { class: 'req' }, ' *')),
      h('input', {
        type: 'text', value: visit[key] || '', ...attrs,
        oninput: (e) => {
          visit[key] = e.target.value;
          if (key === 'seller') localStorage.setItem('seller', e.target.value);
          if (key === 'customer') app.setTitle(e.target.value || 'Besök');
          save();
        },
      }));

  const open = new Set(); // utfällda sektioner
  const questions = h('div', { class: 'stack' });
  const drawQuestions = () => questions.replaceChildren(
    ...fieldCards(fieldsFor(visit.template.objectFields, visit.objectTypeId), visit.values, () => save(), { open }));
  drawQuestions();

  app.show(
    h('section', { class: 'card' },
      h('h3', {}, 'Grunduppgifter'),
      base('Kund', 'customer', { required: true }),
      base('Adress', 'address'),
      base('Datum', 'date', { type: 'date' }),
      base('Säljare', 'seller'),
      h('label', { class: 'field' },
        h('div', { class: 'field-label' }, 'Objektstyp'),
        h('select', {
          onchange: (e) => { visit.objectTypeId = e.target.value; drawQuestions(); save(); },
        }, visit.template.objectTypes.map((o) =>
          h('option', { value: o.id, selected: o.id === visit.objectTypeId }, o.label))))),
    questions,
    customFieldsCard(visit, save, open),
    notesCard(visit, save),
    photoSection(visit.id, null, photos),
    h('a', { class: 'btn primary big', href: `#/visit/${visit.id}/summering` }, 'Till summeringen'));
}

// ---------- Rum ----------

function roomsTab(app, visit, photos, save, drawTabs) {
  const template = visit.template;
  const type = byRole(template, 'roomType'), area = byRole(template, 'area'), floor = byRole(template, 'floorType');
  const roomHref = (room) => `#/visit/${visit.id}/room/${room.id}`;

  const listBox = h('div', { class: 'stack' });
  const redraw = () => { drawList(); drawTabs(); };

  // En kamerainmatning delas av alla knappar. photoTarget är rummet som fotot ska hamna på,
  // eller null för "Foto + nytt rum": då skapas rummet när bilden är tagen.
  let photoTarget = null;
  const camera = cameraInput(async (files) => {
    const room = photoTarget || await createFromInput();
    await addPhotos(files, visit.id, room.id, photos);
    redraw();
  });
  const takePhoto = (room) => { photoTarget = room; camera.click(); };

  const copyRoom = async (room) => {
    const copy = { ...structuredClone(room), id: uid(), name: room.name ? `${room.name} (kopia)` : '' };
    visit.rooms.splice(visit.rooms.indexOf(room) + 1, 0, copy);
    await save.now();
    app.go(roomHref(copy));
  };

  const drawList = () => listBox.replaceChildren(
    visit.rooms.length
      ? h('div', { class: 'list' }, visit.rooms.map((room, i) => {
        const missing = roomMissingCount(visit, room);
        const nPhotos = photos.filter((p) => p.roomId === room.id).length;
        return h('div', { class: 'card room-card' },
          h('a', { class: 'room-main', href: roomHref(room) },
            h('div', { class: 'card-title' }, `${i + 1}. ${roomTitle(visit, room, i)}`,
              roomCount(room) > 1 && h('span', { class: 'badge ok times' }, `× ${roomCount(room)}`)),
            h('div', { class: 'meta' },
              type && room.name && room.values[type.id] && h('span', {}, room.values[type.id]),
              area && h('span', {}, formatValue(area, room.values[area.id]) || 'Yta saknas'),
              floor && room.values[floor.id] && h('span', {}, room.values[floor.id]),
              nPhotos > 0 && h('span', {}, `${nPhotos} foto`),
              missing > 0 && h('span', { class: 'badge warn' }, `${missing} saknas`))),
          h('div', { class: 'room-actions' },
            h('button', { class: 'btn small', onclick: () => takePhoto(room) }, 'Foto'),
            h('button', { class: 'btn small', onclick: () => copyRoom(room) }, 'Kopiera')));
      }))
      : h('p', { class: 'empty' }, 'Inga rum ännu. Räkna upp det första rummet i rutan ovan.'));

  // Snabbinmatning: en rad per rum. Rummet skapas och syns i listan utan att man lämnar sidan.
  const input = h('textarea', {
    rows: 2, 'aria-label': 'Snabbinmatning',
    placeholder: 't.ex. WC, fyra kvadrat, klinker, två toaletter',
  });
  const result = h('div', { class: 'quick-result' });

  /** Skapar ett rum av texten i rutan. Tom ruta ger ett tomt rum. Returnerar rummet. */
  const createFromInput = async () => {
    const text = input.value.trim();
    const room = createRoom(uid(), template, visit.rooms.at(-1));
    const r = text ? applyQuickText(visit, room, text) : null;
    if (r?.rest) room.notes = r.rest; // det otolkade ska inte gå förlorat
    visit.rooms.push(room);
    await save.now();
    input.value = '';
    result.replaceChildren();
    if (r) {
      const i = visit.rooms.indexOf(room);
      append(result, [
        h('p', { class: 'quick-ok' }, h('strong', {}, `Rum ${i + 1} tillagt. `),
          r.understood.length ? r.understood.join(' · ') : 'Inget gick att tolka.'),
        quickReceipt(r, 'Lagt i anteckningarna').slice(1),
        h('div', { class: 'row' },
          h('a', { class: 'btn small', href: roomHref(room) }, 'Öppna rummet'),
          h('button', {
            type: 'button', class: 'btn small',
            onclick: async () => {
              for (const p of photos.filter((x) => x.roomId === room.id)) {
                await deletePhoto(p.id);
                photos.splice(photos.indexOf(p), 1);
              }
              visit.rooms.splice(visit.rooms.indexOf(room), 1);
              await save.now();
              result.replaceChildren();
              input.value = text;
              redraw();
            },
          }, 'Ångra')),
      ]);
    }
    return room;
  };

  drawList();
  app.show(
    h('section', { class: 'card' },
      h('h3', {}, 'Nytt rum'),
      h('p', { class: 'muted' }, 'Räkna upp det du ser och tryck Lägg till. Tryck på mikrofonen på tangentbordet för att diktera. Tom ruta ger ett tomt rum att fylla i för hand.'),
      input,
      h('div', { class: 'row' },
        h('button', {
          type: 'button', class: 'btn primary',
          onclick: async () => {
            const typed = input.value.trim() !== '';
            const room = await createFromInput();
            if (typed) redraw(); else app.go(roomHref(room));
          },
        }, 'Lägg till rum'),
        h('button', { type: 'button', class: 'btn', onclick: () => takePhoto(null) }, 'Foto + nytt rum')),
      result),
    camera,
    listBox);

}

// ---------- Summering ----------

function summaryTab(app, visit) {
  const s = computeSummary(visit);
  const tableCard = (title, head, rows) =>
    h('section', { class: 'card' },
      h('h3', {}, title),
      h('table', { class: 'table' },
        h('thead', {}, h('tr', {}, head.map((c, i) => h('th', { class: i ? 'num' : '' }, c)))),
        h('tbody', {}, rows.map((r) => h('tr', {}, r.map((c, i) => h('td', { class: i ? 'num' : '' }, c)))))));

  const busy = (label, fn) => {
    const btn = h('button', {
      class: 'btn',
      onclick: async () => {
        btn.disabled = true;
        try { await fn(visit); } catch (e) { console.error(e); toast('Exporten misslyckades: ' + e.message); }
        btn.disabled = false;
      },
    }, label);
    return btn;
  };

  const current = getTemplate();
  const outdated = current.updated !== visit.template.updated;

  app.show(
    s.missing.length
      ? h('section', { class: 'card warn-card' },
        h('h3', {}, `${s.missing.length} obligatoriska uppgifter saknas`),
        h('ul', { class: 'missing' }, s.missing.map((m) =>
          h('li', {}, h('a', {
            href: m.roomId ? `#/visit/${visit.id}/room/${m.roomId}` : `#/visit/${visit.id}/objekt`,
          }, `${m.where}: ${m.label}`)))))
      : h('section', { class: 'card ok-card' }, h('h3', {}, 'Alla obligatoriska uppgifter är ifyllda')),

    h('div', { class: 'tiles' },
      h('div', { class: 'tile' }, h('div', { class: 'tile-num' }, String(s.roomCount)), h('div', { class: 'tile-cap' }, 'rum')),
      h('div', { class: 'tile' }, h('div', { class: 'tile-num' }, fmtNum(s.totalArea)), h('div', { class: 'tile-cap' }, 'm² totalt'))),

    s.sums.length > 0 && tableCard('Antal', ['', 'Summa'],
      s.sums.map((x) => [x.label, `${fmtNum(x.total)} ${x.unit}`.trim()])),
    s.breakdowns.filter((b) => b.rows.length).map((b) =>
      tableCard(`Yta per ${b.label.toLowerCase()}`, [b.label, 'm²', 'Rum'],
        b.rows.map((r) => [r.option, fmtNum(r.area), String(r.rooms)]))),
    s.groups.filter((g) => g.rows.length).map((g) =>
      tableCard(g.label, [g.keyLabel || '', ...g.columns],
        g.rows.map((r) => [r.option, ...r.values.map((n) => fmtNum(n))]))),

    h('section', { class: 'card' },
      h('h3', {}, 'Exportera och dela'),
      h('p', { class: 'muted' }, 'Excel för kalkylen, PDF med foton som rapport. Säkerhetskopian kan läsas in i appen på en annan enhet.'),
      h('div', { class: 'row' },
        busy('Excel', exportExcel), busy('PDF', exportPdf), busy('Säkerhetskopia', exportBackup))),

    outdated && h('section', { class: 'card' },
      h('h3', {}, 'Mallen har ändrats'),
      h('p', { class: 'muted' }, 'Besöket använder mallen som gällde när det skapades. Svar på frågor som finns kvar behålls om du byter.'),
      h('button', {
        class: 'btn small',
        onclick: async () => {
          if (!confirm('Byta till den senaste mallen för det här besöket?')) return;
          visit.template = structuredClone(current);
          if (!current.objectTypes.some((o) => o.id === visit.objectTypeId)) visit.objectTypeId = current.objectTypes[0]?.id;
          visit.updated = Date.now();
          await putVisit(visit);
          app.reload();
        },
      }, 'Byt till senaste mallen')),

    h('button', {
      class: 'btn danger',
      onclick: async () => {
        if (!confirm(`Ta bort besöket hos ${visit.customer || 'kunden'} med alla rum och foton? Det går inte att ångra.`)) return;
        await deleteVisit(visit.id);
        app.go('#/');
      },
    }, 'Ta bort besöket'));
}

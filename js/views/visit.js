// Ett besök, med flikarna Objekt, Rum och Summering.
import { deleteVisit, getVisit, photosForVisit, putVisit } from '../db.js';
import { exportBackup, exportExcel, exportPdf } from '../export.js';
import { photoSection } from '../photos.js';
import { computeSummary, roomMissingCount } from '../summary.js';
import { byRole, fieldsFor, formatValue, getTemplate, roomTitle } from '../template.js';
import { debounce, fmtNum, h, toast, uid } from '../util.js';
import { customFieldsCard, fieldCards, notesCard } from './common.js';

export async function visitView(app, { id, tab = 'objekt' }) {
  const visit = await getVisit(id);
  if (!visit) return app.go('#/');
  const photos = await photosForVisit(id);

  const save = debounce(async () => { visit.updated = Date.now(); await putVisit(visit); }, 400);
  app.onLeave = () => save.flush();

  app.setHeader({ title: visit.customer || 'Besök', back: '#/' });
  app.setTabs([
    { label: 'Objekt', href: `#/visit/${id}/objekt`, active: tab === 'objekt' },
    { label: `Rum (${visit.rooms.length})`, href: `#/visit/${id}/rum`, active: tab === 'rum' },
    { label: 'Summering', href: `#/visit/${id}/summering`, active: tab === 'summering' },
  ]);

  if (tab === 'rum') roomsTab(app, visit, photos);
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

  const questions = h('div', {});
  const drawQuestions = () => questions.replaceChildren(
    ...fieldCards(fieldsFor(visit.template.objectFields, visit.objectTypeId), visit.values, save));
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
    customFieldsCard(visit, save),
    notesCard(visit, save),
    photoSection(visit.id, null, photos),
    h('a', { class: 'btn primary big', href: `#/visit/${visit.id}/rum` }, 'Vidare till rummen'));
}

// ---------- Rum ----------

function roomsTab(app, visit, photos) {
  const template = visit.template;
  const type = byRole(template, 'roomType'), area = byRole(template, 'area'), floor = byRole(template, 'floorType');

  const addRoom = async (copyOf) => {
    const room = copyOf
      ? { ...structuredClone(copyOf), id: uid(), name: copyOf.name ? `${copyOf.name} (kopia)` : '' }
      : { id: uid(), name: '', values: {}, customFields: [], notes: '' };
    // Nytt rum hamnar sist, en kopia direkt efter originalet.
    if (copyOf) visit.rooms.splice(visit.rooms.indexOf(copyOf) + 1, 0, room);
    else visit.rooms.push(room);
    visit.updated = Date.now();
    await putVisit(visit);
    app.go(`#/visit/${visit.id}/room/${room.id}`);
  };

  app.show(
    visit.rooms.length
      ? h('div', { class: 'list' }, visit.rooms.map((room, i) => {
        const missing = roomMissingCount(visit, room);
        const nPhotos = photos.filter((p) => p.roomId === room.id).length;
        return h('div', { class: 'card room-card' },
          h('a', { class: 'room-main', href: `#/visit/${visit.id}/room/${room.id}` },
            h('div', { class: 'card-title' }, `${i + 1}. ${roomTitle(visit, room, i)}`),
            h('div', { class: 'meta' },
              type && room.name && room.values[type.id] && h('span', {}, room.values[type.id]),
              area && h('span', {}, formatValue(area, room.values[area.id]) || 'Yta saknas'),
              floor && room.values[floor.id] && h('span', {}, room.values[floor.id]),
              nPhotos > 0 && h('span', {}, `${nPhotos} foto`),
              missing > 0 && h('span', { class: 'badge warn' }, `${missing} saknas`))),
          h('button', { class: 'btn small', onclick: () => addRoom(room) }, 'Kopiera'));
      }))
      : h('p', { class: 'empty' }, 'Inga rum ännu. Lägg till det första rummet.'),
    h('button', { class: 'btn primary big', onclick: () => addRoom() }, '+ Lägg till rum'));
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

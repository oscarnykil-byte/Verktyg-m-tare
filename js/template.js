// Mallen styr vilka frågor som ställs. Den är ren data och kan redigeras i appen.
import { getMeta, setMeta } from './db.js';
import { fmtNum } from './util.js';

export const FIELD_TYPES = {
  text: 'Kort text',
  note: 'Lång text',
  number: 'Tal / mått',
  area: 'Yta (m² eller längd × bredd)',
  counter: 'Räknare (+ / −)',
  yesno: 'Ja / Nej',
  choice: 'Ett alternativ',
  multi: 'Flera alternativ',
  group: 'Upprepande rader (t.ex. fönster)',
};
// Typer som får användas inuti upprepande rader.
export const SUBFIELD_TYPES = ['text', 'number', 'counter', 'yesno', 'choice'];

let current = null;   // mallen som används för nya besök
let shipped = null;   // standardmallen som följer med appen

export const getTemplate = () => current;
export const getShippedTemplate = () => shipped;

/** Läser in mallen vid start. Standardmallen uppdateras automatiskt om den inte är ändrad lokalt. */
export async function initTemplate() {
  try {
    const res = await fetch('data/default-template.json');
    shipped = validateTemplate(await res.json());
  } catch {
    shipped = null;
  }
  const stored = await getMeta('template');
  if (!stored) {
    if (!shipped) throw new Error('Standardmallen kunde inte läsas in.');
    current = { ...structuredClone(shipped), origin: 'default' };
    await setMeta('template', current);
  } else if (shipped && stored.origin !== 'custom' && shipped.updated > stored.updated) {
    current = { ...structuredClone(shipped), origin: 'default' };
    await setMeta('template', current);
  } else {
    current = stored;
  }
  return current;
}

/** origin: 'default' (följer appen), 'imported' (delad fil) eller 'custom' (ändrad på den här enheten). */
export async function saveTemplate(template, origin) {
  current = { ...template, origin };
  if (origin === 'custom') current.updated = new Date().toISOString();
  await setMeta('template', current);
  return current;
}

export const newerShippedAvailable = () =>
  !!(shipped && current && current.origin === 'custom' && shipped.updated > current.updated);

/** Kontrollerar en inläst mall. Kastar ett fel med begriplig text om något är fel. */
export function validateTemplate(t) {
  const fail = (msg) => { throw new Error('Filen är inte en giltig mall: ' + msg); };
  if (!t || typeof t !== 'object') fail('innehållet går inte att läsa.');
  if (!Array.isArray(t.objectTypes) || !Array.isArray(t.objectFields) || !Array.isArray(t.roomFields)) {
    fail('objektstyper eller frågor saknas.');
  }
  for (const o of t.objectTypes) if (!o.id || !o.label) fail('en objektstyp saknar namn.');
  const checkFields = (fields, allowed) => {
    const seen = new Set();
    for (const f of fields) {
      if (!f.id || !f.label) fail('en fråga saknar namn.');
      if (seen.has(f.id)) fail(`frågan "${f.label}" finns två gånger.`);
      seen.add(f.id);
      if (!allowed.includes(f.type)) fail(`frågan "${f.label}" har en okänd typ.`);
      if ((f.type === 'choice' || f.type === 'multi') && !(Array.isArray(f.options) && f.options.length)) {
        fail(`frågan "${f.label}" saknar alternativ.`);
      }
      if (f.type === 'group') {
        if (!Array.isArray(f.subfields) || !f.subfields.length) fail(`"${f.label}" saknar delfält.`);
        checkFields(f.subfields, SUBFIELD_TYPES);
      }
    }
  };
  checkFields(t.objectFields, Object.keys(FIELD_TYPES));
  checkFields(t.roomFields, Object.keys(FIELD_TYPES));
  return {
    schema: 1,
    name: String(t.name || 'Mall'),
    updated: String(t.updated || new Date().toISOString()),
    objectTypes: t.objectTypes,
    objectFields: t.objectFields,
    roomFields: t.roomFields,
  };
}

/** Frågorna som gäller för vald objektstyp. Frågor utan begränsning gäller alltid. */
export function fieldsFor(fields, objectTypeId) {
  return fields.filter((f) => !f.objectTypes?.length || f.objectTypes.includes(objectTypeId));
}

export const objectFieldsOf = (visit) =>
  [...fieldsFor(visit.template.objectFields, visit.objectTypeId), ...(visit.customFields || [])];

export const byRole = (template, role) => template.roomFields.find((f) => f.role === role);

export const roomTypeOf = (template, room) => {
  const type = byRole(template, 'roomType');
  return (type && room.values[type.id]) || null;
};

/** Mallens frågor för ett rum: de som gäller objektstypen och rummets lokaltyp. */
export function roomTemplateFields(visit, room) {
  const type = roomTypeOf(visit.template, room);
  return fieldsFor(visit.template.roomFields, visit.objectTypeId)
    .filter((f) => !f.roomTypes?.length || f.roomTypes.includes(type));
}

export const roomFieldsOf = (visit, room) =>
  [...roomTemplateFields(visit, room), ...(room.customFields || [])];

/** Antal likadana rum som raden står för (minst 1). */
export const roomCount = (room) => Math.max(1, Math.round(room.count || 1));

/**
 * Skapar ett nytt rum. Frågor märkta "förifyll från föregående rum" (t.ex. våning och golvtyp)
 * får samma svar som i rummet innan.
 */
export function createRoom(id, template, previous) {
  const room = { id, name: '', count: 1, values: {}, auto: {}, customFields: [], notes: '' };
  if (previous) {
    for (const f of template.roomFields) {
      if (f.inherit && !isEmpty(f, previous.values[f.id])) {
        room.values[f.id] = structuredClone(previous.values[f.id]);
        room.auto[f.id] = 'inherit';
      }
    }
  }
  return room;
}

/**
 * Fyller i lokaltypens förval. Svar som säljaren själv har skrivit rörs inte:
 * bara tomma fält och fält som fyllts i automatiskt (room.auto) ändras.
 */
export function applyTypeDefaults(template, room) {
  const typeField = byRole(template, 'roomType');
  if (!typeField) return;
  room.auto ||= {};
  const defaults = typeField.defaults?.[room.values[typeField.id]] || {};
  // Förval från en tidigare vald lokaltyp tas bort om de inte gäller längre.
  for (const [id, how] of Object.entries(room.auto)) {
    if (how === 'default' && !(id in defaults)) {
      delete room.values[id];
      delete room.auto[id];
    }
  }
  for (const [id, value] of Object.entries(defaults)) {
    const f = template.roomFields.find((x) => x.id === id);
    if (!f) continue;
    if (isEmpty(f, room.values[id]) || room.auto[id]) {
      room.values[id] = structuredClone(value);
      room.auto[id] = 'default';
    }
  }
}

export function isEmpty(field, v) {
  if (v == null || v === '') return true;
  switch (field.type) {
    case 'area': return !(v.a > 0);
    case 'multi':
    case 'group': return v.length === 0;
    case 'text':
    case 'note': return String(v).trim() === '';
    default: return false;
  }
}

/** Talvärdet för fält som går att summera, annars null. */
export function numericValue(field, v) {
  if (v == null) return null;
  if (field.type === 'area') return v.a > 0 ? v.a : null;
  if (field.type === 'number' || field.type === 'counter') return typeof v === 'number' ? v : null;
  return null;
}

/** Värdet som läsbar text, för listor och export. */
export function formatValue(field, v) {
  if (isEmpty(field, v)) return '';
  switch (field.type) {
    case 'yesno': return v ? 'Ja' : 'Nej';
    case 'number': return fmtNum(v) + (field.unit ? ' ' + field.unit : '');
    case 'counter': return String(v);
    case 'area': {
      const dims = v.l > 0 && v.w > 0 ? ` (${fmtNum(v.l)} × ${fmtNum(v.w)} m)` : '';
      return `${fmtNum(v.a)} m²${dims}`;
    }
    case 'multi': return v.join(', ');
    case 'group':
      return v.map((row) =>
        field.subfields.map((s) => formatValue(s, row[s.id])).filter(Boolean).join(', ')).join(' | ');
    default: return String(v);
  }
}

export function roomTitle(visit, room, index) {
  const type = byRole(visit.template, 'roomType');
  return room.name?.trim() || (type && room.values[type.id]) || `Rum ${index + 1}`;
}

/** Grupperar frågor efter rubrik, i den ordning rubrikerna först förekommer. */
export function bySection(fields) {
  const sections = new Map();
  for (const f of fields) {
    const key = f.section || '';
    if (!sections.has(key)) sections.set(key, []);
    sections.get(key).push(f);
  }
  return [...sections.entries()];
}

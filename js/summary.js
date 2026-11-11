// Räknar fram nyckeltal för ett besök och hittar obligatoriska frågor som saknar svar.
import {
  byRole, fieldsFor, isEmpty, numericValue, objectFieldsOf, roomCount, roomFieldsOf, roomTemplateFields, roomTitle,
} from './template.js';
import { round } from './util.js';

const add = (map, key, n) => map.set(key, (map.get(key) || 0) + n);

export function computeSummary(visit) {
  const template = visit.template;
  const roomFields = fieldsFor(template.roomFields, visit.objectTypeId);
  const areaField = byRole(template, 'area');
  // En rad kan stå för flera likadana rum: allt räknas gånger antalet.
  const areaOf = (room) => ((areaField && numericValue(areaField, room.values[areaField.id])) || 0) * roomCount(room);
  // Svar på frågor som inte gäller rummets lokaltyp räknas inte med.
  const shown = new Map(visit.rooms.map((r) => [r, new Set(roomTemplateFields(visit, r).map((f) => f.id))]));
  const applies = (room, f) => shown.get(room).has(f.id);

  const totalArea = round(visit.rooms.reduce((sum, r) => sum + areaOf(r), 0));

  // Yta och antal rum per alternativ (t.ex. per golvtyp och per lokaltyp).
  const breakdowns = roomFields.filter((f) => f.type === 'choice' && f.breakdown).map((f) => {
    const area = new Map();
    const count = new Map();
    for (const room of visit.rooms) {
      const key = room.values[f.id] || '(ej angivet)';
      add(area, key, areaOf(room));
      add(count, key, roomCount(room));
    }
    return {
      label: f.label,
      rows: [...area.keys()].map((k) => ({ option: k, area: round(area.get(k)), rooms: count.get(k) }))
        .sort((a, b) => b.area - a.area),
    };
  });

  // Summor av räknare och tal (t.ex. antal toaletter).
  const sums = roomFields.filter((f) => f.sum && (f.type === 'counter' || f.type === 'number')).map((f) => ({
    label: f.label,
    unit: f.unit || (f.type === 'counter' ? 'st' : ''),
    total: round(visit.rooms.reduce((s, r) =>
      s + (applies(r, f) ? (numericValue(f, r.values[f.id]) || 0) * roomCount(r) : 0), 0)),
  }));

  // Upprepande rader (t.ex. fönster): summa per alternativ i första envalsfältet.
  const groups = roomFields.filter((f) => f.type === 'group').map((f) => {
    const key = f.subfields.find((s) => s.type === 'choice');
    const nums = f.subfields.filter((s) => s.type === 'counter' || s.type === 'number');
    const totals = new Map();
    for (const room of visit.rooms) {
      if (!applies(room, f)) continue;
      const n = roomCount(room);
      for (const row of room.values[f.id] || []) {
        const k = (key && row[key.id]) || (key ? '(ej angivet)' : 'Totalt');
        if (!totals.has(k)) totals.set(k, { rows: 0, nums: nums.map(() => 0) });
        const t = totals.get(k);
        t.rows += n;
        nums.forEach((s, i) => { t.nums[i] += (numericValue(s, row[s.id]) || 0) * n; });
      }
    }
    return {
      label: f.label,
      keyLabel: key ? key.label : '',
      columns: nums.length ? nums.map((s) => s.label) : ['Antal rader'],
      rows: [...totals.entries()].map(([option, t]) => ({ option, values: nums.length ? t.nums.map((n) => round(n)) : [t.rows] })),
    };
  });

  return { roomCount: visit.rooms.reduce((s, r) => s + roomCount(r), 0), totalArea, breakdowns, sums, groups, missing: findMissing(visit) };
}

/** Obligatoriska frågor utan svar, med uppgift om var de finns. */
export function findMissing(visit) {
  const missing = [];
  if (!visit.customer?.trim()) missing.push({ where: 'Objektet', label: 'Kund' });
  for (const f of objectFieldsOf(visit)) {
    if (f.required && isEmpty(f, visit.values[f.id])) missing.push({ where: 'Objektet', label: f.label });
  }
  visit.rooms.forEach((room, i) => {
    for (const f of roomFieldsOf(visit, room)) {
      if (f.required && isEmpty(f, room.values[f.id])) {
        missing.push({ where: roomTitle(visit, room, i), roomId: room.id, label: f.label });
      }
    }
  });
  return missing;
}

export const roomMissingCount = (visit, room) =>
  roomFieldsOf(visit, room).filter((f) => f.required && isEmpty(f, room.values[f.id])).length;

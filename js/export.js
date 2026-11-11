// Export av ett besök: Excel, PDF och säkerhetskopia (JSON).
import { photosForVisit, putPhoto, putVisit } from './db.js';
import { computeSummary } from './summary.js';
import {
  byRole, fieldsFor, formatValue, numericValue, objectFieldsOf, roomTitle, validateTemplate,
} from './template.js';
import { fileSafe, fmtNum, loadScript, shareOrDownload, uid } from './util.js';

const baseName = (visit) => `Besok_${fileSafe(visit.customer)}_${visit.date || ''}`;
const objectTypeLabel = (visit) =>
  visit.template.objectTypes.find((o) => o.id === visit.objectTypeId)?.label || '';

/** Grunduppgifter och objektfrågor som rader [rubrik, värde]. */
function objectRows(visit) {
  const rows = [
    ['Kund', visit.customer || ''],
    ['Adress', visit.address || ''],
    ['Datum', visit.date || ''],
    ['Säljare', visit.seller || ''],
    ['Objektstyp', objectTypeLabel(visit)],
  ];
  for (const f of objectFieldsOf(visit)) rows.push([f.label, formatValue(f, visit.values[f.id])]);
  rows.push(['Anteckningar', visit.notes || '']);
  return rows;
}

/** Alla egna fält som förekommer i något rum, sammanslagna på rubrik. */
function customRoomLabels(visit) {
  return [...new Set(visit.rooms.flatMap((r) => (r.customFields || []).map((f) => f.label)))];
}

function customRoomValue(room, label) {
  const f = (room.customFields || []).find((c) => c.label === label);
  return f ? formatValue(f, room.values[f.id]) : '';
}

// ---------- Excel ----------

export async function exportExcel(visit) {
  await loadScript('vendor/xlsx.mini.min.js');
  const XLSX = window.XLSX;
  const wb = XLSX.utils.book_new();
  const used = new Set();
  const addSheet = (name, rows) => {
    const ws = XLSX.utils.aoa_to_sheet(rows);
    const widths = [];
    for (const row of rows) row.forEach((c, i) => { widths[i] = Math.min(60, Math.max(widths[i] || 8, String(c ?? '').length + 2)); });
    ws['!cols'] = widths.map((wch) => ({ wch }));
    let safe = name.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || 'Blad';
    while (used.has(safe.toLowerCase())) safe = safe.slice(0, 28) + ' ' + (used.size + 1);
    used.add(safe.toLowerCase());
    XLSX.utils.book_append_sheet(wb, ws, safe);
  };

  const photos = await photosForVisit(visit.id);
  const fields = fieldsFor(visit.template.roomFields, visit.objectTypeId);
  const plain = fields.filter((f) => f.type !== 'group');
  const groups = fields.filter((f) => f.type === 'group');
  const customs = customRoomLabels(visit);

  addSheet('Objekt', [['Uppgift', 'Värde'], ...objectRows(visit)]);

  // Ett rum per rad. Tal skrivs som tal så att det går att räkna vidare i Excel.
  const header = ['Nr', 'Benämning'];
  for (const f of plain) {
    if (f.type === 'area') header.push(`${f.label} (m²)`, 'Längd (m)', 'Bredd (m)');
    else header.push(f.label + (f.unit ? ` (${f.unit})` : ''));
  }
  header.push(...customs, 'Anteckningar', 'Antal foton');
  const roomRows = visit.rooms.map((room, i) => {
    const row = [i + 1, roomTitle(visit, room, i)];
    for (const f of plain) {
      const v = room.values[f.id];
      if (f.type === 'area') row.push(v?.a ?? '', v?.l ?? '', v?.w ?? '');
      else row.push(numericValue(f, v) ?? formatValue(f, v));
    }
    row.push(...customs.map((label) => customRoomValue(room, label)), room.notes || '',
      photos.filter((p) => p.roomId === room.id).length);
    return row;
  });
  addSheet('Rum', [header, ...roomRows]);

  // Ett blad per upprepande fält, t.ex. Fönster.
  for (const g of groups) {
    const rows = [['Rum nr', 'Rum', ...g.subfields.map((s) => s.label)]];
    visit.rooms.forEach((room, i) => {
      for (const r of room.values[g.id] || []) {
        rows.push([i + 1, roomTitle(visit, room, i),
          ...g.subfields.map((s) => numericValue(s, r[s.id]) ?? formatValue(s, r[s.id]))]);
      }
    });
    addSheet(g.label, rows);
  }

  const s = computeSummary(visit);
  const sum = [['Nyckeltal', 'Värde', 'Enhet'], ['Antal rum', s.roomCount, 'st'], ['Total yta', s.totalArea, 'm²']];
  for (const x of s.sums) sum.push([x.label, x.total, x.unit]);
  for (const b of s.breakdowns) {
    sum.push([], [`Yta per ${b.label.toLowerCase()}`, 'Yta (m²)', 'Antal rum']);
    for (const r of b.rows) sum.push([r.option, r.area, r.rooms]);
  }
  for (const g of s.groups) {
    sum.push([], [`${g.label} per ${(g.keyLabel || 'rad').toLowerCase()}`, ...g.columns]);
    for (const r of g.rows) sum.push([r.option, ...r.values]);
  }
  addSheet('Summering', sum);

  const data = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  const blob = new Blob([data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  await shareOrDownload(blob, baseName(visit) + '.xlsx');
}

// ---------- PDF ----------

// Standardtypsnitten i PDF klarar bara västeuropeiska tecken.
const pdfText = (s) => String(s ?? '')
  .replace(/[–—−]/g, '-').replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
  .replace(/…/g, '...').replace(/[^\x00-\xFF]/g, '?');

const imageSize = (src) => new Promise((resolve) => {
  const img = new Image();
  img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
  img.onerror = () => resolve(null);
  img.src = src;
});

export async function exportPdf(visit) {
  await loadScript('vendor/jspdf.umd.min.js');
  await loadScript('vendor/jspdf.plugin.autotable.min.js');
  const doc = new window.jspdf.jsPDF({ unit: 'mm', format: 'a4' });
  const M = 14;
  const W = doc.internal.pageSize.getWidth() - 2 * M;
  const H = doc.internal.pageSize.getHeight();
  let y = 18;

  const space = (need) => { if (y + need > H - 14) { doc.addPage(); y = 18; } };
  const heading = (text, size = 13) => {
    space(14);
    doc.setFont('helvetica', 'bold').setFontSize(size).text(pdfText(text), M, y);
    doc.setFont('helvetica', 'normal');
    y += 3;
  };
  const table = (head, body, opts = {}) => {
    doc.autoTable({
      startY: y, margin: { left: M, right: M }, theme: 'grid',
      head: head ? [head.map(pdfText)] : undefined,
      body: body.map((r) => r.map(pdfText)),
      styles: { fontSize: 9, cellPadding: 1.5, overflow: 'linebreak' },
      headStyles: { fillColor: [15, 110, 86], textColor: 255 },
      ...opts,
    });
    y = doc.lastAutoTable.finalY + 8;
  };
  const kv = (rows) => table(null, rows.filter((r) => r[1] !== ''), {
    columnStyles: { 0: { cellWidth: 60, fontStyle: 'bold' } },
  });

  const photos = await photosForVisit(visit.id);
  const drawPhotos = async (list) => {
    const cols = 3, gap = 4, w = (W - gap * (cols - 1)) / cols;
    let col = 0, rowH = 0;
    for (const p of list) {
      const size = await imageSize(p.data);
      if (!size) continue;
      const hh = Math.min(w * (size.h / size.w), 90);
      if (col === 0) { space(hh + gap); rowH = 0; }
      doc.addImage(p.data, 'JPEG', M + col * (w + gap), y, w, hh, undefined, 'FAST');
      rowH = Math.max(rowH, hh);
      if (++col === cols) { col = 0; y += rowH + gap; }
    }
    if (col !== 0) y += rowH + gap;
    y += 4;
  };

  doc.setFont('helvetica', 'bold').setFontSize(18).text('Besöksunderlag lokalvård', M, y);
  doc.setFont('helvetica', 'normal');
  y += 8;
  kv(objectRows(visit));
  await drawPhotos(photos.filter((p) => !p.roomId));

  const s = computeSummary(visit);
  heading('Summering');
  table(['Nyckeltal', 'Värde'], [
    ['Antal rum', `${s.roomCount} st`],
    ['Total yta', `${fmtNum(s.totalArea)} m²`],
    ...s.sums.map((x) => [x.label, `${fmtNum(x.total)} ${x.unit}`.trim()]),
  ]);
  for (const b of s.breakdowns) {
    if (!b.rows.length) continue;
    table([`Yta per ${b.label.toLowerCase()}`, 'Yta (m²)', 'Antal rum'],
      b.rows.map((r) => [r.option, fmtNum(r.area), r.rooms]));
  }
  for (const g of s.groups) {
    if (!g.rows.length) continue;
    table([`${g.label} per ${(g.keyLabel || 'rad').toLowerCase()}`, ...g.columns],
      g.rows.map((r) => [r.option, ...r.values.map((n) => fmtNum(n))]));
  }

  // Översikt över alla rum, och därefter varje rum för sig.
  const template = visit.template;
  const type = byRole(template, 'roomType'), area = byRole(template, 'area'), floor = byRole(template, 'floorType');
  if (visit.rooms.length) {
    heading('Rum');
    table(['Nr', 'Benämning', 'Lokaltyp', 'Yta (m²)', 'Golvtyp'], visit.rooms.map((room, i) => [
      i + 1, roomTitle(visit, room, i),
      type ? room.values[type.id] || '' : '',
      area ? fmtNum(room.values[area.id]?.a) : '',
      floor ? room.values[floor.id] || '' : '',
    ]));
  }
  for (const [i, room] of visit.rooms.entries()) {
    heading(`${i + 1}. ${roomTitle(visit, room, i)}`, 11);
    const rows = [];
    for (const f of [...fieldsFor(template.roomFields, visit.objectTypeId), ...(room.customFields || [])]) {
      const v = room.values[f.id];
      if (f.type === 'group') {
        (v || []).forEach((r, n) => rows.push([`${f.label} ${n + 1}`,
          f.subfields.map((sf) => { const t = formatValue(sf, r[sf.id]); return t && `${sf.label}: ${t}`; }).filter(Boolean).join(', ')]));
      } else if (f.type === 'counter' && !v) {
        continue; // Räknare på noll tar bara plats.
      } else {
        rows.push([f.label, formatValue(f, v)]);
      }
    }
    rows.push(['Anteckningar', room.notes || '']);
    kv(rows);
    await drawPhotos(photos.filter((p) => p.roomId === room.id));
  }

  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p).setFontSize(8).setTextColor(120);
    doc.text(pdfText(`${visit.customer || ''}  ${visit.date || ''}`), M, H - 8);
    doc.text(`Sida ${p} av ${pages}`, M + W, H - 8, { align: 'right' });
  }

  await shareOrDownload(doc.output('blob'), baseName(visit) + '.pdf');
}

// ---------- Säkerhetskopia ----------

export async function exportBackup(visit) {
  const photos = await photosForVisit(visit.id);
  const blob = new Blob([JSON.stringify({ kind: 'matverktyg-besok', version: 1, visit, photos })],
    { type: 'application/json' });
  await shareOrDownload(blob, baseName(visit) + '.json');
}

/** Läser in en säkerhetskopia som ett nytt besök. Ett befintligt besök skrivs aldrig över. */
export async function importBackup(text) {
  let data;
  try { data = JSON.parse(text); } catch { throw new Error('Filen går inte att läsa.'); }
  if (data?.kind !== 'matverktyg-besok' || !data.visit || !Array.isArray(data.visit.rooms)) {
    throw new Error('Filen är inte en säkerhetskopia av ett besök.');
  }
  const visit = data.visit;
  visit.template = { ...validateTemplate(visit.template) };
  visit.id = uid();
  visit.updated = Date.now();
  await putVisit(visit);
  for (const p of data.photos || []) {
    if (typeof p.data === 'string' && p.data.startsWith('data:image/')) {
      await putPhoto({ ...p, id: uid(), visitId: visit.id });
    }
  }
  return visit;
}

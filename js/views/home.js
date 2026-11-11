// Startsidan: lista över besök på den här enheten.
import { listVisits, putVisit } from '../db.js';
import { importBackup } from '../export.js';
import { computeSummary } from '../summary.js';
import { getTemplate } from '../template.js';
import { fmtNum, h, openDialog, pickTextFile, toast, today, uid } from '../util.js';

export async function homeView(app) {
  app.setHeader({ title: 'Kundbesök' });
  const visits = (await listVisits()).sort((a, b) => b.updated - a.updated);

  app.show(
    h('button', { class: 'btn primary big', onclick: () => newVisit(app) }, '+ Nytt besök'),
    visits.length
      ? h('div', { class: 'list' }, visits.map((v) => {
        const s = computeSummary(v);
        return h('a', { class: 'card link-card', href: `#/visit/${v.id}` },
          h('div', { class: 'card-title' }, v.customer || 'Namnlöst besök'),
          h('div', { class: 'muted' }, [v.address, v.date].filter(Boolean).join(' · ')),
          h('div', { class: 'meta' },
            h('span', {}, `${s.roomCount} rum`),
            h('span', {}, `${fmtNum(s.totalArea)} m²`),
            s.missing.length ? h('span', { class: 'badge warn' }, `${s.missing.length} saknas`) : h('span', { class: 'badge ok' }, 'Komplett')));
      }))
      : h('p', { class: 'empty' }, 'Inga besök ännu. Tryck på Nytt besök för att börja.'),
    h('p', { class: 'muted center' }, 'Allt sparas automatiskt på den här enheten och fungerar utan internet.'),
    h('div', { class: 'row' },
      h('button', {
        class: 'btn',
        onclick: async () => {
          const text = await pickTextFile('.json,application/json');
          if (!text) return;
          try {
            const visit = await importBackup(text);
            app.go(`#/visit/${visit.id}`);
          } catch (e) {
            toast(e.message);
          }
        },
      }, 'Läs in säkerhetskopia'),
      h('a', { class: 'btn', href: '#/mall' }, 'Mall och frågor')));
}

async function newVisit(app) {
  const template = getTemplate();
  const customer = h('input', { type: 'text', placeholder: 'Företag eller objekt' });
  const type = h('select', {},
    h('option', { value: '' }, 'Välj …'),
    template.objectTypes.map((o) => h('option', { value: o.id }, o.label)));
  const visit = await openDialog({
    title: 'Nytt besök',
    okLabel: 'Starta',
    body: [
      h('label', { class: 'field' }, h('div', { class: 'field-label' }, 'Kund'), customer),
      h('label', { class: 'field' },
        h('div', { class: 'field-label' }, 'Objektstyp'),
        h('div', { class: 'field-help' }, 'Styr vilka frågor som visas. Går att ändra senare.'),
        type),
    ],
    onOk: () => {
      if (!type.value) throw new Error('Välj en objektstyp.');
      return {
        id: uid(), created: Date.now(), updated: Date.now(),
        customer: customer.value.trim(), address: '', date: today(),
        seller: localStorage.getItem('seller') || '',
        objectTypeId: type.value,
        template: structuredClone(template),
        values: {}, customFields: [], notes: '', rooms: [],
      };
    },
  });
  if (!visit) return;
  await putVisit(visit);
  app.go(`#/visit/${visit.id}`);
}

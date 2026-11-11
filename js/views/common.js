// Delar som används av både objektvyn och rumsvyn.
import { renderField } from '../fields.js';
import { bySection } from '../template.js';
import { h, openDialog, uid } from '../util.js';

/** Frågorna som kort, grupperade under mallens rubriker. */
export function fieldCards(fields, values, changed) {
  return bySection(fields).map(([section, list]) =>
    h('section', { class: 'card' },
      section && h('h3', {}, section),
      list.map((f) => renderField(f, values[f.id], (v) => { values[f.id] = v; changed(); }))));
}

/**
 * Egna fält som säljaren lägger till på plats när mallen inte räcker.
 * @param owner besöket eller rummet, med customFields och values
 */
export function customFieldsCard(owner, changed) {
  owner.customFields ||= [];
  const list = h('div', {});
  const draw = () => list.replaceChildren(...owner.customFields.map((f) =>
    h('div', { class: 'custom-field' },
      renderField(f, owner.values[f.id], (v) => { owner.values[f.id] = v; changed(); }),
      h('button', {
        type: 'button', class: 'icon-btn', 'aria-label': `Ta bort ${f.label}`,
        onclick: () => {
          if (!confirm(`Ta bort det egna fältet "${f.label}"?`)) return;
          owner.customFields = owner.customFields.filter((x) => x !== f);
          delete owner.values[f.id];
          draw();
          changed();
        },
      }, '✕'))));
  draw();
  return h('section', { class: 'card' },
    h('h3', {}, 'Egna fält'),
    h('p', { class: 'muted' }, 'Lägg till en egen fråga när mallen inte räcker till.'),
    list,
    h('button', {
      type: 'button', class: 'btn small',
      onclick: async () => {
        const field = await customFieldDialog();
        if (!field) return;
        owner.customFields.push(field);
        draw();
        changed();
      },
    }, '+ Eget fält'));
}

function customFieldDialog() {
  const label = h('input', { type: 'text', required: true, placeholder: 't.ex. Antal whiteboards' });
  const type = h('select', {},
    h('option', { value: 'text' }, 'Text'),
    h('option', { value: 'number' }, 'Tal'),
    h('option', { value: 'yesno' }, 'Ja / Nej'));
  return openDialog({
    title: 'Eget fält',
    okLabel: 'Lägg till',
    body: [
      h('label', { class: 'field' }, h('div', { class: 'field-label' }, 'Fråga / rubrik'), label),
      h('label', { class: 'field' }, h('div', { class: 'field-label' }, 'Typ av svar'), type),
    ],
    onOk: () => {
      if (!label.value.trim()) throw new Error('Skriv en rubrik.');
      return { id: 'c_' + uid(), label: label.value.trim(), type: type.value, custom: true };
    },
  });
}

export function notesCard(owner, changed) {
  return h('section', { class: 'card' },
    h('h3', {}, 'Anteckningar'),
    h('textarea', {
      rows: 4, value: owner.notes || '', 'aria-label': 'Anteckningar',
      oninput: (e) => { owner.notes = e.target.value; changed(); },
    }));
}

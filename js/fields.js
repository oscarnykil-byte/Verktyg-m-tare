// Ritar ett formulärfält utifrån en fråga i mallen och rapporterar ändringar.
import { h, uid, parseNum, round } from './util.js';

const inputText = (n) => (n == null ? '' : String(n).replace('.', ','));

/**
 * @param field    frågan från mallen
 * @param value    nuvarande värde
 * @param onChange anropas med nytt värde vid varje ändring
 */
export function renderField(field, value, onChange, { compact = false } = {}) {
  const control = controls[field.type](field, value, onChange);
  return h('div', { class: `field field-${field.type}${compact ? ' compact' : ''}`, dataset: { field: field.id } },
    h('div', { class: 'field-label' },
      h('span', {}, field.label),
      field.required && h('span', { class: 'req', title: 'Obligatorisk' }, ' *')),
    field.help && h('div', { class: 'field-help' }, field.help),
    control);
}

const controls = {
  text: (f, v, onChange) =>
    h('input', { type: 'text', value: v ?? '', oninput: (e) => onChange(e.target.value) }),

  note: (f, v, onChange) =>
    h('textarea', { rows: 3, value: v ?? '', oninput: (e) => onChange(e.target.value) }),

  number: (f, v, onChange) =>
    h('div', { class: 'with-unit' },
      h('input', {
        type: 'text', inputMode: 'decimal', value: inputText(v),
        oninput: (e) => onChange(parseNum(e.target.value)),
      }),
      f.unit && h('span', { class: 'unit' }, f.unit)),

  // Yta: skriv m² direkt, eller längd och bredd så räknas ytan ut.
  area: (f, v, onChange) => {
    const val = { l: null, w: null, a: null, ...(v || {}) };
    const mk = (key, label, unit) => {
      const input = h('input', {
        type: 'text', inputMode: 'decimal', value: inputText(val[key]), 'aria-label': label,
        oninput: () => {
          val[key] = parseNum(input.value);
          if (key === 'a') {
            // Direkt angiven yta gäller, längd och bredd stämmer då inte längre.
            val.l = val.w = null;
            inputs.l.value = inputs.w.value = '';
          } else if (val.l > 0 && val.w > 0) {
            val.a = round(val.l * val.w);
            inputs.a.value = inputText(val.a);
          }
          onChange({ ...val });
        },
      });
      return input;
    };
    const inputs = { l: mk('l', 'Längd', 'm'), w: mk('w', 'Bredd', 'm'), a: mk('a', 'Yta', 'm²') };
    const cell = (label, input, unit) =>
      h('label', { class: 'area-cell' }, h('span', { class: 'area-cap' }, label),
        h('div', { class: 'with-unit' }, input, h('span', { class: 'unit' }, unit)));
    return h('div', { class: 'area' },
      cell('Längd', inputs.l, 'm'),
      h('span', { class: 'area-op' }, '×'),
      cell('Bredd', inputs.w, 'm'),
      h('span', { class: 'area-op' }, '='),
      cell('Yta', inputs.a, 'm²'));
  },

  counter: (f, v, onChange) => {
    const min = f.min ?? 0;
    let n = typeof v === 'number' ? v : min;
    const input = h('input', {
      type: 'text', inputMode: 'numeric', value: String(n), 'aria-label': f.label,
      oninput: () => { n = Math.max(min, Math.round(parseNum(input.value) ?? min)); onChange(n); },
      onchange: () => { input.value = String(n); },
      onfocus: () => input.select(),
    });
    const step = (d) => () => { n = Math.max(min, n + d); input.value = String(n); onChange(n); };
    return h('div', { class: 'counter' },
      h('button', { type: 'button', class: 'step', onclick: step(-1), 'aria-label': 'Minska' }, '−'),
      input,
      h('button', { type: 'button', class: 'step', onclick: step(1), 'aria-label': 'Öka' }, '+'));
  },

  yesno: (f, v, onChange) => chips(['Ja', 'Nej'], v == null ? [] : [v ? 'Ja' : 'Nej'], (sel) =>
    onChange(sel.length ? sel[0] === 'Ja' : null), false),

  choice: (f, v, onChange) => {
    // Okända värden (t.ex. ett alternativ som tagits bort ur mallen) visas ändå.
    const options = v && !f.options.includes(v) ? [...f.options, v] : f.options;
    if (options.length > 8) {
      return h('select', { onchange: (e) => onChange(e.target.value || null) },
        h('option', { value: '' }, 'Välj …'),
        options.map((o) => h('option', { value: o, selected: o === v }, o)));
    }
    return chips(options, v ? [v] : [], (sel) => onChange(sel[0] ?? null), false);
  },

  multi: (f, v, onChange) => {
    const extra = (v || []).filter((x) => !f.options.includes(x));
    return chips([...f.options, ...extra], v || [], onChange, true);
  },

  group: (f, v, onChange) => {
    const rows = (v || []).map((r) => ({ ...r }));
    const list = h('div', { class: 'group-rows' });
    const emit = () => onChange(rows.map((r) => ({ ...r })));
    const draw = () => {
      list.replaceChildren(...rows.map((row, i) =>
        h('div', { class: 'group-row' },
          h('div', { class: 'group-row-head' },
            h('span', {}, `${f.label} ${i + 1}`),
            h('button', {
              type: 'button', class: 'icon-btn', 'aria-label': 'Ta bort rad',
              onclick: () => { rows.splice(i, 1); draw(); emit(); },
            }, '✕')),
          f.subfields.map((s) => renderField(s, row[s.id], (val) => { row[s.id] = val; emit(); }, { compact: true })))));
    };
    draw();
    return h('div', { class: 'group' }, list,
      h('button', {
        type: 'button', class: 'btn small',
        onclick: () => { rows.push({ _id: uid() }); draw(); emit(); },
      }, `+ Lägg till ${f.label.toLowerCase()}`));
  },
};

function chips(options, selected, onChange, multiple) {
  let sel = [...selected];
  const wrap = h('div', { class: 'chips', role: 'group' });
  const draw = () => wrap.replaceChildren(...options.map((o) =>
    h('button', {
      type: 'button', class: 'chip' + (sel.includes(o) ? ' on' : ''), 'aria-pressed': String(sel.includes(o)),
      onclick: () => {
        if (multiple) sel = sel.includes(o) ? sel.filter((x) => x !== o) : [...sel, o];
        else sel = sel.includes(o) ? [] : [o];
        draw();
        onChange([...sel]);
      },
    }, o)));
  draw();
  return wrap;
}

// Små hjälpfunktioner som används i hela appen.

/** Skapar ett DOM-element: h('button', {class: 'btn', onclick: fn}, 'Text') */
export function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k in el && k !== 'list' && k !== 'form') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  append(el, kids);
  return el;
}

export function append(el, kids) {
  for (const kid of kids) {
    if (kid == null || kid === false) continue;
    if (Array.isArray(kid)) append(el, kid);
    else el.append(kid.nodeType ? kid : String(kid));
  }
}

export const uid = () =>
  Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

export function debounce(fn, ms) {
  let timer = null;
  const run = (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => { timer = null; fn(...args); }, ms);
  };
  run.flush = () => {
    if (timer) { clearTimeout(timer); timer = null; return fn(); }
  };
  return run;
}

export const today = () => {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
};

/** Tolkar tal skrivna med komma eller punkt. Tomt eller ogiltigt ger null. */
export function parseNum(s) {
  if (typeof s === 'number') return Number.isFinite(s) ? s : null;
  if (s == null) return null;
  const t = String(s).replace(/\s/g, '').replace(',', '.');
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

export const round = (n, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

/** Tal på svenskt vis: 1 234,5 */
export function fmtNum(n, d = 2) {
  if (n == null || !Number.isFinite(n)) return '';
  return round(n, d).toLocaleString('sv-SE', { maximumFractionDigits: d });
}

export function fileSafe(s) {
  return String(s || '').trim().replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, '_').slice(0, 60) || 'besok';
}

/** Delar filen via mobilens delningsmeny om det går, annars laddas den ned. */
export async function shareOrDownload(blob, filename) {
  const file = new File([blob], filename, { type: blob.type });
  const touch = matchMedia('(pointer: coarse)').matches;
  if (touch && navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: filename });
      return;
    } catch (e) {
      if (e.name === 'AbortError') return;
      // Annars: fall tillbaka på nedladdning.
    }
  }
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

/** Låter användaren välja en fil och returnerar dess text. */
export function pickTextFile(accept) {
  return new Promise((resolve) => {
    const input = h('input', { type: 'file', accept });
    input.addEventListener('change', async () => {
      const f = input.files[0];
      resolve(f ? await f.text() : null);
    });
    input.click();
  });
}

const loaded = {};
export function loadScript(src) {
  return (loaded[src] ??= new Promise((resolve, reject) => {
    const s = h('script', { src });
    s.onload = resolve;
    s.onerror = () => { delete loaded[src]; reject(new Error('Kunde inte ladda ' + src)); };
    document.head.append(s);
  }));
}

let toastTimer;
export function toast(msg) {
  let el = document.getElementById('toast');
  if (!el) {
    el = h('div', { id: 'toast', role: 'status' });
    document.body.append(el);
  }
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3000);
}

/** Öppnar en dialogruta. Löses med returvärdet från onOk, eller null vid avbryt. */
export function openDialog({ title, body, okLabel = 'Spara', onOk }) {
  return new Promise((resolve) => {
    const error = h('p', { class: 'dialog-error' });
    const dlg = h('dialog', { class: 'dialog' },
      h('form', {
        method: 'dialog',
        onsubmit: (e) => {
          e.preventDefault();
          try {
            const result = onOk ? onOk() : true;
            dlg.close();
            resolve(result);
          } catch (err) {
            error.textContent = err.message;
          }
        },
      },
        h('h2', {}, title),
        h('div', { class: 'dialog-body' }, body),
        error,
        h('div', { class: 'dialog-actions' },
          h('button', { type: 'button', class: 'btn', onclick: () => { dlg.close(); resolve(null); } }, 'Avbryt'),
          h('button', { type: 'submit', class: 'btn primary' }, okLabel))));
    dlg.addEventListener('cancel', () => resolve(null));
    dlg.addEventListener('close', () => dlg.remove());
    document.body.append(dlg);
    dlg.showModal();
  });
}

// Start och navigering. Adressen efter # avgör vilken vy som visas.
import { initTemplate } from './template.js';
import { append, h } from './util.js';
import { homeView } from './views/home.js';
import { roomView } from './views/room.js';
import { templateView } from './views/template-editor.js';
import { visitView } from './views/visit.js';

const bar = document.getElementById('bar');
const main = document.getElementById('main');
const tabs = document.getElementById('tabs');

const app = {
  /** Visar innehåll i vyn. Tar element, listor av element och hoppar över tomma värden. */
  show: (...kids) => append(main, kids),
  onLeave: null, // vyn sätter denna för att spara det sista innan man lämnar
  setHeader({ title, back }) {
    bar.replaceChildren(
      back ? h('a', { class: 'back', href: back, 'aria-label': 'Tillbaka' }, '‹') : h('span', { class: 'back-spacer' }),
      h('h1', { id: 'title' }, title));
    document.title = title;
  },
  setTitle(title) {
    const el = document.getElementById('title');
    if (el) el.textContent = title;
  },
  setTabs(items) {
    tabs.hidden = false;
    tabs.replaceChildren(...items.map((t) =>
      h('a', { class: 'tab' + (t.active ? ' active' : ''), href: t.href, 'aria-current': t.active ? 'page' : null }, t.label)));
  },
  go(hash) {
    if (location.hash === hash) render(); else location.hash = hash;
  },
  reload: () => render(),
};

const routes = [
  [/^#\/visit\/([^/]+)\/room\/([^/]+)$/, (m) => roomView(app, { id: m[1], roomId: m[2] })],
  [/^#\/visit\/([^/]+)(?:\/(objekt|rum|summering))?$/, (m) => visitView(app, { id: m[1], tab: m[2] })],
  [/^#\/mall$/, () => templateView(app)],
  [/.*/, () => homeView(app)],
];

let renderId = 0;
async function render() {
  const mine = ++renderId;
  try {
    if (app.onLeave) await app.onLeave();
  } catch (e) {
    console.error(e);
  }
  if (mine !== renderId) return;
  app.onLeave = null;
  main.replaceChildren();
  tabs.replaceChildren();
  tabs.hidden = true;
  window.scrollTo(0, 0);
  const hash = location.hash || '#/';
  for (const [pattern, view] of routes) {
    const m = hash.match(pattern);
    if (!m) continue;
    try {
      await view(m);
    } catch (e) {
      console.error(e);
      main.replaceChildren(h('p', { class: 'empty' }, 'Något gick fel: ' + e.message),
        h('a', { class: 'btn', href: '#/' }, 'Till startsidan'));
    }
    break;
  }
}

window.addEventListener('hashchange', render);
// Spara direkt om appen läggs i bakgrunden eller stängs.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden' && app.onLeave) app.onLeave();
});

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch((e) => console.warn('Offline-stöd kunde inte aktiveras', e));
}
// Be webbläsaren att inte rensa lagrade besök vid platsbrist.
navigator.storage?.persist?.().catch(() => {});

initTemplate().then(render, (e) => {
  main.replaceChildren(h('p', { class: 'empty' }, e.message));
});

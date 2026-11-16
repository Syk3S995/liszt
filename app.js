import { CONFIG } from './config.js';
import * as store from './store.js';
import * as sync from './sync.js';
import * as backend from './backend.js';
import { icon, CAT_ICONS, catIconName, PERSON_ICONS, personIconName, TEMPLATE_ICONS, templateIconName } from './icons.js';
import { buildSections, groupByCategory, categoryOrder, suggestions, defaultStoresForView, renumber, safeColor,
  UNITS, formatQty, stepQty, journal, frequent, dayKey, parseSmart, entityKeys, templatePlan, templateItemsFrom, mergeSections,
  findDuplicate, addQty, findProduct } from './logic.js';

const $app = document.getElementById('app');
const ALL_VIEW = { id: '__all', name: 'Összes', all: true, stores: [], include_unassigned: true, show_others: true, show_people: true };
const ls = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* nincs tárhely */ } },
};
const desktop = matchMedia('(min-width: 900px)');
desktop.addEventListener('change', () => render());

let viewId = ls.get('viewId') || '__all';
let personFilter = ls.get('person') || '';
let page = 'list';                 // 'list' | 'journal' | 'manage' | 'template'
let manageTab = 'categories';      // 'categories' | 'stores' | 'people' | 'views' | 'templates'
let templateId = '';               // a megnyitott sablon (page === 'template')
let journalDays = 14;              // ennyi napot mutat a napló (a „Régebbiek” növeli)
let needLogin = false;
let lastAddedId = null;

// ---- DOM segéd: kizárólag textContent / property, soha innerHTML (XSS ellen) ----
function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k in el) { try { el[k] = v; } catch { el.setAttribute(k, v); } } // pl. input.list csak olvasható
    else el.setAttribute(k, v);
  }
  for (const c of children.flat(Infinity)) if (c != null && c !== false) el.append(c.nodeType ? c : document.createTextNode(String(c)));
  return el;
}

/** Rövid visszajelzés; opcionálisan egy művelettel (pl. Visszavonás). */
let toastTimer;
function toast(msg, action) {
  let t = document.getElementById('toast');
  if (!t) { t = h('div', { id: 'toast', role: 'status', 'aria-live': 'polite' }); document.body.append(t); }
  t.replaceChildren(...[h('span', {}, msg), action ? h('button', { class: 'toastbtn', onclick: () => { t.classList.remove('show'); action.fn(); } }, action.label) : null].filter(Boolean));
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), action ? 6000 : 2200);
}

// ---- Adat-segédek ----
const me = () => (backend.enabled() ? (sync.getAuth() || {}).personId || '' : 'en');
const byName = (a, b) => a.name.localeCompare(b.name, 'hu');
const bySort = (a, b) => (a.sort - b.sort) || byName(a, b);
const live = (t) => store.list(t).filter((r) => !r.deleted);
const cats = () => live('Categories').sort(bySort);
const storesList = () => live('Stores').sort(bySort);
/** Címzettek: saját magam elöl, utána a többi (sorrend, majd név szerint). */
const peopleList = () => live('People').sort((a, b) => (a.id === me() ? -1 : b.id === me() ? 1 : bySort(a, b)));
const catOrder = () => categoryOrder(store.list('Categories'));
const storeById = (id) => store.state.Stores.get(id);
const storeName = (id) => (storeById(id) && !storeById(id).deleted ? storeById(id).name : null);
const personById = (id) => store.state.People.get(id);
const personName = (id) => (personById(id) || { name: id }).name;
const authEmail = () => (sync.getAuth() || {}).email || '';
const isOpen = (i) => !i.deleted && !(i.bought_at > 0);
const nameKey = (s) => String(s).trim().toLocaleLowerCase('hu');

function currentView() {
  if (viewId === '__all') return ALL_VIEW;
  const v = store.state.Views.get(viewId);
  if (!v || v.deleted) { viewId = '__all'; return ALL_VIEW; }
  return v;
}
function sectionsFor(view, items = store.list('Items')) {
  return buildSections(items, view, me(), { person: personFilter || null, catOrder: catOrder() });
}
const openCount = (s) => s.here.length + s.elsewhere.length + s.people.length;

async function saveRow(t, row) { const r = await store.save(t, row, authEmail()); sync.localChanged(); return r; }
async function saveItem(it) { return saveRow('Items', it); }

function slug(name, taken) {
  let s = String(name).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30);
  if (!s || taken.has(s)) s = (s || 'x') + '-' + store.uuid().slice(0, 4);
  return s;
}

/**
 * Előtöltés egy névhez: a terméklista (alap) + a saját előzmények (szokások).
 * - név: a terméklista szerinti (így „krumpli” → „Burgonya”, és nem lesz két külön tétel)
 * - kategória, egység: elsősorban a terméklistából (az a mérvadó, a Kezelésben szerkeszthető)
 * - bolt: elsősorban az előzményből (ahol legutóbb vetted), különben a terméklista alapboltja
 * -> {name, category, unit, stores, product} vagy null, ha semmit nem ismerünk róla
 */
function remembered(name) {
  const prod = findProduct(store.list('Products'), name);
  const k = nameKey(prod ? prod.name : name);
  let hist = null;
  for (const it of store.list('Items')) if (nameKey(it.name) === k && (!hist || it.updated_at > hist.updated_at)) hist = it;
  if (!prod && !hist) return null;
  const catIds = cats().map((c) => c.id);
  return {
    name: prod ? prod.name : hist.name,
    category: [prod && prod.category, hist && hist.category].find((c) => c && catIds.includes(c)) || '',
    unit: (prod && prod.unit) || (hist && hist.unit) || '',
    stores: ((hist && hist.stores.length ? hist.stores : prod ? prod.stores : []) || []).filter(storeName),
    product: prod,
  };
}

/**
 * A terméklista tanul: új név → új termék; a szerkesztőben kézzel állított kategória/egység → a termék is frissül.
 * (Így legközelebb már jó kategóriával jön elő.)
 */
async function learnProduct(item, explicit) {
  const products = store.list('Products');
  const prod = findProduct(products, item.name);
  if (!prod) {
    const id = 'p-' + slug(item.name, new Set(products.map((p) => p.id.replace(/^p-/, ''))));
    await saveRow('Products', { id, name: item.name, category: item.category || '', unit: item.unit || '', stores: [], keywords: '', deleted: false });
  } else if (explicit && ((item.category && item.category !== prod.category) || (item.unit && item.unit !== prod.unit))) {
    await saveRow('Products', { ...prod, category: item.category || prod.category, unit: item.unit || prod.unit });
  }
}

/** Alap terméklista feltöltése – egyszer, és csak ha még üres (szinkron módban az első sikeres szinkron után). */
let seedingCatalog = false;
async function maybeSeedCatalog() {
  if (seedingCatalog || store.getMeta('catalogSeeded', false)) return;
  seedingCatalog = true;
  try {
    if (!store.list('Products').length) {
      const { DEFAULT_PRODUCTS } = await import('./catalog.js');
      const catIds = new Set(store.list('Categories').map((c) => c.id));
      const base = (n) => String(n).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
      // determinisztikus id: ha két eszköz egyszerre töltene fel, ugyanazokat a sorokat írják (nincs duplikátum)
      const rows = DEFAULT_PRODUCTS.map(([name, cat, unit, kw]) => ({ id: 'p-' + base(name), name, category: catIds.has(cat) ? cat : '', unit, stores: [], keywords: kw, deleted: false }));
      if (backend.enabled()) { await store.saveMany('Products', rows, authEmail()); sync.localChanged(); }
      else for (const r of rows) await store.putLocal('Products', r);
    }
    await store.setMeta('catalogSeeded', true);
  } finally { seedingCatalog = false; }
}

// ---- Betöltés ----
async function seedIfEmpty() {
  if (backend.enabled() || store.list('Items').length || store.list('Stores').length || store.list('Categories').length) return;
  const seed = await (await fetch('seed.json')).json();
  const x = Date.now();
  for (const t of store.TABLES) for (const r of seed[t] || []) await store.putLocal(t, { ...r, updated_at: x });
}

// ---- Render ----
function render() {
  closeNavPop();   // újrarajzoláskor a felugró menü (a body-ban lóg) ne maradjon árván nyitva
  if (needLogin) return renderLogin();
  const view = currentView();
  const sec = sectionsFor(view);
  const isDesk = desktop.matches;
  const active = document.activeElement;
  // a gyors beviteli mezők (lista: #q, sablon: #tq) értéke és fókusza túlélje az újrarajzolást
  const keepQuick = active && (active.id === 'q' || active.id === 'tq' || active.id === 'pq') ? { id: active.id, v: active.value, s: active.selectionStart } : null;

  const content = page === 'manage' ? manageView() : page === 'journal' ? journalView() : page === 'template' ? templateView()
    : page === 'account' ? accountView() : listView(view, sec);
  $app.replaceChildren(...[
    topbar(isDesk, view),
    h('div', { class: 'layout' }, isDesk ? sidebar(view) : null, h('main', { class: 'content' }, content)),
    isDesk ? null : bottomNav(),
  ].filter(Boolean));
  revealActiveTabs();
  if (keepQuick) {
    const q = document.getElementById(keepQuick.id);
    if (q) { q.value = keepQuick.v; q.focus(); q.setSelectionRange(keepQuick.s, keepQuick.s);
      // csak a lista mezőjénél kell újraszámolni az előnézetet (a keresőmező input-eseménye újrarajzolna → végtelen ciklus)
      if (keepQuick.id === 'q') q.dispatchEvent(new Event('input')); }
  }
}

/** A fülsávban az aktív fül legyen látható (középre görgetve), és jelezzük, ha a sáv tovább görgethető. */
function revealActiveTabs() {
  document.querySelectorAll('.tabs, .chips:not(.wrap)').forEach((t) => {
    const a = t.querySelector('.active');
    if (a && t.scrollWidth > t.clientWidth) t.scrollLeft = Math.max(0, a.offsetLeft - (t.clientWidth - a.offsetWidth) / 2);
    const mark = () => {
      t.classList.toggle('more-right', t.scrollLeft + t.clientWidth < t.scrollWidth - 2);
      t.classList.toggle('more-left', t.scrollLeft > 2);
    };
    mark();
    t.addEventListener('scroll', mark, { passive: true });
  });
}

function syncPill() {
  const st = sync.getStatus();
  const ic = { ok: 'cloudOk', syncing: 'sync', pending: 'cloudUp', offline: 'cloudOff', error: 'err', auth: 'err', local: 'cloudOff' }[st.kind] || 'cloudOk';
  return h('button', { class: 'iconbtn pill ' + st.kind, onclick: openMenu, title: st.text, 'aria-label': 'Szinkron: ' + st.text }, icon(ic, 20),
    h('span', { class: 'desktop-only' }, st.text));
}

function pageTitle(view) {
  if (page === 'manage') return 'Kezelés';
  if (page === 'journal') return 'Napló';
  if (page === 'account') return 'Fiók';
  if (page === 'template') return (store.state.Templates.get(templateId) || { name: 'Sablon' }).name;
  return personFilter ? personName(personFilter) + ' listája' : view.name;
}

function topbar(isDesk, view) {
  const initial = personName(me()).slice(0, 1).toUpperCase() || '?';
  return h('header', { class: 'topbar' },
    isDesk ? h('div', { class: 'brand' }, h('img', { class: 'logo', src: 'icons/logo.svg', alt: '' }), 'Liszt')
      : h('div', { class: 'pagetitle' }, h('img', { class: 'logo', src: 'icons/logo.svg', alt: '' }),
        // mobilon a lista címére koppintva is a listaválasztó nyílik
        page === 'list' ? h('button', { class: 'titlebtn', 'aria-label': 'Lista választása: ' + pageTitle(view), onclick: (e) => openListPicker(e.currentTarget) },
          h('span', { class: 'tt' }, pageTitle(view)), icon('down', 16)) : pageTitle(view)),
    isDesk ? h('div', { class: 'grow' }) : null,
    syncPill(),
    h('button', { class: 'avatar', onclick: openMenu, 'aria-label': 'Menü' }, initial));
}

function go(p, extra) { page = p; if (extra) extra(); render(); window.scrollTo(0, 0); }

// ---- Navigáció (a Raktár app mintájára) ----
// A menüpontok sorrendje a Fiók oldalon állítható (ezen az eszközön). Mobilon az első NAV_MAX van az alsó sávban,
// a többi a „Több” gomb mögött. Asztalon az oldalsáv „Egyéb” csoportja is ezt a sorrendet követi.
const NAV = [
  { key: 'list', label: 'Lista', icon: 'list' },
  { key: 'cart', label: 'Kosár', icon: 'cart' },
  { key: 'journal', label: 'Napló', icon: 'book' },
  { key: 'templates', label: 'Sablonok', icon: 'template' },
  { key: 'manage', label: 'Kezelés', icon: 'sliders' },
  { key: 'account', label: 'Fiók', icon: 'user' },
];
const NAV_MAX = 4;
function navOrder() {
  let own = [];
  try { own = JSON.parse(ls.get('navOrder') || '[]'); } catch { own = []; }
  if (!Array.isArray(own)) own = [];
  const pos = (k) => { const i = own.indexOf(k); return i < 0 ? own.length + NAV.findIndex((n) => n.key === k) : i; };
  return [...NAV].sort((a, b) => pos(a.key) - pos(b.key));
}
const setNavOrder = (keys) => ls.set('navOrder', keys ? JSON.stringify(keys) : '');
function navActive(key) {
  return { list: page === 'list', cart: false, journal: page === 'journal', account: page === 'account',
    templates: page === 'template' || (page === 'manage' && manageTab === 'templates'),
    manage: page === 'manage' && manageTab !== 'templates' }[key];
}
function navGo(key) {
  if (key === 'cart') {
    page = 'list'; render();
    const el = document.getElementById('cart-section');
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); else toast('A kosár üres');
  } else if (key === 'templates') go('manage', () => { manageTab = 'templates'; });
  else if (key === 'manage') go('manage', () => { if (manageTab === 'templates') manageTab = 'products'; });
  else go(key);
}
const cartCount = () => store.list('Items').filter((i) => isOpen(i) && i.checked).length;

/** Nézet ikonja: bolt ikon a nézet (első) boltjának színével; az „Összes” lista ikonnal. */
function viewBadge(v, size = 16) {
  if (v.all) return h('span', { class: 'caticon plain', 'aria-hidden': 'true' }, icon('list', size));
  const s = (v.stores || []).map(storeById).find((x) => x && !x.deleted);
  return tintBadge('store', s && s.color, size);
}

// ---- Felugró menü az alsó sáv (vagy a gomb) fölött: nem takarja el a navigációt ----
let navPop = null;
function closeNavPop() { if (navPop) { navPop.remove(); navPop = null; } }
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeNavPop(); });
/**
 * anchor: a gomb, amihez igazodik. Ha a gomb a képernyő alsó felén van (alsó sáv), fölötte nyílik; különben alatta.
 * A háttér-réteg csak a sáv fölötti részt fedi, így az alsó sáv gombjai továbbra is használhatók.
 */
function navPopover(anchor, content, key) {
  if (navPop && navPop.dataset.key === key) { closeNavPop(); return; }   // ugyanarra a gombra újra: bezár
  closeNavPop();
  const nav = document.querySelector('.bottomnav');
  const navH = nav && getComputedStyle(nav).display !== 'none' ? nav.offsetHeight : 0;
  const back = h('div', { class: 'navpop-back', onclick: closeNavPop });
  back.style.bottom = navH + 'px';
  const pop = h('div', { class: 'navpop', role: 'menu' }, content);
  const wrap = h('div', {}, back, pop);
  wrap.dataset.key = key;
  document.body.append(wrap);
  navPop = wrap;
  const r = anchor.getBoundingClientRect();
  const vw = innerWidth, vh = innerHeight;
  const w = Math.min(320, vw - 16);
  pop.style.width = w + 'px';
  pop.style.left = Math.max(8, Math.min(r.left + r.width / 2 - w / 2, vw - w - 8)) + 'px';
  if (r.top > vh / 2) {
    pop.style.bottom = (vh - Math.min(r.top, vh - navH) + 8) + 'px';
    pop.style.maxHeight = Math.min(420, Math.min(r.top, vh - navH) - 72) + 'px';
  } else {
    pop.style.top = (r.bottom + 8) + 'px';
    pop.style.maxHeight = Math.min(420, vh - navH - r.bottom - 24) + 'px';
  }
}
const popItem = (lead, label, count, sel, onclick) => h('button', { class: 'moreitem' + (sel ? ' sel' : ''), role: 'menuitem', onclick },
  lead, h('span', { class: 'grow' }, label), count ? h('span', { class: 'n' }, count) : null);

/** Listaválasztó: nézetek és címzettek listái, ikonnal és nyitott tételszámmal; görgethető. */
function openListPicker(anchor) {
  const items = store.list('Items');
  const pick = (fn) => { closeNavPop(); go('list', fn); };
  navPopover(anchor, [
    h('div', { class: 'poptitle' }, 'Nézetek'),
    [ALL_VIEW, ...live('Views').sort(bySort)].map((v) => popItem(viewBadge(v, 18), v.name, openCount(buildSections(items, v, me(), { catOrder: catOrder() })),
      page === 'list' && !personFilter && v.id === viewId, () => pick(() => { personFilter = ''; viewId = v.id; ls.set('viewId', viewId); ls.set('person', ''); }))),
    h('div', { class: 'poptitle' }, 'Címzettek listái'),
    peopleList().map((p) => popItem(personBadge(p, 18), p.name, items.filter((i) => isOpen(i) && !i.checked && i.for === p.id).length,
      page === 'list' && personFilter === p.id, () => pick(() => { personFilter = p.id; ls.set('person', personFilter); }))),
  ], 'lists');
}

function sidebar(view) {
  const items = store.list('Items');
  const views = [ALL_VIEW, ...live('Views').sort(bySort)];
  // egysoros felirat „…”-tal; a teljes név súgóként (title) látszik
  const nav = (ic, label, count, on, fn) => h('button', { class: 'navitem' + (on ? ' active' : ''), onclick: fn, title: label + (count ? ` (${count})` : '') },
    ic.nodeType ? ic : icon(ic, 20), h('span', { class: 'lbl' }, label), count != null ? h('span', { class: 'n' }, count) : null);
  return h('nav', { class: 'sidebar', 'aria-label': 'Fő navigáció' },
    h('div', { class: 'grouptitle' }, 'Nézetek'),
    views.map((v) => nav(viewBadge(v), v.name, openCount(buildSections(items, v, me(), { catOrder: catOrder() })),
      page === 'list' && !personFilter && v.id === view.id, () => go('list', () => { personFilter = ''; viewId = v.id; ls.set('viewId', viewId); ls.set('person', ''); }))),
    h('div', { class: 'grouptitle' }, 'Címzettek'),
    peopleList().map((p) => nav(personBadge(p, 16), p.name, items.filter((i) => isOpen(i) && !i.checked && i.for === p.id).length,
      page === 'list' && personFilter === p.id, () => go('list', () => { personFilter = p.id; ls.set('person', personFilter); }))),
    h('div', { class: 'grouptitle' }, 'Egyéb'),
    // a lista és a kosár fent, a nézeteknél van; a többi a beállított sorrendben
    navOrder().filter((n) => n.key !== 'list' && n.key !== 'cart').map((n) =>
      nav(n.icon, n.label, n.key === 'templates' ? templatesList().length || null : null, navActive(n.key), () => navGo(n.key))));
}

function bottomNav() {
  const order = navOrder();
  const pinned = order.slice(0, NAV_MAX);
  const extra = order.slice(NAV_MAX);
  const badgeOf = (key) => (key === 'cart' ? cartCount() || null : null);
  // „Lista”: első koppintás a legutóbb használt listát nyitja; ha már azon állsz (kis ^ jelzi), újabb koppintásra a listaválasztó nyílik
  const onNav = (n, e) => {
    if (n.key === 'list' && page === 'list') { openListPicker(e.currentTarget); return; }
    closeNavPop();
    navGo(n.key);
  };
  const btn = (n) => h('button', { class: navActive(n.key) ? 'active' : '', onclick: (e) => onNav(n, e),
    'aria-label': n.key === 'list' && page === 'list' ? 'Lista választása' : n.label },
    h('span', { class: 'ind' }, icon(n.icon, 22)),
    h('span', { class: 'lbl' }, n.label, n.key === 'list' && page === 'list' ? icon('up', 12) : null),
    badgeOf(n.key) ? h('span', { class: 'badge' }, badgeOf(n.key)) : null);
  const moreOn = extra.some((n) => navActive(n.key));
  return h('nav', { class: 'bottomnav', 'aria-label': 'Fő navigáció' },
    pinned.map(btn),
    extra.length ? h('button', { class: moreOn ? 'active' : '', 'aria-label': 'További menüpontok', onclick: (e) => openMoreMenu(e.currentTarget, extra) },
      h('span', { class: 'ind' }, icon('more', 22)), 'Több',
      extra.some((n) => badgeOf(n.key)) ? h('span', { class: 'badge' }, extra.reduce((s, n) => s + (badgeOf(n.key) || 0), 0)) : null) : null);
}

/** „Több” menü: a kint nem lévő menüpontok az alsó sáv fölött, nagy, jól eltalálható sorokban. */
function openMoreMenu(anchor, extra) {
  navPopover(anchor, [
    extra.map((n) => popItem(icon(n.icon, 22), n.label, n.key === 'cart' ? cartCount() : null, navActive(n.key),
      (e) => { closeNavPop(); if (n.key === 'list' && page === 'list') openListPicker(anchor); else navGo(n.key); })),
    h('p', { class: 'muted small', style: 'margin:6px 12px 4px' }, 'A sorrend a Fiók oldalon állítható.'),
  ], 'more');
}

// ---- Fiók oldal: szinkron, kijelentkezés, menü sorrendje ----
/** „ma 14:32”, „tegnap 9:05”, „nov. 12. 18:40” – és mellé relatívan („3 perce”). */
function fmtWhen(ts, withRel = true) {
  if (!ts) return 'még nem volt';
  const d = new Date(ts);
  const t = d.toLocaleTimeString('hu-HU', { hour: '2-digit', minute: '2-digit' });
  const k = dayKey(ts);
  const day = k === dayKey(Date.now()) ? 'ma' : k === dayKey(Date.now() - 864e5) ? 'tegnap' : d.toLocaleDateString('hu-HU', { month: 'short', day: 'numeric' });
  const s = Math.round((Date.now() - ts) / 1000);
  const rel = s < 60 ? 'épp most' : s < 3600 ? Math.round(s / 60) + ' perce' : s < 86400 ? Math.round(s / 3600) + ' órája' : '';
  return day + ' ' + t + (withRel && rel ? ' (' + rel + ')' : '');
}
const TABLE_LABEL = { Items: 'Tétel', Categories: 'Kategória', Stores: 'Bolt', People: 'Címzett', Views: 'Nézet', Templates: 'Sablon', TemplateItems: 'Sablontétel', Products: 'Termék' };

function accountView() {
  const st = sync.getStatus();
  const auth = sync.getAuth();
  const info = sync.getSyncInfo();
  const queue = store.getQueue();
  const order = navOrder();
  const move = (i, j) => { const keys = order.map((n) => n.key); [keys[i], keys[j]] = [keys[j], keys[i]]; setNavOrder(keys); render(); };
  const theme = window.BevTheme ? window.BevTheme.get() : 'auto';
  const fact = (k, v, cls) => [h('dt', {}, k), h('dd', { class: cls || '' }, v)];
  const KIND = { ok: 'Sikeres', same: 'Változatlan', error: 'Hiba', auth: 'Bejelentkezés kell', offline: 'Offline' };
  return h('div', {},
    h('div', { class: 'pagehead desktop-only' }, h('h1', {}, 'Fiók')),
    h('section', { class: 'sec' },
      h('div', { class: 'sechead' }, h('span', {}, 'Fiók és szinkron')),
      h('div', { class: 'card pad' },
        h('div', { class: 'acct' }, h('span', { class: 'avatar' }, personName(me()).slice(0, 1).toUpperCase() || '?'),
          h('div', { class: 'cell' }, h('div', {}, auth ? (auth.name || personName(me())) : personName(me()) + (backend.enabled() ? '' : ' (helyi mód)')),
            h('div', { class: 'muted small' }, auth ? auth.email : ''))),
        backend.enabled() ? h('dl', { class: 'facts' },
          fact('Kapcsolat', navigator.onLine ? 'Online' : 'Offline', navigator.onLine ? '' : 'warn'),
          fact('Állapot', info.running ? 'Szinkron folyamatban…' : st.text, st.kind === 'error' || st.kind === 'auth' ? 'bad' : ''),
          fact('Utolsó sikeres szinkron', fmtWhen(info.lastOk)),
          fact('Feltöltésre vár', queue.length ? queue.length + ' változás' : 'semmi – minden fent van', queue.length ? 'warn' : ''),
          info.lastError && info.lastError.at > info.lastOk ? fact('Utolsó hiba', fmtWhen(info.lastError.at) + ' – ' + info.lastError.text, 'bad') : null,
          fact('Bejelentkezés érvényes', auth ? fmtWhen(auth.exp, false) + '-ig (használat közben magától megújul)' : '–'))
          : h('p', { class: 'muted small' }, 'Helyi (demó) mód: az adatok csak ebben a böngészőben vannak, szinkron nincs.'),
        h('div', { class: 'actions', style: 'justify-content:flex-start' },
          backend.enabled() ? [
            h('button', { class: 'btn primary', disabled: info.running, onclick: () => sync.runSync({ manual: true }) }, icon('sync', 18), info.running ? 'Szinkron…' : 'Szinkron most'),
            h('button', { class: 'btn', onclick: () => sync.runSync({ full: true }) }, 'Teljes újratöltés'),
            h('button', { class: 'btn', onclick: logout }, 'Kijelentkezés'),
          ] : h('button', { class: 'btn', onclick: async () => {
            if (!confirm('Minden helyi adat törlése és a mintaadatok visszaállítása?')) return;
            await store.wipeData(); await store.delMeta('catalogSeeded'); await seedIfEmpty(); await maybeSeedCatalog();
          } }, 'Demó adatok visszaállítása')))),
    // feltöltésre váró változások részletesen (ha van)
    backend.enabled() && queue.length ? h('section', { class: 'sec' },
      h('div', { class: 'sechead' }, h('span', {}, 'Feltöltésre vár'), h('span', { class: 'count' }, queue.length)),
      h('div', { class: 'card' }, queue.slice(0, 30).map((q) => h('div', { class: 'mrow' },
        h('div', { class: 'cell' }, h('div', {}, q.r.name || q.r.id), h('div', { class: 'muted small' }, (TABLE_LABEL[q.t] || q.t) + (q.r.deleted ? ' · törlés' : '') + ' · ' + fmtWhen(q.r.updated_at)))))),
      queue.length > 30 ? h('p', { class: 'muted small' }, `…és még ${queue.length - 30}`) : null) : null,
    h('section', { class: 'sec' },
      h('div', { class: 'sechead' }, h('span', {}, 'Megjelenés')),
      h('div', { class: 'card pad' },
        h('p', { class: 'muted small', style: 'margin:0 0 10px' }, 'Az Automatikus az eszköz világos/sötét beállítását követi. A választás csak ezen az eszközön érvényes.'),
        h('div', { class: 'chips wrap' }, [['auto', 'Automatikus'], ['light', 'Világos'], ['dark', 'Sötét']].map(([v, l]) =>
          h('button', { class: 'chip' + (theme === v ? ' active' : ''), onclick: () => { window.BevTheme.set(v); render(); } }, l))))),
    h('section', { class: 'sec' },
      h('div', { class: 'sechead' }, h('span', {}, 'Menü sorrendje'), h('span', { class: 'grow' }),
        ls.get('navOrder') ? h('button', { class: 'btn text small', onclick: () => { setNavOrder(null); render(); } }, 'Alapértelmezett') : null),
      h('p', { class: 'hint' }, `Mobilon az első ${NAV_MAX} menüpont az alsó sávban van, a többi a „Több” menüben. Asztalon az oldalsáv „Egyéb” csoportja követi ezt a sorrendet. Csak ezen az eszközön érvényes.`),
      h('div', { class: 'card' }, order.map((n, i) => [
        i === NAV_MAX ? h('div', { class: 'listsep' }, '„Több” menüben') : null,
        h('div', { class: 'mrow' }, h('span', { class: 'caticon plain' }, icon(n.icon, 16)), h('div', { class: 'cell' }, n.label),
          h('button', { class: 'iconbtn', title: 'Feljebb', 'aria-label': n.label + ' feljebb', disabled: i === 0, onclick: () => move(i, i - 1) }, icon('up', 18)),
          h('button', { class: 'iconbtn', title: 'Lejjebb', 'aria-label': n.label + ' lejjebb', disabled: i === order.length - 1, onclick: () => move(i, i + 1) }, icon('down', 18))),
      ]))),
    backend.enabled() ? syncLogSection(info, KIND) : null);
}

/** Az utolsó szinkronok (legújabb elöl): időpont, eredmény, küldött/kapott rekordok, időtartam. */
function syncLogSection(info, KIND) {
  if (!info.log.length) return null;
  const secs = (ms) => (ms / 1000).toLocaleString('hu-HU', { maximumFractionDigits: 1 }) + ' mp';
  const okRuns = info.log.filter((e) => e.kind === 'ok' || e.kind === 'same');
  const avg = okRuns.length ? secs(okRuns.reduce((s, e) => s + e.ms, 0) / okRuns.length) : '–';
  return h('section', { class: 'sec' },
    h('div', { class: 'sechead' }, h('span', {}, 'Szinkron napló'), h('span', { class: 'count' }, info.log.length)),
    h('p', { class: 'hint' }, `Az utolsó ${info.log.length} szinkron, a legújabb elöl. Átlagos idő (sikeresek): ${avg}. Küldött: innen a szerverre feltöltött változások; kapott: a szerverről letöltött rekordok.`),
    h('div', { class: 'card' }, h('table', { class: 'tbl synclog' },
      h('thead', {}, h('tr', {}, ['Időpont', 'Eredmény', 'Küldött', 'Kapott', 'Idő'].map((t, i) => h('th', { class: i > 1 ? 'num' : '' }, t)))),
      h('tbody', {}, info.log.map((e) => h('tr', {},
        h('td', { class: 'nowrap' }, fmtWhen(e.at, false)),
        h('td', { class: e.kind === 'ok' || e.kind === 'same' ? '' : 'bad' }, (KIND[e.kind] || e.kind) + (e.full ? ' (teljes)' : '') + (e.err ? ' – ' + e.err : '')),
        h('td', { class: 'num' }, e.sent), h('td', { class: 'num' }, e.recv), h('td', { class: 'num' }, secs(e.ms))))))));
}

// ---- Lista oldal ----
function listView(view, sec) {
  const auth = sync.getAuth();
  const showAuthBanner = backend.enabled() && (!auth || auth.exp <= Date.now());
  const total = openCount(sec);
  return h('div', {},
    h('div', { class: 'pagehead desktop-only' }, h('h1', {}, pageTitle(view)), h('span', { class: 'sub' }, `${total} nyitott tétel`)),
    // mobilon a nézet/címzett választás a „Lista” gombbal vagy a címre koppintva nyíló listaválasztóban van
    showAuthBanner ? h('div', { class: 'banner' }, 'Jelentkezz be a szinkronhoz', h('button', { class: 'btn primary', onclick: () => { needLogin = true; render(); } }, 'Bejelentkezés')) : null,
    quickAdd(view),
    frequentChips(view),
    renderSections(sec, view));
}

/** Új tétel összeállítása névből (+ opcionális mennyiségből), a korábbi azonos nevű tétel adataival előtöltve. */
function newItemFrom(name, qty, unit, view) {
  const prev = remembered(name);
  const dflt = defaultStoresForView(view);
  const catIds = cats().map((c) => c.id);
  return {
    id: store.uuid(), name: prev ? prev.name : name, qty: qty || '', unit: unit || (prev ? prev.unit : '') || '', note: '',
    category: prev && prev.category ? prev.category : (catIds.includes('egyeb') ? 'egyeb' : ''),
    stores: dflt.length ? dflt : (prev ? prev.stores : []),
    for: personFilter || me(),        // alapértelmezés: a bejelentkezett felhasználó (vagy a szűrt címzett)
    urgent: false, checked: false, deleted: false, bought_at: 0, bought_store: '',
  };
}

/** Rövid leírás a tételről (címzett, bolt) – a „már a listán van” üzenethez. */
function itemWhere(it) {
  return [it.for && it.for !== me() ? personName(it.for) : '', it.stores.map(storeName).filter(Boolean).join(', ')].filter(Boolean).join(' · ');
}

/** Ha már van ugyanilyen tétel (név + címzett + bolt), szól és nem vesz fel újat. -> true, ha duplikátum volt */
function rejectDuplicate(item) {
  const dup = findDuplicate(store.list('Items'), item);
  if (!dup) return false;
  const sum = item.qty ? addQty(dup, item) : null;
  const where = itemWhere(dup);
  lastAddedId = dup.id;           // a meglévő sor felvillan
  render();
  setTimeout(() => { lastAddedId = null; document.querySelectorAll('.just-added').forEach((e) => e.classList.remove('just-added')); }, 1600);
  toast(`„${dup.name}” már ${dup.checked ? 'a kosárban' : 'a listán'} van${where ? ' (' + where + ')' : ''}`,
    sum ? { label: '+' + formatQty(item.qty, item.unit), fn: () => saveItem({ ...dup, qty: sum }) } : null);
  return true;
}

async function addItem(item, label) {
  if (rejectDuplicate(item)) return false;
  lastAddedId = item.id;
  await saveItem(item);
  learnProduct(item, false);
  const visible = Object.values(sectionsFor(currentView())).some((l) => l.some((i) => i.id === item.id));
  const q = formatQty(item.qty, item.unit);
  let msg = `„${label || item.name}”${q ? ' (' + q + ')' : ''} hozzáadva`;
  if (!visible) msg += ' – ebben a nézetben nem látszik';
  toast(msg, { label: 'Visszavonás', fn: () => store.remove('Items', item, authEmail()).then(() => sync.localChanged()) });
  setTimeout(() => { lastAddedId = null; document.querySelectorAll('.just-added').forEach((e) => e.classList.remove('just-added')); }, 1600);
  return true;
}

/** A gyors bevitelnél felismerhető boltok és címzettek (név, id, keresőszavak alapján). */
function smartDict() {
  return {
    stores: storesList().map((s) => ({ id: s.id, keys: entityKeys(s) })),
    people: peopleList().map((p) => ({ id: p.id, keys: entityKeys(p) })),
  };
}
let smartIgnore = new Set();   // a felhasználó által elutasított felismerések (×) – a következő hozzáadásig

function quickAdd(view) {
  const items = store.list('Items');
  const dict = smartDict();
  const parse = (t) => parseSmart(t, { ...dict, ignore: smartIgnore });
  const dl = h('datalist', { id: 'sugg' });
  const preview = h('div', { class: 'smart', 'aria-live': 'polite' });
  const input = h('input', { type: 'text', id: 'q', placeholder: 'Új tétel… (pl. „alma 2 kg lidl”)', list: 'sugg', autocomplete: 'off', maxLength: 200, 'aria-label': 'Új tétel neve',
    oninput: () => refresh() });
  // Élő előnézet: mit ismert fel a sorból. A bolt/címzett chipje × -szel elutasítható (akkor a név része marad).
  function refresh() {
    const p = parse(input.value);
    dl.replaceChildren(...suggestions([...items, ...store.list('Products')], p.name).map((s) => h('option', { value: s.name })));
    const chips = [];
    const q = formatQty(p.qty, p.unit);
    if (q) chips.push(h('span', { class: 'tag' }, q));
    const reject = (id) => h('button', { type: 'button', class: 'x', 'aria-label': 'Nem ezt értettem', title: 'Nem ezt értettem – maradjon a név része',
      onclick: () => { smartIgnore.add(id); refresh(); input.focus(); } }, icon('x', 12));
    if (p.store) { const s = storeById(p.store); chips.push(h('span', { class: 'tag' }, catDot(s && s.color), storeName(p.store), reject(p.store))); }
    if (p.person) { const pp = personById(p.person); chips.push(h('span', { class: 'tag person', style: pp && safeColor(pp.color) ? '--c:' + pp.color : null }, icon(personIconName(pp), 12), personName(p.person), reject(p.person))); }
    preview.replaceChildren(...(chips.length && p.name ? [h('span', { class: 'smartname' }, '„' + p.name + '”'), ...chips] : []));
  }
  const add = async () => {
    const p = parse(input.value);
    if (!p.name) return;
    // A mezőt MENTÉS ELŐTT ürítjük: a mentés újrarenderel, és a régi (lecserélt) mező ürítése már hatástalan lenne.
    input.value = '';
    smartIgnore = new Set();
    refresh();
    const item = newItemFrom(p.name, p.qty, p.unit, view);
    if (p.store) item.stores = [p.store];
    if (p.person) item.for = p.person;
    await addItem(item);
    const q = document.getElementById('q'); if (q) q.focus();
  };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') add(); });
  return h('div', {},
    h('div', { class: 'addbar' },
      h('div', { class: 'field' }, icon('plus', 20), input, dl,
        h('button', { class: 'btn text', onclick: add }, 'Hozzáad')),
      h('button', { class: 'iconbtn', title: 'Részletes felvétel', 'aria-label': 'Részletes felvétel', onclick: () => openEditor(null, view) }, icon('edit', 20)),
      h('button', { class: 'iconbtn', title: 'Felvétel sablonból', 'aria-label': 'Felvétel sablonból', onclick: () => openApplyTemplate('') }, icon('template', 20))),
    preview);
}

/** Gyakran vett, de most nem a listán lévő tételek – egy koppintással újra felvehetők. */
function frequentChips(view) {
  const list = frequent(store.list('Items'), desktop.matches ? 10 : 6);
  if (!list.length) return null;
  return h('div', { class: 'freq' }, h('span', { class: 'freqlabel' }, 'Gyakran veszed:'),
    list.map((it) => h('button', { class: 'chip small', title: 'Hozzáadás a listához', onclick: () => addItem(newItemFrom(it.name, '', it.unit, view)) },
      icon('plus', 14), it.name)));
}

function renderSections(sec, view) {
  const any = openCount(sec) + sec.cart.length;
  if (!any) return h('div', { class: 'empty' }, 'Nincs megjeleníthető tétel. Írd be fent, mit kell venni.');
  const title = personFilter ? personName(personFilter) + ' listája' : view.all ? 'Összes' : 'Ide való';
  const parts = [];
  // „Egy listában” mód: a nézet beállítása (Views.merged); csak valódi nézetben van értelme, ahol vannak más szakaszok is
  const canMerge = !view.all && !personFilter && (sec.elsewhere.length + sec.people.length > 0);
  const merged = canMerge && !!view.merged;
  const modeSwitch = canMerge ? h('div', { class: 'seg mini', role: 'group', 'aria-label': 'Megjelenítés' },
    h('button', { class: merged ? '' : 'active', 'aria-pressed': String(!merged), title: 'Külön szakaszokban', onclick: () => setMerged(view, false) }, 'Szakaszok'),
    h('button', { class: merged ? 'active' : '', 'aria-pressed': String(merged), title: 'Minden egy listában, kategóriánként', onclick: () => setMerged(view, true) }, 'Egy lista')) : null;
  if (merged) {
    const m = mergeSections(sec, catOrder());
    parts.push(section('Itt megvehető', m.list, { group: true, secOf: m.secOf, action: modeSwitch }));
  } else {
    if (sec.here.length || modeSwitch) parts.push(section(title, sec.here, { group: true, action: modeSwitch }));
    if (sec.elsewhere.length) parts.push(section('Máshol szoktad, de itt is megveheted', sec.elsewhere, { group: true, dim: true }));
    if (sec.people.length) parts.push(section('Más címzetteknek, ha már itt vagy', sec.people, { group: true }));
  }
  if (sec.cart.length) parts.push(section('Kosárban', sec.cart, { group: true, id: 'cart-section',
    action: h('button', { class: 'btn primary small', onclick: () => openCheckout(sec.cart, view) }, icon('check', 16), 'Vásárlás lezárása') }));
  const visible = [...sec.here, ...sec.elsewhere, ...sec.people, ...sec.cart];
  parts.push(h('div', { class: 'actions', style: 'justify-content:center' },
    h('button', { class: 'btn text small', onclick: () => openSaveAsTemplate(visible, '') }, icon('save', 16), 'A látható lista mentése sablonként')));
  return h('div', {}, parts);
}

async function setMerged(view, on) {
  if (!!view.merged === on) return;
  await saveRow('Views', { ...view, merged: on });
}

function section(title, list, o) {
  const catList = cats();
  const head = h('div', { class: 'sechead' }, h('span', {}, title), h('span', { class: 'count' }, list.length), h('span', { class: 'grow' }), o.action);
  const body = !list.length ? h('div', { class: 'card empty small' }, 'Nincs ide tartozó saját tétel.')
    : desktop.matches ? tableBody(list, o, catList) : mobileBody(list, o, catList);
  return h('section', { class: 'sec', id: o.id }, head, body);
}

// ---- Jelölők ----
function catDot(color) {
  const d = h('span', { class: 'dot' });
  const c = safeColor(color);
  if (c) d.style.background = c;
  return d;
}
function tintBadge(iconName, color, size) {
  const b = h('span', { class: 'caticon', 'aria-hidden': 'true' }, icon(iconName, size));
  const c = safeColor(color);
  if (c) b.style.setProperty('--c', c);
  return b;
}
/** Kategória-piktogram a kategória színével (kis, halvány hátterű kör). */
const catBadge = (cat, size = 16) => tintBadge(catIconName(cat), cat && cat.color, size);
const storeBadge = (s, size = 16) => tintBadge('store', s && s.color, size);
const personBadge = (p, size = 16) => tintBadge(personIconName(p), p && p.color, size);
function storeTag(id) {
  const s = storeById(id);
  if (!s || s.deleted) return null;
  return h('span', { class: 'tag' }, catDot(s.color), s.name);
}
/** Választható színek (a mintaadatok színeivel összhangban). */
const SWATCHES = ['#43a047', '#2e7d32', '#00897b', '#5bb5c9', '#4a90c2', '#6a7fd1', '#8e5cc4', '#b05fa8',
  '#d4007a', '#c2554d', '#e1251b', '#ef8a2c', '#c98a3b', '#a68a64', '#7d8a7f', '#455a64'];
/** Címzett-címke (a saját tételeimnél nem jelenik meg). */
function forTag(it) {
  if (!it.for || it.for === me()) return null;
  const p = personById(it.for);
  const t = h('span', { class: 'tag person' }, icon(personIconName(p), 12), personName(it.for));
  const c = safeColor(p && p.color);
  if (c) t.style.setProperty('--c', c);
  return t;
}
/** Kattintható bolt-címkék: koppintásra a bolt-gyorsválasztó nyílik. Üresen (asztalon) „bárhol”. */
// A gyorsválasztók `save(patch)` paramétere: alapból a listatételt menti; sablontételnél a sablon írja felül.
function storeTags(it, showEmpty, save) {
  const tags = it.stores.map(storeTag).filter(Boolean);
  if (!tags.length && !showEmpty) return null;
  return h('button', { type: 'button', class: 'tagbtn', title: 'Bolt módosítása', 'aria-label': 'Bolt módosítása: ' + it.name,
    onclick: (e) => { e.stopPropagation(); openStorePicker(it, save); } }, tags.length ? tags : h('span', { class: 'muted' }, 'bárhol'));
}
/** Kattintható címzett-címke: koppintásra a címzett-gyorsválasztó nyílik. */
function forTagBtn(it, showEmpty, save) {
  const t = forTag(it);
  if (!t && !showEmpty) return null;
  return h('button', { type: 'button', class: 'tagbtn', title: 'Címzett módosítása', 'aria-label': 'Címzett módosítása: ' + it.name,
    onclick: (e) => { e.stopPropagation(); openPersonPicker(it, save); } }, t || h('span', { class: 'muted hoverhint' }, '+ címzett'));
}
const itemSaver = (it, save) => save || ((patch) => saveItem({ ...it, ...patch }));
const catOf = (it, catList) => catList.find((c) => c.id === it.category);
// „Egy listában” módban a máshol szokásos tétel halványabb, mint a külön szakaszban
const rowClass = (it, o) => [it.urgent ? 'urgent' : '', o.dim || (o.secOf && o.secOf.get(it.id) === 'elsewhere') ? 'dim' : '', it.checked ? 'checked' : '', it.id === lastAddedId ? 'just-added' : ''].filter(Boolean).join(' ');
const check = (it) => h('input', { type: 'checkbox', checked: it.checked, 'aria-label': it.name + ' kipipálva', onchange: (e) => saveItem({ ...it, checked: e.target.checked }) });
const flagBtn = (it) => h('button', { class: 'iconbtn flag' + (it.urgent ? ' on' : ''), title: it.urgent ? 'Sürgős (kattints a visszavonáshoz)' : 'Megjelölés sürgősként', 'aria-pressed': it.urgent ? 'true' : 'false',
  onclick: () => saveItem({ ...it, urgent: !it.urgent }) }, icon('flag', 18));
/** Mennyiség-gomb: megnyitja a léptetőt. Üresen halvány „+” jelzi, hogy adható meg. */
const qtyBtn = (it, save) => {
  const q = formatQty(it.qty, it.unit);
  return h('button', { class: 'qty' + (q ? '' : ' noqty'), title: 'Mennyiség', 'aria-label': (q || 'nincs mennyiség') + ' – mennyiség módosítása', onclick: (e) => { e.stopPropagation(); openQty(it, save); } },
    q || icon('plus', 14));
};

function groups(list, o, catList) {
  return o.group ? groupByCategory(list, catList) : [{ id: null, items: list }];
}

function mobileBody(list, o, catList) {
  const card = h('div', { class: 'card' });
  for (const g of groups(list, o, catList)) {
    if (g.id !== null) card.append(h('div', { class: 'cathead' }, catBadge(g, 14), g.name, h('span', { class: 'n' }, g.items.length)));
    for (const it of g.items) {
      const c = catOf(it, catList);
      const meta = [];
      if (g.id === null && c) meta.push(h('span', { class: 'tag' }, catBadge(c, 12), c.name));
      const st = storeTags(it, false); if (st) meta.push(st);
      const f = forTagBtn(it, false); if (f) meta.push(f);
      if (it.note) meta.push(h('span', { class: 'note' }, it.note));
      card.append(h('div', { class: 'row ck ' + rowClass(it, o) }, check(it),
        h('div', { class: 'cell', onclick: () => openEditor(it) }, h('div', { class: 'name' }, it.name), meta.length ? h('div', { class: 'meta' }, meta) : null),
        qtyBtn(it),
        flagBtn(it)));
    }
  }
  return card;
}

function tableBody(list, o, catList) {
  const tbody = h('tbody');
  const cols = o.group ? 6 : 7;
  for (const g of groups(list, o, catList)) {
    if (g.id !== null) tbody.append(h('tr', { class: 'cat' }, h('td', { colspan: cols }, h('div', { class: 'ct' }, catBadge(g, 14), g.name, h('span', { class: 'n' }, g.items.length)))));
    for (const it of g.items) {
      const c = catOf(it, catList);
      tbody.append(h('tr', { class: 'item ' + rowClass(it, o) },
        h('td', {}, check(it)),
        h('td', { class: 'name', onclick: () => openEditor(it) }, h('div', { class: 'nm' }, it.name), it.note ? h('div', { class: 'muted small' }, it.note) : null),
        h('td', { class: 'q' }, qtyBtn(it)),
        // kategóriánként csoportosított szakaszban a kategória-oszlop fölösleges (a csoportfejléc mutatja)
        o.group ? null : h('td', {}, c ? h('div', { class: 'ct' }, catBadge(c, 14), c.name) : h('span', { class: 'muted' }, 'Egyéb')),
        h('td', {}, storeTags(it, true)),
        h('td', {}, forTagBtn(it, true)),
        h('td', {}, flagBtn(it))));
    }
  }
  const col = (w) => h('col', { style: w ? 'width:' + w : '' });
  const heads = ['Kipipálva', 'Tétel', 'Mennyiség', o.group ? null : 'Kategória', 'Bolt', 'Címzett', 'Sürgős'].filter(Boolean);
  return h('div', { class: 'card' }, h('table', { class: 'tbl' },
    h('colgroup', {}, col('46px'), col(''), col('120px'), o.group ? null : col('170px'), col('200px'), col('130px'), col('52px')),
    h('thead', { class: 'sr-only' }, h('tr', {}, heads.map((t) => h('th', {}, t)))),
    tbody));
}

// ---- Dialógus-segéd ----
function modal(build, cls) {
  const dlg = h('dialog', { class: cls || '' });
  // A natív append a null-t „null”, a tömböt „[object …]” szövegként szúrná be → itt lapítunk és szűrünk.
  const nativeAppend = dlg.append.bind(dlg);
  dlg.append = (...xs) => nativeAppend(...xs.flat(Infinity).filter((x) => x != null && x !== false));
  const close = () => { if (dlg.open) dlg.close(); dlg.remove(); };
  build(dlg, close);
  dlg.addEventListener('close', () => dlg.remove());
  // Kattintás a háttérre = bezárás, DE csak ha a lenyomás IS kint kezdődött.
  // (Az ablakon belül indított, kint elengedett húzás – pl. szövegkijelölés – nem zárhatja be, mert elveszne a beírt adat.)
  const outside = (e) => {
    const r = dlg.getBoundingClientRect();
    return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
  };
  let downOutside = false;
  dlg.addEventListener('pointerdown', (e) => { downOutside = e.target === dlg && outside(e); });
  dlg.addEventListener('click', (e) => {
    const ok = downOutside && e.target === dlg && outside(e);
    downOutside = false;
    if (ok) close();
  });
  document.body.append(dlg);
  dlg.showModal();
  return close;
}

/** Mennyiség + egység szerkesztő (gombokkal léptethető). Visszaadja a {qty, unit} lekérdezőt és a DOM-ot. */
function qtyControl(qty, unit) {
  let u = unit || '';
  const val = h('input', { type: 'text', inputMode: 'decimal', class: 'qtyval', value: qty ? formatQty(qty, '').replace(/\s/g, '') : '', placeholder: '–', 'aria-label': 'Mennyiség', maxLength: 12 });
  const read = () => { const s = val.value.trim().replace(',', '.'); return s; };
  const set = (s) => { val.value = s ? formatQty(s, '').replace(/\s/g, '') : ''; };
  const minus = h('button', { type: 'button', class: 'stepbtn', 'aria-label': 'Kevesebb', onclick: () => set(stepQty(read(), u, -1)) }, icon('minus', 22));
  const plus = h('button', { type: 'button', class: 'stepbtn', 'aria-label': 'Több', onclick: () => set(stepQty(read(), u, 1)) }, icon('plus', 22));
  const unitBtns = [{ id: '' }, ...UNITS].map((x) => {
    const b = h('button', { type: 'button', class: 'chip small' + (x.id === u ? ' active' : ''), onclick: () => { u = x.id; unitBtns.forEach((y) => y.classList.toggle('active', y === b)); } }, x.id || 'nincs');
    return b;
  });
  const node = h('div', { class: 'qtyctl' }, h('div', { class: 'stepper' }, minus, val, plus), h('div', { class: 'units' }, unitBtns));
  return { node, get: () => ({ qty: read(), unit: u }) };
}

/** Gyors mennyiség-állítás a listából. */
function openQty(it, save) {
  const put = itemSaver(it, save);
  modal((dlg, close) => {
    const ctl = qtyControl(it.qty, it.unit || (it.qty ? '' : 'db'));
    dlg.append(
      h('h3', {}, it.name),
      h('p', { class: 'muted small' }, 'Mennyiség és egység'),
      ctl.node,
      h('div', { class: 'actions' },
        h('button', { class: 'btn', onclick: async () => { await put({ qty: '', unit: '' }); close(); } }, 'Törlés'),
        h('button', { class: 'btn primary', onclick: async () => {
          const v = ctl.get();
          await put({ qty: v.qty, unit: v.qty ? v.unit : '' });
          close();
        } }, 'Kész')));
  }, 'compact');
}

/** Bolt gyorsválasztó: több bolt is bejelölhető; „Bárhol” = egyik sem. */
function openStorePicker(it, save) {
  const put = itemSaver(it, save);
  modal((dlg, close) => {
    let sel = new Set(it.stores.filter(storeName));
    const any = h('button', { type: 'button', class: 'chip', onclick: () => { sel.clear(); mark(); } }, 'Bárhol');
    const btns = storesList().map((s) => {
      const b = h('button', { type: 'button', class: 'chip', onclick: () => { sel.has(s.id) ? sel.delete(s.id) : sel.add(s.id); mark(); } }, catDot(s.color), s.name);
      b.dataset.id = s.id;
      return b;
    });
    const mark = () => { btns.forEach((b) => b.classList.toggle('active', sel.has(b.dataset.id))); any.classList.toggle('active', !sel.size); };
    dlg.append(
      h('h3', {}, it.name),
      h('p', { class: 'muted small' }, 'Hol veheted meg? (több is választható)'),
      h('div', { class: 'chips wrap' }, any, btns),
      h('div', { class: 'actions' },
        h('button', { class: 'btn', onclick: close }, 'Mégse'),
        h('button', { class: 'btn primary', onclick: async () => { await put({ stores: storesList().map((s) => s.id).filter((id) => sel.has(id)) }); close(); } }, 'Kész')));
    mark();
  }, 'compact');
}

/** Címzett gyorsválasztó: egy koppintás = mentés. */
function openPersonPicker(it, save) {
  const put = itemSaver(it, save);
  modal((dlg, close) => {
    const pick = async (id) => { await put({ for: id }); close(); };
    const opts = [{ id: '', name: 'közös (háztartás)' }, ...peopleList()];
    dlg.append(
      h('h3', {}, it.name),
      h('p', { class: 'muted small' }, 'Kinek / hova?'),
      h('div', { class: 'chips wrap' }, opts.map((p) => h('button', { type: 'button', class: 'chip' + ((it.for || '') === p.id ? ' active' : ''), onclick: () => pick(p.id) },
        p.id ? personBadge(p, 14) : null, p.id === me() ? p.name + ' (én)' : p.name))),
      h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: close }, 'Mégse')));
  }, 'compact');
}

// ---- Tétel szerkesztő ----
function openEditor(item, view) {
  const isNew = !item;
  const it = item || { ...newItemFrom('', '', '', view || currentView()), category: 'egyeb' };
  modal((dlg, close) => {
    let touched = false;   // a felhasználó kézzel állított-e kategóriát/boltot (akkor nem írjuk felül előtöltéssel)
    const f = {
      name: h('input', { type: 'text', value: it.name, maxLength: 200 }),
      category: h('select', { onchange: () => { touched = true; } }, cats().map((c) => h('option', { value: c.id, selected: c.id === it.category }, c.name)),
        h('option', { value: '', selected: !cats().some((c) => c.id === it.category) }, 'Egyéb')),
      forWho: h('select', {}, h('option', { value: '', selected: !it.for }, 'közös (háztartás)'),
        peopleList().map((p) => h('option', { value: p.id, selected: p.id === it.for }, p.id === me() ? p.name + ' (én)' : p.name))),
      urgent: h('input', { type: 'checkbox', checked: it.urgent }),
      note: h('textarea', { rows: 2, maxLength: 500, value: it.note }),
    };
    let ctl = qtyControl(it.qty, it.unit);
    const qtyWrap = h('div', {}, ctl.node);
    const errMsg = h('p', { class: 'err', role: 'alert' });
    const boxes = storesList().map((s) => ({ id: s.id, el: h('input', { type: 'checkbox', checked: it.stores.includes(s.id), onchange: () => { touched = true; } }), name: s.name }));
    // Új tételnél a név alapján előtöltjük a korábbi kategóriát, egységet, boltokat.
    if (isNew) f.name.addEventListener('change', () => {
      const prev = remembered(f.name.value);
      if (!prev || touched) return;
      if (cats().some((c) => c.id === prev.category)) f.category.value = prev.category;
      if (!ctl.get().qty && prev.unit) { ctl = qtyControl('', prev.unit); qtyWrap.replaceChildren(ctl.node); }
      if (!defaultStoresForView(view || currentView()).length) boxes.forEach((b) => { b.el.checked = prev.stores.includes(b.id); });
    });
    dlg.append(
      h('h3', {}, isNew ? 'Új tétel' : 'Tétel szerkesztése'),
      h('label', { class: 'f' }, 'Név'), f.name,
      h('label', { class: 'f' }, 'Mennyiség'), qtyWrap,
      h('label', { class: 'f' }, 'Kategória'), f.category,
      h('label', { class: 'f' }, 'Boltok (üres = bárhol megvehető)'),
      h('div', { class: 'checks' }, boxes.map((b) => h('label', {}, b.el, b.name))),
      h('label', { class: 'f' }, 'Címzett'), f.forWho,
      h('label', { class: 'sw' }, f.urgent, 'Sürgős'),
      h('label', { class: 'f' }, 'Megjegyzés'), f.note,
      h('div', { class: 'actions' },
        isNew ? null : h('button', { class: 'btn danger', onclick: async () => {
          await store.remove('Items', it, authEmail()); sync.localChanged(); close();
          toast(`„${it.name}” törölve`, { label: 'Visszavonás', fn: () => saveItem({ ...it, deleted: false }) });
        } }, 'Törlés'),
        h('button', { class: 'btn', onclick: close }, 'Mégse'),
        h('button', { class: 'btn primary', onclick: async () => {
          const name = f.name.value.trim();
          if (!name) { f.name.focus(); return; }
          const q = ctl.get();
          const next = { ...it, name, qty: q.qty, unit: q.qty ? q.unit : '', note: f.note.value.trim(), category: f.category.value,
            stores: boxes.filter((b) => b.el.checked).map((b) => b.id), for: f.forWho.value, urgent: f.urgent.checked };
          // ugyanilyen (név + címzett + bolt) tétel már van → nem mentjük, szólunk az ablakban
          const dup = !next.deleted && !(next.bought_at > 0) && findDuplicate(store.list('Items'), next);
          if (dup) {
            const where = itemWhere(dup);
            errMsg.textContent = `Ilyen tétel már ${dup.checked ? 'a kosárban' : 'a listán'} van${where ? ' (' + where + ')' : ''}. Válassz másik címzettet vagy boltot, vagy módosítsd a meglévő mennyiségét.`;
            return;
          }
          await saveItem(next);
          learnProduct(next, true);   // a kézzel állított kategória/egység a terméklistába is bekerül
          close();
        } }, 'Mentés')),
      errMsg);
    f.name.focus();
  });
}

// ---- Vásárlás lezárása → napló ----
function openCheckout(cart, view) {
  // alapértelmezett bolt: a nézet egyetlen boltja, különben a kosárban leggyakoribb bolt
  let chosen = defaultStoresForView(view)[0] || '';
  if (!chosen) {
    const cnt = new Map();
    cart.forEach((i) => i.stores.forEach((s) => storeName(s) && cnt.set(s, (cnt.get(s) || 0) + 1)));
    chosen = [...cnt.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || '';
  }
  modal((dlg, close) => {
    const opts = [...storesList().map((s) => ({ id: s.id, name: s.name, color: s.color })), { id: '', name: 'Nem rögzítem' }];
    const btns = opts.map((o) => {
      const b = h('button', { type: 'button', class: 'chip' + (o.id === chosen ? ' active' : ''), onclick: () => { chosen = o.id; btns.forEach((x) => x.classList.toggle('active', x === b)); } },
        o.id ? catDot(o.color) : null, o.name);
      return b;
    });
    dlg.append(
      h('h3', {}, 'Vásárlás lezárása'),
      h('p', { class: 'muted' }, `${cart.length} tétel kerül a naplóba, és lekerül a listáról. Később javaslatként újra felveheted őket.`),
      h('label', { class: 'f' }, 'Hol vásároltál?'),
      h('div', { class: 'chips wrap' }, btns),
      h('div', { class: 'actions' },
        h('button', { class: 'btn', onclick: close }, 'Mégse'),
        h('button', { class: 'btn primary', onclick: async () => {
          const now = Date.now();
          const before = cart.map((i) => ({ ...i }));
          for (const it of cart) await store.save('Items', { ...it, bought_at: now, bought_store: chosen }, authEmail());
          sync.localChanged();
          close();
          toast(`${cart.length} tétel a naplóba került`, { label: 'Visszavonás', fn: async () => {
            for (const it of before) await store.save('Items', { ...it, bought_at: 0, bought_store: '' }, authEmail());
            sync.localChanged();
          } });
        } }, icon('check', 18), `Lezárás (${cart.length})`)));
  });
}

// ---- Napló oldal ----
function dayLabel(day) {
  const today = dayKey(Date.now());
  const yest = dayKey(Date.now() - 864e5);
  if (day === today) return 'Ma';
  if (day === yest) return 'Tegnap';
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('hu-HU', { month: 'long', day: 'numeric', weekday: 'long', year: y === new Date().getFullYear() ? undefined : 'numeric' });
}

function journalView() {
  const days = journal(store.list('Items'));
  const shown = days.slice(0, journalDays);
  const catList = cats();
  const time = (ts) => new Date(ts).toLocaleTimeString('hu-HU', { hour: '2-digit', minute: '2-digit' });
  return h('div', {},
    h('div', { class: 'pagehead desktop-only' }, h('h1', {}, 'Napló'), h('span', { class: 'sub' }, 'Mikor, hol, mit vettél')),
    days.length ? null : h('div', { class: 'empty' }, 'Még nincs lezárt vásárlás. A kosárban a „Vásárlás lezárása” gombbal kerülnek ide a tételek.'),
    shown.map((d) => h('section', { class: 'sec' },
      h('div', { class: 'sechead' }, h('span', {}, dayLabel(d.day))),
      d.groups.map((g) => {
        const s = storeById(g.store);
        return h('div', { class: 'card jgroup' },
          h('div', { class: 'jhead' }, s ? storeBadge(s, 16) : tintBadge('cart', '', 16), h('span', { class: 'jstore' }, s ? s.name : 'Bolt nincs rögzítve'),
            h('span', { class: 'muted small' }, time(g.ts) + ' · ' + g.items.length + ' tétel'),
            h('button', { class: 'iconbtn', title: 'Ebből sablon', 'aria-label': 'Sablon készítése ebből a vásárlásból',
              // javasolt név: „Lidl – nov. 14.” (a „tegnap” hamar elavulna)
              onclick: () => openSaveAsTemplate(g.items, (s ? s.name + ' – ' : '') + new Date(g.ts).toLocaleDateString('hu-HU', { month: 'short', day: 'numeric' })) }, icon('save', 18))),
          g.items.map((it) => {
            const c = catOf(it, catList);
            return h('div', { class: 'row', onclick: () => openJournalItem(it) },
              c ? catBadge(c, 14) : tintBadge('box', '', 14),
              h('div', { class: 'cell' }, h('div', { class: 'name' }, it.name), forTag(it) ? h('div', { class: 'meta' }, forTag(it)) : null),
              h('span', { class: 'qty static' }, formatQty(it.qty, it.unit)),
              h('button', { class: 'iconbtn', title: 'Újra a listára', 'aria-label': it.name + ' újra a listára', onclick: (e) => { e.stopPropagation(); readd(it); } }, icon('plus', 18)));
          }));
      }))),
    days.length > journalDays ? h('div', { class: 'actions', style: 'justify-content:center' }, h('button', { class: 'btn', onclick: () => { journalDays += 14; render(); } }, 'Régebbiek')) : null);
}

async function readd(it) {
  const copy = { ...newItemFrom(it.name, it.qty, it.unit, currentView()), category: it.category, for: it.for, note: it.note };
  if (!defaultStoresForView(currentView()).length) copy.stores = it.stores.filter(storeName);
  await addItem(copy);
}

function openJournalItem(it) {
  modal((dlg, close) => {
    dlg.append(
      h('h3', {}, it.name),
      h('p', { class: 'muted' }, [formatQty(it.qty, it.unit), storeName(it.bought_store), new Date(it.bought_at).toLocaleString('hu-HU', { dateStyle: 'medium', timeStyle: 'short' })].filter(Boolean).join(' · ')),
      h('div', { class: 'actions', style: 'justify-content:flex-start' },
        h('button', { class: 'btn primary', onclick: () => { close(); readd(it); } }, icon('plus', 18), 'Újra a listára'),
        h('button', { class: 'btn', onclick: async () => { close(); await saveItem({ ...it, bought_at: 0, bought_store: '' }); toast('Visszakerült a kosárba'); } }, icon('undo', 18), 'Mégsem vettem meg'),
        h('button', { class: 'btn danger', onclick: async () => { close(); await store.remove('Items', it, authEmail()); sync.localChanged(); toast('Törölve a naplóból'); } }, icon('trash', 18), 'Törlés')),
      h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: close }, 'Bezár')));
  }, 'compact');
}

// ---- Sablonok ----
const templatesList = () => live('Templates').sort(bySort);
const templateItemsOf = (tid) => live('TemplateItems').filter((t) => t.template === tid).sort(bySort);
const templateBadge = (t, size = 16) => tintBadge(templateIconName(t), t && t.color, size);
function openTemplate(id) { go('template', () => { templateId = id; }); }

/** Sablon oldal: a sablon tételei, okos bevitellel bővíthető; minden mező gyorsan állítható. */
function templateView() {
  const t = store.state.Templates.get(templateId);
  if (!t || t.deleted) return h('div', { class: 'empty' }, 'Ez a sablon már nem létezik.');
  const tis = templateItemsOf(t.id);
  const catList = cats();
  const saveTI = (ti) => (patch) => saveRow('TemplateItems', { ...ti, ...patch });
  const dict = smartDict();
  const input = h('input', { type: 'text', id: 'tq', placeholder: 'Tétel a sablonba… (pl. „liszt 2 kg lidl”)', autocomplete: 'off', maxLength: 200, 'aria-label': 'Új sablontétel' });
  const add = async () => {
    const p = parseSmart(input.value, dict);
    if (!p.name) return;
    input.value = '';
    const prev = remembered(p.name);
    await saveRow('TemplateItems', {
      id: store.uuid(), template: t.id, name: prev ? prev.name : p.name, qty: p.qty, unit: p.unit || (prev ? prev.unit : ''),
      category: prev && catList.some((c) => c.id === prev.category) ? prev.category : '',
      stores: p.store ? [p.store] : prev ? prev.stores.filter(storeName) : [], for: p.person || '',
      sort: Math.max(0, ...tis.map((x) => x.sort || 0)) + 10, deleted: false,
    });
    const q = document.getElementById('tq'); if (q) q.focus();
  };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') add(); });
  return h('div', {},
    h('div', { class: 'tplhead' },
      h('button', { class: 'iconbtn', title: 'Vissza a sablonokhoz', 'aria-label': 'Vissza', onclick: () => go('manage', () => { manageTab = 'templates'; }) }, icon('back', 20)),
      templateBadge(t, 20),
      h('div', { class: 'cell' }, h('h1', {}, t.name), h('div', { class: 'muted small' }, [tis.length + ' tétel', t.for ? 'címzett: ' + personName(t.for) : ''].filter(Boolean).join(' · '))),
      h('button', { class: 'iconbtn', title: 'Sablon beállításai', 'aria-label': 'Sablon beállításai', onclick: () => openManageEditor('templates', t) }, icon('edit', 20))),
    h('div', { class: 'actions', style: 'justify-content:flex-start;margin:0 0 14px' },
      h('button', { class: 'btn primary', onclick: () => openApplyTemplate(t.id) }, icon('cart', 18), 'Felvétel a listára')),
    h('div', { class: 'addbar' }, h('div', { class: 'field' }, icon('plus', 20), input, h('button', { class: 'btn text', onclick: add }, 'Hozzáad'))),
    tis.length ? h('div', { class: 'card' }, tis.map((ti) => {
      const c = catOf(ti, catList);
      const meta = [storeTags(ti, false, saveTI(ti)), forTagBtn(ti, false, saveTI(ti))].filter(Boolean);
      return h('div', { class: 'row' },
        c ? catBadge(c, 14) : tintBadge('box', '', 14),
        h('div', { class: 'cell', onclick: () => openTemplateItem(ti) }, h('div', { class: 'name' }, ti.name), meta.length ? h('div', { class: 'meta' }, meta) : null),
        qtyBtn(ti, saveTI(ti)),
        h('button', { class: 'iconbtn', title: 'Törlés a sablonból', 'aria-label': ti.name + ' törlése a sablonból',
          onclick: async () => { await store.remove('TemplateItems', ti, authEmail()); sync.localChanged(); toast(`„${ti.name}” törölve a sablonból`, { label: 'Visszavonás', fn: () => saveRow('TemplateItems', { ...ti, deleted: false }) }); } },
        icon('x', 18)));
    })) : h('div', { class: 'empty' }, 'Még üres. Írd be fent a tételeket – a mennyiség, bolt és címzett is megadható egy sorban.'));
}

/** Sablontétel: név, kategória, bolt, címzett szerkesztése. */
function openTemplateItem(ti) {
  modal((dlg, close) => {
    const name = h('input', { type: 'text', value: ti.name, maxLength: 200 });
    const category = h('select', {}, cats().map((c) => h('option', { value: c.id, selected: c.id === ti.category }, c.name)),
      h('option', { value: '', selected: !cats().some((c) => c.id === ti.category) }, 'Egyéb'));
    let ctl = qtyControl(ti.qty, ti.unit);
    dlg.append(
      h('h3', {}, 'Sablontétel'),
      h('label', { class: 'f' }, 'Név'), name,
      h('label', { class: 'f' }, 'Mennyiség'), ctl.node,
      h('label', { class: 'f' }, 'Kategória'), category,
      h('p', { class: 'muted small' }, 'A boltot és a címzettet a tétel címkéire koppintva állíthatod.'),
      h('div', { class: 'actions' },
        h('button', { class: 'btn', onclick: close }, 'Mégse'),
        h('button', { class: 'btn primary', onclick: async () => {
          const n = name.value.trim();
          if (!n) { name.focus(); return; }
          const q = ctl.get();
          await saveRow('TemplateItems', { ...ti, name: n, qty: q.qty, unit: q.qty ? q.unit : '', category: category.value });
          close();
        } }, 'Mentés')));
    name.focus();
  });
}

/**
 * Felvétel sablonból: előbb a sablon kiválasztása (ha nincs megadva), majd pipálós lista.
 * A már a listán lévő tételek alapból nincsenek bejelölve. A mennyiség felvétel előtt állítható.
 */
function openApplyTemplate(tid) {
  const all = templatesList();
  if (!tid) {
    if (!all.length) {
      if (confirm('Még nincs sablonod. Létrehozol egyet most?')) go('manage', () => { manageTab = 'templates'; });
      return;
    }
    if (all.length === 1) tid = all[0].id;
    else {
      modal((dlg, close) => {
        dlg.append(h('h3', {}, 'Melyik sablon?'),
          h('div', { class: 'tplpick' }, all.map((t) => h('button', { class: 'mrow', onclick: () => { close(); openApplyTemplate(t.id); } },
            templateBadge(t, 18), h('div', { class: 'cell' }, h('div', {}, t.name), h('div', { class: 'muted small' }, templateItemsOf(t.id).length + ' tétel'))))),
          h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: close }, 'Mégse')));
      }, 'compact');
      return;
    }
  }
  const t = store.state.Templates.get(tid);
  if (!t) return;
  const plan = templatePlan(templateItemsOf(tid), store.list('Items'));
  if (!plan.length) { toast('Ez a sablon még üres'); openTemplate(tid); return; }
  modal((dlg, close) => {
    const rows = plan.map((p) => ({ copy: { ...p.item }, on: !p.onList, onList: p.onList }));
    const list = h('div', { class: 'card applylist' });
    const btn = h('button', { class: 'btn primary' });
    const draw = () => {
      list.replaceChildren(...rows.map((r) => h('label', { class: 'row ck' + (r.onList ? ' dim' : '') },
        h('input', { type: 'checkbox', checked: r.on, onchange: (e) => { r.on = e.target.checked; drawBtn(); } }),
        h('div', { class: 'cell' }, h('div', { class: 'name' }, r.copy.name), r.onList ? h('div', { class: 'meta' }, h('span', { class: 'tag' }, 'már a listán')) : null),
        qtyBtn(r.copy, (patch) => { Object.assign(r.copy, patch); draw(); }))));
      drawBtn();
    };
    const drawBtn = () => { const n = rows.filter((r) => r.on).length; btn.replaceChildren(icon('plus', 18), `Felvétel (${n})`); btn.disabled = !n; };
    btn.addEventListener('click', async () => {
      const view = currentView();
      const added = [];
      let skipped = 0;
      for (const r of rows.filter((x) => x.on)) {
        const c = r.copy;
        const it = newItemFrom(c.name, c.qty, c.unit, view);
        if (cats().some((k) => k.id === c.category)) it.category = c.category;
        const st = c.stores.filter(storeName);
        if (st.length) it.stores = st;
        it.for = c.for || t.for || personFilter || me();
        // pontosan ilyen tétel (név + címzett + bolt) már van → kihagyjuk, nem szemeteljük tele a listát
        if (findDuplicate(store.list('Items'), it)) { skipped++; continue; }
        await store.save('Items', it, authEmail());
        added.push(it);
      }
      sync.localChanged();
      close();
      if (page !== 'list') go('list');
      toast(`${added.length} tétel felvéve: ${t.name}` + (skipped ? ` (${skipped} már a listán volt, kihagyva)` : ''), { label: 'Visszavonás', fn: async () => {
        for (const it of added) await store.remove('Items', store.state.Items.get(it.id) || it, authEmail());
        sync.localChanged();
      } });
    });
    dlg.append(
      h('div', { class: 'tplhead' }, templateBadge(t, 20), h('div', { class: 'cell' }, h('h3', {}, t.name),
        h('div', { class: 'muted small' }, 'Pipáld ki, mi kell most. A mennyiségre koppintva módosíthatod.'))),
      h('div', { class: 'actions', style: 'justify-content:flex-start;margin:6px 0 8px' },
        h('button', { class: 'btn text small', onclick: () => { rows.forEach((r) => { r.on = true; }); draw(); } }, 'Mind'),
        h('button', { class: 'btn text small', onclick: () => { rows.forEach((r) => { r.on = false; }); draw(); } }, 'Egyik sem')),
      list,
      h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: close }, 'Mégse'), btn));
    draw();
  });
}

/** Sablon készítése tételekből (a látható listából vagy egy naplóbeli vásárlásból). */
function openSaveAsTemplate(items, suggestedName) {
  if (!items.length) { toast('Nincs tétel, amiből sablon készülhetne'); return; }
  modal((dlg, close) => {
    const name = h('input', { type: 'text', value: suggestedName || '', maxLength: 100, placeholder: 'pl. Havi nagybevásárlás' });
    const forSel = h('select', {}, h('option', { value: '' }, 'tételenként / a felvevő'),
      peopleList().map((p) => h('option', { value: p.id }, p.id === me() ? p.name + ' (én)' : p.name)));
    dlg.append(
      h('h3', {}, 'Mentés sablonként'),
      h('p', { class: 'muted' }, `${new Set(items.map((i) => i.name.trim().toLocaleLowerCase('hu'))).size} tétel kerül a sablonba (mennyiséggel, bolttal, címzettel).`),
      h('label', { class: 'f' }, 'Sablon neve'), name,
      h('label', { class: 'f' }, 'Alapértelmezett címzett'), forSel,
      h('div', { class: 'actions' },
        h('button', { class: 'btn', onclick: close }, 'Mégse'),
        h('button', { class: 'btn primary', onclick: async () => {
          const n = name.value.trim();
          if (!n) { name.focus(); return; }
          const allT = store.list('Templates');
          const tpl = { id: slug(n, new Set(allT.map((x) => x.id))), name: n, color: SWATCHES[0], icon: 'template', for: forSel.value,
            sort: Math.max(0, ...allT.filter((x) => !x.deleted).map((x) => x.sort || 0)) + 10, deleted: false };
          await store.save('Templates', tpl, authEmail());
          // a sablon saját alapértelmezett címzettjét nem ismételjük tételenként
          for (const ti of templateItemsFrom(items, tpl.id, store.uuid)) await store.save('TemplateItems', { ...ti, for: ti.for === (tpl.for || me()) ? '' : ti.for }, authEmail());
          sync.localChanged();
          close();
          toast(`„${n}” sablon elmentve`);
          openTemplate(tpl.id);
        } }, 'Mentés')));
    name.focus();
  }, 'compact');
}

// ---- Kezelés oldal: kategóriák, boltok, címzettek, nézetek ----
const MANAGE = {
  categories: { table: 'Categories', one: 'kategória', One: 'Kategória', hint: 'A sorrend (↑↓) a bevásárlólistán a kategória-csoportok sorrendje – érdemes a bolt bejárási útvonalához igazítani (pl. zöldség elöl, fagyasztott a végén). A számra koppintva a kategória termékei nyílnak meg.' },
  stores: { table: 'Stores', one: 'bolt', One: 'Bolt', hint: 'A boltok a tételeknél és a nézetekben választhatók.' },
  people: { table: 'People', one: 'címzett', One: 'Címzett', hint: 'Akinek vagy aminek a tétel szól: családtag, de akár hely is (pl. „Hétvégi ház”). Szűrni a Címzett listával lehet.' },
  views: { table: 'Views', one: 'nézet', One: 'Nézet', hint: 'A nézet azt mondja meg, mely boltokban vagy, és mit mutasson még a lista.' },
  templates: { table: 'Templates', one: 'sablon', One: 'Sablon', hint: 'Előre összeállított tétellisták (pl. havi nagybevásárlás, hétvégi ház). A lista „Sablonból” gombjával egy mozdulattal felvehetők.' },
};

const MANAGE_TABS = [['products', 'Termékek'], ['categories', 'Kategóriák'], ['stores', 'Boltok'], ['people', 'Címzettek'], ['views', 'Nézetek'], ['templates', 'Sablonok']];
// fülsáv (Raktár-stílus): aláhúzott fülek, vízszintesen görgethető; az aktív fül mindig látszik (revealActiveTabs)
const manageTabs = () => h('div', { class: 'tabs', role: 'tablist' }, MANAGE_TABS.map(([k, l]) =>
  h('button', { class: manageTab === k ? 'active' : '', role: 'tab', 'aria-selected': String(manageTab === k), onclick: () => { manageTab = k; render(); } }, l)));

// ---- Terméklista (alap katalógus) ----
let productQuery = '';
let productCat = '';               // kategória-szűrő a Termékek fülön ('' = mind, '__none' = kategória nélküli)
const productCatOf = (p, catIds) => (catIds.has(p.category) ? p.category : '__none');
function productsView() {
  const all = live('Products');
  const catIds = new Set(cats().map((c) => c.id));
  const q = productQuery.trim().toLocaleLowerCase('hu');
  const norm = (s) => String(s).toLocaleLowerCase('hu').normalize('NFD').replace(/[̀-ͯ]/g, '');
  const nq = norm(q);
  const list = all.filter((p) => (!nq || norm(p.name).includes(nq) || norm(p.keywords).includes(nq))
    && (!productCat || productCatOf(p, catIds) === productCat)).sort(byName);
  const countIn = (id) => all.filter((p) => productCatOf(p, catIds) === id).length;
  const catChips = h('div', { class: 'chips' },
    h('button', { class: 'chip small' + (!productCat ? ' active' : ''), onclick: () => { productCat = ''; render(); } }, 'Mind'),
    cats().map((c) => h('button', { class: 'chip small' + (productCat === c.id ? ' active' : ''), onclick: () => { productCat = productCat === c.id ? '' : c.id; render(); } },
      catBadge(c, 12), c.name, h('span', { class: 'muted' }, countIn(c.id)))),
    countIn('__none') ? h('button', { class: 'chip small' + (productCat === '__none' ? ' active' : ''), onclick: () => { productCat = '__none'; render(); } }, 'Kategória nélkül') : null);
  const search = h('input', { type: 'text', id: 'pq', value: productQuery, placeholder: 'Keresés a termékek között…', autocomplete: 'off', 'aria-label': 'Termék keresése',
    oninput: (e) => { productQuery = e.target.value; render(); } });
  const groups = groupByCategory(list, cats());
  return h('div', {},
    h('div', { class: 'pagehead desktop-only' }, h('h1', {}, 'Kezelés')),
    manageTabs(),
    h('p', { class: 'hint' }, 'Az alap terméklista: innen jön a kategória és a szokásos egység, amikor felveszel egy tételt. Az új neveket magától megtanulja. Később ide kerülhet pl. az ár is.'),
    h('div', { class: 'addbar' }, h('div', { class: 'field' }, icon('search', 20), search),
      h('button', { class: 'btn primary', onclick: () => openProductEditor(null) }, icon('plus', 18), h('span', { class: 'desktop-only' }, 'Új termék'))),
    catChips,
    h('p', { class: 'muted small' }, `${list.length} / ${all.length} termék`),
    list.length ? h('div', { class: 'card' }, groups.map((g) => [
      h('div', { class: 'cathead' }, catBadge(g, 14), g.name, h('span', { class: 'n' }, g.items.length)),
      g.items.map((p) => h('div', { class: 'row', onclick: () => openProductEditor(p) },
        h('div', { class: 'cell' }, h('div', { class: 'name' }, p.name),
          h('div', { class: 'meta' }, [p.unit ? h('span', {}, p.unit) : null, ...p.stores.map(storeTag), p.keywords ? h('span', { class: 'note' }, p.keywords) : null].filter(Boolean))),
        h('button', { class: 'iconbtn', title: 'Felvétel a listára', 'aria-label': p.name + ' felvétele a listára',
          onclick: (e) => { e.stopPropagation(); addItem(newItemFrom(p.name, '', p.unit, currentView())); } }, icon('plus', 18)))),
    ])) : h('div', { class: 'empty' }, 'Nincs találat.'));
}

function openProductEditor(p) {
  const isNew = !p;
  const base = p || { id: '', name: productQuery.trim(), category: productCat && productCat !== '__none' ? productCat : 'egyeb', unit: '', stores: [], keywords: '', deleted: false };
  modal((dlg, close) => {
    const name = h('input', { type: 'text', value: base.name, maxLength: 200 });
    const kw = h('input', { type: 'text', value: base.keywords, maxLength: 300, placeholder: 'pl. krumpli, pityóka' });
    const category = h('select', {}, cats().map((c) => h('option', { value: c.id, selected: c.id === base.category }, c.name)),
      h('option', { value: '', selected: !cats().some((c) => c.id === base.category) }, 'Egyéb'));
    let unit = base.unit || '';
    const unitBtns = [{ id: '' }, ...UNITS].map((x) => {
      const b = h('button', { type: 'button', class: 'chip small' + (x.id === unit ? ' active' : ''), onclick: () => { unit = x.id; unitBtns.forEach((y) => y.classList.toggle('active', y === b)); } }, x.id || 'nincs');
      return b;
    });
    const boxes = storesList().map((s) => ({ id: s.id, el: h('input', { type: 'checkbox', checked: base.stores.includes(s.id) }), name: s.name }));
    const err = h('p', { class: 'err', role: 'alert' });
    dlg.append(
      h('h3', {}, isNew ? 'Új termék' : 'Termék szerkesztése'),
      h('label', { class: 'f' }, 'Név'), name,
      h('label', { class: 'f' }, 'Más nevek / keresőszavak (vesszővel)'), kw,
      h('label', { class: 'f' }, 'Kategória'), category,
      h('label', { class: 'f' }, 'Szokásos egység'), h('div', { class: 'units' }, unitBtns),
      h('label', { class: 'f' }, 'Alapbolt (ha még nincs előzmény)'), h('div', { class: 'checks' }, boxes.map((b) => h('label', {}, b.el, b.name))),
      h('div', { class: 'actions' },
        isNew ? null : h('button', { class: 'btn danger', onclick: async () => {
          if (!confirm(`Törlöd a terméklistából: „${base.name}”? (A listán lévő tételek maradnak.)`)) return;
          await store.remove('Products', base, authEmail()); sync.localChanged(); close();
        } }, 'Törlés'),
        h('button', { class: 'btn', onclick: close }, 'Mégse'),
        h('button', { class: 'btn primary', onclick: async () => {
          const n = name.value.trim();
          if (!n) { name.focus(); return; }
          const other = findProduct(store.list('Products').filter((x) => x.id !== base.id), n);
          if (other) { err.textContent = `Már van ilyen termék: „${other.name}”.`; return; }
          const next = { ...base, name: n, keywords: kw.value.split(',').map((s) => s.trim()).filter(Boolean).join(', '), category: category.value, unit,
            stores: boxes.filter((b) => b.el.checked).map((b) => b.id) };
          if (isNew) next.id = 'p-' + slug(n, new Set(store.list('Products').map((x) => x.id.replace(/^p-/, ''))));
          await saveRow('Products', next);
          close();
        } }, 'Mentés')),
      err);
    name.focus();
  });
}

function manageView() {
  if (manageTab === 'products') return productsView();
  const m = MANAGE[manageTab];
  const list = manageTab === 'people' ? peopleList() : live(m.table).sort(bySort);
  const lead = (r) => ({ categories: () => catBadge(r, 16), stores: () => storeBadge(r), people: () => personBadge(r), views: () => h('span', { class: 'caticon plain' }, icon('list', 16)),
    templates: () => templateBadge(r) }[manageTab]());
  const sub = (r) => (manageTab === 'views' ? viewSummary(r)
    : manageTab === 'people' ? [r.id === me() ? 'te' : '', r.email ? 'be tud jelentkezni' : ''].filter(Boolean).join(' · ')
      : manageTab === 'templates' ? [templateItemsOf(r.id).length + ' tétel', r.for ? personName(r.for) : ''].filter(Boolean).join(' · ') : '');
  // sablonnál a sor (és a szerkesztés) a sablon oldalát nyitja
  const openRow = (r) => (manageTab === 'templates' ? openTemplate(r.id) : openManageEditor(manageTab, r));
  // kategóriánál: kapcsolódó termékek száma → koppintásra a Termékek fül, erre a kategóriára szűrve
  const prodCount = manageTab === 'categories' ? (id) => live('Products').filter((p) => p.category === id).length : null;
  const openCatProducts = (r) => { productCat = r.id; productQuery = ''; manageTab = 'products'; render(); window.scrollTo(0, 0); };
  const rows = list.map((r, i) => h('div', { class: 'mrow' },
    lead(r),
    h('div', { class: 'cell' + (manageTab === 'templates' || manageTab === 'categories' ? ' clickable' : ''),
      onclick: manageTab === 'templates' ? () => openRow(r) : manageTab === 'categories' ? () => openCatProducts(r) : null },
      h('div', {}, r.name), sub(r) ? h('div', { class: 'muted small' }, sub(r)) : null),
    prodCount ? h('button', { class: 'countbtn', title: 'A kategória termékei', 'aria-label': `${r.name}: ${prodCount(r.id)} termék megnyitása`, onclick: () => openCatProducts(r) },
      prodCount(r.id) + ' termék') : null,
    manageTab === 'templates' ? h('button', { class: 'iconbtn', title: 'Felvétel a listára', 'aria-label': r.name + ' felvétele a listára', onclick: () => openApplyTemplate(r.id) }, icon('cart', 18)) : null,
    h('button', { class: 'iconbtn', title: 'Feljebb', 'aria-label': 'Feljebb', disabled: i === 0 || (manageTab === 'people' && i <= 1), onclick: () => move(m.table, list, i, i - 1) }, icon('up', 18)),
    h('button', { class: 'iconbtn', title: 'Lejjebb', 'aria-label': 'Lejjebb', disabled: i === list.length - 1 || (manageTab === 'people' && i === 0), onclick: () => move(m.table, list, i, i + 1) }, icon('down', 18)),
    h('button', { class: 'iconbtn', title: 'Szerkesztés', 'aria-label': r.name + ' szerkesztése', onclick: () => openRow(r) }, icon('edit', 18)),
    h('button', { class: 'iconbtn', title: canDelete(r) ? 'Törlés' : 'Nem törölhető (belépni tudó személy)', 'aria-label': r.name + ' törlése', disabled: !canDelete(r), onclick: () => deleteRow(manageTab, r) }, icon('trash', 18))));
  return h('div', {},
    h('div', { class: 'pagehead desktop-only' }, h('h1', {}, 'Kezelés')),
    manageTabs(),
    h('p', { class: 'hint' }, m.hint),
    h('div', { class: 'card' }, list.length ? rows : h('div', { class: 'empty' }, 'Még nincs egy sem.')),
    h('div', { class: 'actions', style: 'justify-content:flex-start' }, h('button', { class: 'btn primary', onclick: () => openManageEditor(manageTab, null) }, icon('plus', 18), 'Új ' + m.one)));
}
/** Belépni tudó személy (van e-mailje) és saját magam nem törölhető az appból. */
const canDelete = (r) => !(manageTab === 'people' && (r.email || r.id === me()));

function viewSummary(v) {
  const bits = [v.stores.map(storeName).filter(Boolean).join(', ') || 'nincs bolt'];
  if (v.include_unassigned) bits.push('bolt nélküliek is');
  if (v.show_others) bits.push('máshol szokásosak is');
  if (v.show_people) bits.push('más címzettek is');
  if (v.merged) bits.push('egy listában');
  return bits.join(' · ');
}

async function move(table, list, from, to) {
  for (const r of renumber(list, from, to)) await store.save(table, r, authEmail());
  sync.localChanged();
}

function openManageEditor(tab, row) {
  const m = MANAGE[tab];
  const isNew = !row;
  const hasLook = tab !== 'views';                         // szín (+ ikon) választható
  const icons = tab === 'categories' ? CAT_ICONS : tab === 'people' ? PERSON_ICONS : tab === 'templates' ? TEMPLATE_ICONS : null;
  const base = row || (tab === 'views'
    ? { id: '', name: '', stores: [], include_unassigned: false, show_others: false, show_people: true, sort: 0, deleted: false }
    : { id: '', name: '', color: SWATCHES[0], icon: { categories: 'box', people: 'user', templates: 'template' }[tab] || '', email: '', for: '', sort: 0, deleted: false });
  const badgeFor = (color, ic) => (tab === 'categories' ? catBadge({ ...base, color, icon: ic }, 20) : tab === 'people' ? personBadge({ color, icon: ic }, 20)
    : tab === 'templates' ? templateBadge({ color, icon: ic }, 20) : storeBadge({ color }, 20));
  modal((dlg, close) => {
    const name = h('input', { type: 'text', value: base.name, maxLength: 100 });
    const hasKw = tab === 'stores' || tab === 'people';
    const kw = hasKw ? h('input', { type: 'text', value: base.keywords || '', maxLength: 200, placeholder: tab === 'stores' ? 'pl. lidli, lídl' : 'pl. mama, nyaraló' }) : null;
    // Szín: előre megadott árnyalatok + egyéni választó. Az aktuális értéket a `chosen` tartja.
    let chosen = safeColor(base.color, SWATCHES[0]);
    let chosenIcon = tab === 'categories' ? catIconName(base) : tab === 'people' ? personIconName(base) : tab === 'templates' ? templateIconName(base) : '';
    const forSel = tab === 'templates' ? h('select', {}, h('option', { value: '', selected: !base.for }, 'tételenként / a felvevő'),
      peopleList().map((p) => h('option', { value: p.id, selected: p.id === base.for }, p.id === me() ? p.name + ' (én)' : p.name))) : null;
    const preview = hasLook ? h('span', { class: 'preview' }) : null;
    const paintPreview = () => { if (preview) preview.replaceChildren(badgeFor(chosen, chosenIcon), name.value.trim() || 'Előnézet'); };
    name.addEventListener('input', paintPreview);
    const custom = h('input', { type: 'color', value: chosen, 'aria-label': 'Egyéni szín', title: 'Egyéni szín',
      oninput: (e) => { chosen = e.target.value; markSw(); paintPreview(); } });
    const swatchBtns = SWATCHES.map((c) => {
      const b = h('button', { type: 'button', class: 'swatch', 'aria-label': 'Szín ' + c, onclick: () => { chosen = c; custom.value = c; markSw(); paintPreview(); } });
      b.style.background = c; b.dataset.c = c;
      return b;
    });
    const markSw = () => swatchBtns.forEach((b) => b.classList.toggle('on', b.dataset.c.toLowerCase() === chosen.toLowerCase()));
    const iconBtns = (icons || []).map((n) => {
      const b = h('button', { type: 'button', class: 'iconpick', 'aria-label': 'Ikon: ' + n, onclick: () => { chosenIcon = n; markIc(); paintPreview(); } }, icon(n, 20));
      b.dataset.n = n;
      return b;
    });
    const markIc = () => iconBtns.forEach((b) => b.classList.toggle('on', b.dataset.n === chosenIcon));
    const boxes = tab === 'views' ? storesList().map((s) => ({ id: s.id, el: h('input', { type: 'checkbox', checked: base.stores.includes(s.id) }), name: s.name })) : [];
    const sw = (label, v) => { const el = h('input', { type: 'checkbox', checked: v }); return { el, node: h('label', { class: 'sw' }, el, label) }; };
    const s1 = tab === 'views' ? sw('Bolt nélküli tételek is látszanak', base.include_unassigned) : null;
    const s2 = tab === 'views' ? sw('Máshol szokásos tételek is látszanak (halványan)', base.show_others) : null;
    const s3 = tab === 'views' ? sw('Más címzettek tételei is látszanak', base.show_people) : null;
    const s4 = tab === 'views' ? sw('Egy listában: a máshol szokásos és a más címzetteknek szóló tételek is a kategóriák közé kerülnek (nem külön szakaszban)', !!base.merged) : null;
    dlg.append(
      h('h3', {}, isNew ? 'Új ' + m.one : m.One + ' szerkesztése'),
      h('label', { class: 'f' }, 'Név'), name,
      tab === 'people' && base.email ? h('p', { class: 'muted small' }, `Belépési e-mail: ${base.email} (csak a Sheetben módosítható)`) : null,
      hasKw ? h('div', {}, h('label', { class: 'f' }, 'Keresőszavak a gyors bevitelhez (vesszővel elválasztva)'), kw,
        h('p', { class: 'muted small', style: 'margin:4px 0 0' }, 'A nevet magától is felismeri, kis- és nagybetűtől, ékezettől és ragtól függetlenül (pl. „Lidlbe”, „nagyinak”). Ide csak a becenevek, más írásmódok kellenek.')) : null,
      forSel ? h('div', {}, h('label', { class: 'f' }, 'Alapértelmezett címzett (pl. „Hétvégi ház”)'), forSel) : null,
      icons ? h('div', {}, h('label', { class: 'f' }, 'Piktogram'), h('div', { class: 'iconpicks' }, iconBtns)) : null,
      hasLook ? h('div', {}, h('label', { class: 'f' }, 'Szín'), h('div', { class: 'swatches' }, swatchBtns, custom)) : null,
      preview ? h('div', { class: 'previewrow' }, preview) : null,
      tab === 'views' ? h('div', {}, h('label', { class: 'f' }, 'Boltok, ahol ezt a nézetet használod'),
        h('div', { class: 'checks' }, boxes.map((b) => h('label', {}, b.el, b.name))), s1.node, s2.node, s3.node, s4.node) : null,
      h('div', { class: 'actions' },
        h('button', { class: 'btn', onclick: close }, 'Mégse'),
        h('button', { class: 'btn primary', onclick: async () => {
          const n = name.value.trim();
          if (!n) { name.focus(); return; }
          const all = store.list(m.table);
          const next = { ...base, name: n };
          if (isNew) {
            next.id = slug(n, new Set(all.map((r) => r.id)));
            next.sort = Math.max(0, ...all.filter((r) => !r.deleted).map((r) => r.sort || 0)) + 10;
          }
          if (hasLook) next.color = chosen;
          if (hasKw) next.keywords = kw.value.split(',').map((s) => s.trim()).filter(Boolean).join(', ');
          if (icons) next.icon = chosenIcon;
          if (forSel) next.for = forSel.value;
          if (tab === 'views') {
            next.stores = boxes.filter((b) => b.el.checked).map((b) => b.id);
            next.include_unassigned = s1.el.checked; next.show_others = s2.el.checked; next.show_people = s3.el.checked; next.merged = s4.el.checked;
          }
          await saveRow(m.table, next);
          close();
          if (tab === 'templates' && isNew) openTemplate(next.id);   // új sablon: rögtön a tételeihez
        } }, 'Mentés')));
    markSw(); markIc(); paintPreview();
    name.focus();
  });
}

async function deleteRow(tab, row) {
  const extra = { categories: ' A hozzá tartozó tételek „Egyéb” alá kerülnek.', stores: ' A tételekről és a nézetekből is lekerül.',
    people: ' A neki szóló tételek „közös” tételek lesznek.', views: '', templates: ' A sablon tételei is törlődnek (a listán lévő tételek nem).' }[tab];
  if (!confirm(`Biztosan törlöd: „${row.name}”?${extra}`)) return;
  const by = authEmail();
  if (tab === 'categories') {
    for (const it of store.list('Items')) if (it.category === row.id) await store.save('Items', { ...it, category: '' }, by);
    await store.remove('Categories', row, by);
  } else if (tab === 'stores') {
    for (const it of store.list('Items')) if (it.stores.includes(row.id)) await store.save('Items', { ...it, stores: it.stores.filter((s) => s !== row.id) }, by);
    for (const v of store.list('Views')) if (v.stores.includes(row.id)) await store.save('Views', { ...v, stores: v.stores.filter((s) => s !== row.id) }, by);
    await store.remove('Stores', row, by);
  } else if (tab === 'people') {
    for (const it of store.list('Items')) if (isOpen(it) && it.for === row.id) await store.save('Items', { ...it, for: '' }, by);
    if (personFilter === row.id) { personFilter = ''; ls.set('person', ''); }
    await store.remove('People', row, by);
  } else if (tab === 'templates') {
    for (const ti of templateItemsOf(row.id)) await store.remove('TemplateItems', ti, by);
    await store.remove('Templates', row, by);
    if (page === 'template' && templateId === row.id) { page = 'manage'; manageTab = 'templates'; }
  } else {
    if (viewId === row.id) { viewId = '__all'; ls.set('viewId', viewId); }
    await store.remove('Views', row, by);
  }
  sync.localChanged();
  toast('Törölve');
}

// ---- Menü ----
/** A szinkron-jelző és a monogram a Fiók oldalt nyitja (szinkron, kijelentkezés, menü sorrendje). */
function openMenu() { go('account'); }

/** Minden felhasználóhoz kötött helyi nyom törlése (kijelentkezés / felhasználóváltás előtt). */
async function clearUserTraces() {
  for (const k of ['auth', 'owner', 'catalogSeeded', 'syncLog', 'lastSyncOk', 'lastSyncError', 'dataVersion']) await store.delMeta(k);
  await store.setMeta('since', 0);
}

/** A helyi adatok gazdája: akinek a belépésével kerültek ide (régi telepítésnél a bejelentkezett felhasználó). */
const dataOwner = () => store.getMeta('owner', null) || (sync.getAuth() || {}).email || null;

// A demó mintaadatok azonosítói (seed.json). Régebbi verzió szinkron módban is betölthette / feltölthette őket.
const DEMO_IDS = { Stores: ['lidl', 'tesco', 'dm'], People: ['nagyi', 'hetvegi-haz'], Views: ['lidl-gyors', 'tesco-nagy', 'dm-gyors'],
  Items: ['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'h7'], Templates: ['havi', 'hetvegi-alap'],
  TemplateItems: ['t1', 't2', 't3', 't4', 't5', 't6', 't7', 't8', 't9', 't10'] };

/**
 * Egyszeri takarítás szinkron módban: a készüléken maradt demó sorok és a még fel nem küldött demó változások törlése
 * (különben egy szerkesztéskor felkerülnének a Sheetbe). A szerverről a GAS purgeDemo() függvénye takarít.
 */
async function purgeLocalDemo() {
  if (!backend.enabled() || CONFIG.MOCK_AUTH || store.getMeta('demoPurged', false)) return;   // a mock szerver épp a demó adatokkal fut
  await store.dropLocal(DEMO_IDS);
  await store.setMeta('demoPurged', true);
}

async function logout() {
  if (store.pendingCount() && !confirm(`${store.pendingCount()} még el nem küldött változás elvész. Biztosan kijelentkezel?`)) return;
  await store.wipeData();
  await clearUserTraces();
  location.reload();
}

// ---- Bejelentkezés ----
function renderLogin() {
  const box = h('div', { id: 'gbtn', style: 'display:flex;justify-content:center' });
  $app.replaceChildren(h('div', { class: 'login' }, h('img', { class: 'logo-lg', src: 'icons/logo.svg', alt: '' }), h('h1', {}, 'Liszt'), h('p', { class: 'muted' }, 'Jelentkezz be a szinkronhoz.'), box,
    h('p', { class: 'muted', id: 'loginmsg' }),
    sync.getAuth() || !dataOwner() || !store.list('Items').length ? null : h('button', { class: 'btn', onclick: () => { needLogin = false; render(); } }, 'Offline folytatás')));
  if (CONFIG.MOCK_AUTH) {
    box.append(h('button', { class: 'btn primary', onclick: () => doLogin('mock:' + (prompt('Mock személy id (pl. en, nagyi):', 'en') || 'en')) }, 'Belépés (mock)'));
  } else loadGsi(box);
}

function loadGsi(box) {
  const init = () => {
    window.google.accounts.id.initialize({ client_id: CONFIG.GOOGLE_CLIENT_ID, callback: (r) => doLogin(r.credential), auto_select: false });
    window.google.accounts.id.renderButton(box, { theme: 'outline', size: 'large', locale: 'hu' });
  };
  if (window.google && window.google.accounts) return init();
  const s = document.createElement('script');
  s.src = 'https://accounts.google.com/gsi/client';
  s.async = true; s.onload = init;
  s.onerror = () => { document.getElementById('loginmsg').textContent = 'A Google bejelentkezés most nem érhető el (offline?).'; };
  document.head.append(s);
}

async function doLogin(idToken) {
  const msg = document.getElementById('loginmsg');
  try {
    const res = await backend.login(idToken);
    if (!res.ok) {
      msg.textContent = { not_allowed: 'Ez az e-mail-cím nincs engedélyezve.', invalid_token: 'Érvénytelen bejelentkezés.', wrong_client: 'Hibás Client ID beállítás.' }[res.error] || 'Hiba: ' + res.error;
      return;
    }
    // Más felhasználó adata – vagy gazda nélküli (pl. demó módban betöltött mintaadat) – nem keveredhet az övével,
    // és nem kerülhet fel a szerverre: belépés előtt töröljük. (Ugyanaz a felhasználó újra belépve megtartja a sorát.)
    if (dataOwner() !== res.email) { await store.wipeData(); await clearUserTraces(); }
    await store.setMeta('owner', res.email);
    await sync.setAuth({ token: res.token, exp: res.exp, email: res.email, personId: res.personId, name: res.name });
    needLogin = false;
    render();
    sync.runSync();
  } catch (e) { console.error('login hiba', e); msg.textContent = 'Hiba a bejelentkezésnél, próbáld újra.'; }
}

// ---- Indulás ----
async function main() {
  await store.init();
  sync.initStatus();
  await seedIfEmpty();
  await purgeLocalDemo();
  if (!store.getMeta('owner', null) && sync.getAuth()) await store.setMeta('owner', sync.getAuth().email);   // régebbi telepítés
  // gazda nélküli helyi adattal (pl. demóból maradt) nem lehet belépés nélkül továbbmenni
  needLogin = backend.enabled() && !sync.getAuth() && (!dataOwner() || !store.list('Items').length);
  store.onChange(render);
  sync.onStatus((st) => {
    const q = document.activeElement; if (!(q && q.tagName === 'INPUT' && q.id === 'q' && q.value)) render();
    if (st.kind === 'ok') maybeSeedCatalog();   // szinkron módban csak az első sikeres szinkron után (ha a szerveren már van, nem tölt)
  });
  if (!backend.enabled()) await maybeSeedCatalog();
  render();
  sync.startTriggers();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
}
main();

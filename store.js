// IndexedDB + memóriabeli állapot + szinkronsor + merge.
import { splitQty, normUnit } from './logic.js';
export const TABLES = ['Items', 'Categories', 'Stores', 'People', 'Views', 'Templates', 'TemplateItems', 'Products', 'Units'];
// 'liszt': tiszta induláskor új név – a régi ('bevasarlo') helyi tár (demó / régi adat) így egyik eszközön sem töltődik be.
const DB_NAME = 'liszt';
const listeners = new Set();
let db;
export const state = Object.fromEntries(TABLES.map((t) => [t, new Map()]));
let queue = new Map(); // "Tábla|id" -> {key,t,r}
let meta = {};

export const onChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
const emit = () => listeners.forEach((fn) => { try { fn(); } catch (e) { console.error(e); } });

function req(r) {
  return new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
}
function tx(names, mode = 'readonly') { return db.transaction(names, mode); }

export async function init() {
  db = await new Promise((resolve, reject) => {
    const o = indexedDB.open(DB_NAME, 5);
    o.onupgradeneeded = () => {
      const d = o.result;
      for (const t of TABLES) if (!d.objectStoreNames.contains(t)) d.createObjectStore(t, { keyPath: 'id' });
      if (!d.objectStoreNames.contains('queue')) d.createObjectStore('queue', { keyPath: 'key' });
      if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta', { keyPath: 'k' });
    };
    o.onsuccess = () => resolve(o.result);
    o.onerror = () => reject(o.error);
  });
  for (const t of TABLES) {
    // normalizálás betöltéskor is (régebbi verzió által mentett sorok, pl. „2 l” mennyiség)
    for (const row of await req(tx(t).objectStore(t).getAll())) state[t].set(row.id, fromWire(t, row));
  }
  for (const q of await req(tx('queue').objectStore('queue').getAll())) queue.set(q.key, q);
  for (const m of await req(tx('meta').objectStore('meta').getAll())) meta[m.k] = m.v;
}

export const getMeta = (k, dflt) => (k in meta ? meta[k] : dflt);
export async function setMeta(k, v) {
  meta[k] = v;
  await req(tx('meta', 'readwrite').objectStore('meta').put({ k, v }));
}
export async function delMeta(k) {
  delete meta[k];
  await req(tx('meta', 'readwrite').objectStore('meta').delete(k));
}

export const list = (t) => [...state[t].values()];
export const pendingCount = () => queue.size;
/** Helyi sorok száma táblánként (a szerverrel való egyeztetéshez; csak üres feltöltési sornál összevethető). */
export const counts = () => Object.fromEntries(TABLES.map((t) => [t, state[t].size]));
export const getQueue = () => [...queue.values()];

export const uuid = () =>
  (crypto.randomUUID ? crypto.randomUUID() : 'id-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10));

/** Helyi módosítás: mentés + szinkronsorba. */
export async function save(t, row, by = '') {
  const r = { ...row, updated_at: Date.now() };
  if (t === 'Items') r.updated_by = by;
  state[t].set(r.id, r);
  const q = { key: t + '|' + r.id, t, r };
  queue.set(q.key, q);
  const x = tx([t, 'queue'], 'readwrite');
  x.objectStore(t).put(r);
  x.objectStore('queue').put(q);
  await new Promise((res, rej) => { x.oncomplete = res; x.onerror = () => rej(x.error); });
  emit();
  return r;
}

/** Puha törlés (tombstone). */
export const remove = (t, row, by) => save(t, { ...row, deleted: true }, by);

/** Elküldött sorelemek törlése – csak ha közben nem változtak. */
export async function clearQueue(sent) {
  const x = tx('queue', 'readwrite');
  for (const s of sent) {
    const cur = queue.get(s.key);
    if (cur && cur.r.updated_at === s.r.updated_at) {
      queue.delete(s.key);
      x.objectStore('queue').delete(s.key);
    }
  }
  await new Promise((res) => { x.oncomplete = res; x.onerror = res; });
}

/** Szerverről érkező rekordok beolvasása (nem kerülnek a sorba). */
export async function applyIncoming(data) {
  if (!TABLES.some((t) => (data[t] || []).length)) return;   // nincs új adat: ne rajzoljon újra
  const x = tx(TABLES, 'readwrite');
  let changed = 0;
  for (const t of TABLES) {
    for (const wire of data[t] || []) {
      const row = fromWire(t, wire);
      if (!row.id) continue;
      const queued = queue.get(t + '|' + row.id);
      if (queued && queued.r.updated_at > row.updated_at) continue; // újabb helyi változás vár
      const local = state[t].get(row.id);
      if (local && local.updated_at > row.updated_at) continue;
      // az átfedési ablak miatt újra megkapott, már meglévő sor: nem változás
      if (local && local.updated_at === row.updated_at && JSON.stringify(toWire(t, local)) === JSON.stringify(toWire(t, row))) continue;
      state[t].set(row.id, row);
      x.objectStore(t).put(row);
      changed++;
    }
  }
  await new Promise((res, rej) => { x.oncomplete = res; x.onerror = () => rej(x.error); });
  if (changed) emit();
}

/**
 * Teljes újratöltés után: a szerveren nem létező helyi sorok eltávolítása (a feltöltésre váró sorok maradnak).
 * Csak since=0 válasznál hívható – ott a szerver az összes sort visszaadja.
 */
export async function pruneToServer(data) {
  const x = tx(TABLES, 'readwrite');
  let removed = 0;
  for (const t of TABLES) {
    const ids = new Set((data[t] || []).map((w) => String(w.id)));
    for (const id of [...state[t].keys()]) {
      if (ids.has(id) || queue.has(t + '|' + id)) continue;
      state[t].delete(id);
      x.objectStore(t).delete(id);
      removed++;
    }
  }
  await new Promise((res, rej) => { x.oncomplete = res; x.onerror = () => rej(x.error); });
  if (removed) emit();
  return removed;
}

/**
 * Mentésfájlból (export) érkező sorok felvétele a szinkronsorba. Az eredeti updated_at megmarad, így egy újabb
 * (helyi vagy szerveroldali) sort nem ír felül; a People e-mailje nem importálható, meglévő személyt nem módosít.
 * -> {added, updated}
 */
export async function importRows(t, rows) {
  if (!TABLES.includes(t) || !Array.isArray(rows)) return { added: 0, updated: 0 };
  let added = 0, updated = 0;
  const x = tx([t, 'queue'], 'readwrite');
  for (const w of rows) {
    if (!w || typeof w !== 'object') continue;
    const row = fromWire(t, w);
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(row.id)) continue;
    const local = state[t].get(row.id);
    if (t === 'People') { if (local) continue; row.email = ''; }
    if (local && local.updated_at >= row.updated_at) continue;
    delete row.server_ts;
    state[t].set(row.id, row);
    const q = { key: t + '|' + row.id, t, r: row };
    queue.set(q.key, q);
    x.objectStore(t).put(row);
    x.objectStore('queue').put(q);
    if (local) updated++; else added++;
  }
  await new Promise((res, rej) => { x.oncomplete = res; x.onerror = () => rej(x.error); });
  if (added || updated) emit();
  return { added, updated };
}

/** Minden helyi adat törlése (kijelentkezés + teljes újratöltés előtt). */
export async function wipeData(keepQueue = false) {
  const names = keepQueue ? TABLES : [...TABLES, 'queue'];
  const x = tx(names, 'readwrite');
  for (const n of names) x.objectStore(n).clear();
  await new Promise((res) => { x.oncomplete = res; x.onerror = res; });
  for (const t of TABLES) state[t].clear();
  if (!keepQueue) queue.clear();
  emit();
}

// ---- Wire <-> kliens formátum ----
const bool = (v) => v === true || v === 1 || /^(true|1|igaz)$/i.test(String(v));
const csv = (v) => (Array.isArray(v) ? v : String(v ?? '').split(',').map((s) => s.trim()).filter(Boolean));
const str = (v) => (v == null ? '' : String(v));
// ismert egység: a kanonikus név; ismeretlen (pl. már törölt egyéni egység): marad a szöveg, hogy ne vesszen el
const unitOf = (u) => normUnit(u) || str(u).trim();

function fromWire(t, w) {
  const r = { ...w };
  r.id = str(w.id);
  r.updated_at = Number(w.updated_at) || 0;
  r.deleted = bool(w.deleted);
  if (t === 'Items') {
    r.name = str(w.name); r.qty = str(w.qty); r.note = str(w.note);
    r.category = str(w.category); r.for = str(w.for); r.updated_by = str(w.updated_by);
    r.stores = csv(w.stores); r.urgent = bool(w.urgent); r.checked = bool(w.checked);
    // mennyiség: szám + egység (a régi „2 l” formát itt bontjuk szét)
    const q = splitQty(w.qty, unitOf(w.unit));
    r.qty = q.qty; r.unit = q.unit;
    r.bought_at = Number(w.bought_at) || 0; r.bought_store = str(w.bought_store);
  } else if (t === 'Stores' || t === 'Categories') {
    r.name = str(w.name); r.color = str(w.color); r.sort = Number(w.sort) || 0;
    if (t === 'Categories') r.icon = str(w.icon);
    if (t === 'Stores') r.keywords = str(w.keywords);
  } else if (t === 'People') {
    r.name = str(w.name); r.email = str(w.email); r.color = str(w.color); r.icon = str(w.icon); r.sort = Number(w.sort) || 0; r.keywords = str(w.keywords);
  } else if (t === 'Products') {
    r.name = str(w.name); r.category = str(w.category); r.unit = unitOf(w.unit); r.stores = csv(w.stores); r.keywords = str(w.keywords);
  } else if (t === 'Units') {
    r.name = str(w.name); r.step = Number(w.step) > 0 ? Number(w.step) : 1; r.sort = Number(w.sort) || 0;
  } else if (t === 'Templates') {
    r.name = str(w.name); r.color = str(w.color); r.icon = str(w.icon); r.for = str(w.for); r.sort = Number(w.sort) || 0;
  } else if (t === 'TemplateItems') {
    r.template = str(w.template); r.name = str(w.name); r.category = str(w.category); r.for = str(w.for);
    r.stores = csv(w.stores); r.sort = Number(w.sort) || 0;
    const q = splitQty(w.qty, unitOf(w.unit));
    r.qty = q.qty; r.unit = q.unit;
  } else if (t === 'Views') {
    r.name = str(w.name); r.stores = csv(w.stores); r.sort = Number(w.sort) || 0;
    r.include_unassigned = bool(w.include_unassigned);
    r.show_others = bool(w.show_others); r.show_people = bool(w.show_people); r.merged = bool(w.merged);
  }
  return r;
}

export function toWire(t, r) {
  const w = { ...r };
  if (Array.isArray(w.stores)) w.stores = w.stores.join(',');
  delete w.server_ts;
  return w;
}

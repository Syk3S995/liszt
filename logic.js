// Tiszta nézetlogika – nincs DOM, nincs IndexedDB, így egyszerűen tesztelhető.

/** A tétel a bejelentkezett felhasználóé / közös? (üres „kinek” vagy saját személy) */
function isOwn(item, me) {
  return !item.for || item.for === me;
}

/**
 * Melyik szakaszba esik a (nem kipipáltként tekintett) tétel a nézetben?
 * -> 'here' | 'elsewhere' | 'people' | null (nem látszik)
 */
export function classify(item, view, me) {
  const stores = item.stores || [];
  const viewStores = view.stores || [];
  const matches = stores.length
    ? stores.some((s) => viewStores.includes(s))
    : !!view.include_unassigned;
  const elsewhere = stores.length > 0 && !matches && !!view.show_others;
  if (!matches && !elsewhere) return null;
  if (isOwn(item, me)) return matches ? 'here' : 'elsewhere';
  return view.show_people ? 'people' : null;
}

/** Kategória-sorrend: id -> index (sort, majd név szerint; törölt kategória nem számít). */
export function categoryOrder(categories) {
  const live = categories.filter((c) => !c.deleted)
    .sort((a, b) => (a.sort - b.sort) || String(a.name).localeCompare(String(b.name), 'hu'));
  return new Map(live.map((c, i) => [c.id, i]));
}

const idx = (order, cat) => (order && order.has(cat) ? order.get(cat) : Number.MAX_SAFE_INTEGER);

/** sürgős → kategória-sorrend → név */
function compareItems(a, b, order) {
  if (!!a.urgent !== !!b.urgent) return a.urgent ? -1 : 1;
  const ia = idx(order, a.category), ib = idx(order, b.category);
  if (ia !== ib) return ia < ib ? -1 : 1;
  return String(a.name).localeCompare(String(b.name), 'hu');
}

/**
 * Szakaszokra bontás.
 * view: {all?, stores[], include_unassigned, show_others, show_people}
 * opts.person: ha megadott, a személy összes tétele (bolttól függetlenül).
 * opts.catOrder: categoryOrder() eredménye.
 * Vissza: {here, elsewhere, people, cart} – rendezett tömbök.
 */
export function buildSections(items, view, me, opts = {}) {
  const out = { here: [], elsewhere: [], people: [], cart: [] };
  for (const it of items) {
    if (it.deleted || it.bought_at > 0) continue;   // a megvett (naplózott) tétel már nincs a listán
    let sec;
    if (opts.person) sec = it.for === opts.person ? 'here' : null;
    else if (view && view.all) sec = 'here';
    else sec = classify(it, view, me);
    if (!sec) continue;
    (it.checked ? out.cart : out[sec]).push(it);
  }
  for (const k of Object.keys(out)) out[k].sort((a, b) => compareItems(a, b, opts.catOrder));
  return out;
}

/**
 * „Egy listában” mód: az ide való, a máshol szokásos és a más címzetteknek szóló tételek egy közös,
 * kategória szerint rendezett listában. A secOf megmondja, honnan jött a tétel (jelöléshez).
 * -> {list, secOf: Map(id -> 'here'|'elsewhere'|'people')}
 */
export function mergeSections(sec, catOrder) {
  const secOf = new Map();
  const list = [];
  for (const k of ['here', 'elsewhere', 'people']) for (const it of sec[k]) { secOf.set(it.id, k); list.push(it); }
  list.sort((a, b) => compareItems(a, b, catOrder));
  return { list, secOf };
}

/**
 * Kategória szerinti csoportosítás. A kategóriák sorrendje a `categories` szerint;
 * ismeretlen / törölt kategóriájú tételek a végén, „Egyéb” néven.
 * A tételek tetszőleges sorrendben jöhetnek (a csoporton belüli sorrend megmarad).
 * Vissza: [{id, name, color, items[]}] – csak nem üres csoportok.
 */
export function groupByCategory(list, categories) {
  const live = categories.filter((c) => !c.deleted);
  const order = categoryOrder(live);
  const byId = new Map(live.map((c) => [c.id, c]));
  const groups = new Map();
  for (const it of list) {
    const key = byId.has(it.category) ? it.category : '';
    if (!groups.has(key)) {
      const c = byId.get(key);
      groups.set(key, { id: key, name: c ? c.name : 'Egyéb', color: c ? c.color : '', icon: c ? c.icon || '' : '', items: [] });
    }
    groups.get(key).items.push(it);
  }
  return [...groups.values()].sort((a, b) => idx(order, a.id) - idx(order, b.id));
}

/** Névjavaslatok a korábbi (akár törölt) tételekből; legutóbbi verzió nyer. */
export function suggestions(items, query, limit = 8) {
  const q = query.trim().toLocaleLowerCase('hu');
  if (!q) return [];
  const latest = new Map();
  for (const it of items) {
    const k = String(it.name).toLocaleLowerCase('hu');
    const prev = latest.get(k);
    if (!prev || it.updated_at > prev.updated_at) latest.set(k, it);
  }
  const hits = [...latest.entries()].filter(([k]) => k.includes(q));
  hits.sort((a, b) => (a[0].startsWith(q) ? 0 : 1) - (b[0].startsWith(q) ? 0 : 1) || a[0].localeCompare(b[0], 'hu'));
  return hits.slice(0, limit).map(([, it]) => it);
}

/** Új tétel alapértelmezett boltja: ha a nézetnek pontosan egy boltja van. */
export function defaultStoresForView(view) {
  return view && !view.all && view.stores && view.stores.length === 1 ? [...view.stores] : [];
}

/** Sorrend-átszámozás: a lista (már rendezett) elemeit 10-es lépésekkel újraszámozza; csak a változók jönnek vissza. */
export function renumber(list, from, to) {
  const arr = [...list];
  const [moved] = arr.splice(from, 1);
  arr.splice(to, 0, moved);
  const changed = [];
  arr.forEach((r, i) => { const s = (i + 1) * 10; if (r.sort !== s) changed.push({ ...r, sort: s }); });
  return changed;
}

// ---------- Mennyiség és egység ----------

/** Mértékegységek és a léptetés lépésköze. */
const DEFAULT_UNITS = [
  { id: 'db', step: 1 }, { id: 'kg', step: 0.5 }, { id: 'dkg', step: 10 }, { id: 'g', step: 100 },
  { id: 'l', step: 0.5 }, { id: 'dl', step: 1 }, { id: 'csomag', step: 1 }, { id: 'doboz', step: 1 }, { id: 'üveg', step: 1 },
  { id: 'karton', step: 1 },
];
const BASE_ALIASES = { darab: 'db', kiló: 'kg', kilo: 'kg', deka: 'dkg', dag: 'dkg', gr: 'g', gramm: 'g', liter: 'l', deci: 'dl', cs: 'csomag', uveg: 'üveg' };
const NUM = '(\\d+\\/\\d+|\\d+(?:[.,]\\d+)?)';
const esc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export let UNITS = DEFAULT_UNITS;     // a Kezelés → Mennyiségek lapon szerkeszthető; setUnits() cseréli
let UNIT_ALIASES = Object.create(null), UNIT_RE = '', QTY_TOKEN, UNIT_TOKEN, unitsKey = '';
/** list: [{id: név, step}] – üres lista esetén az alap egységek. A gyors bevitel felismerése is ezt használja. */
export function setUnits(list) {
  const u = (list && list.length ? list : DEFAULT_UNITS).map((x) => ({ id: String(x.id), step: Number(x.step) > 0 ? Number(x.step) : 1 }));
  const key = JSON.stringify(u);
  if (key === unitsKey) return;
  unitsKey = key; UNITS = u;
  UNIT_ALIASES = Object.create(null);   // nem örököl: a „constructor” / „__proto__” nem lehet egység
  for (const [al, id] of Object.entries(BASE_ALIASES)) if (u.some((x) => x.id === id)) UNIT_ALIASES[al] = id;
  for (const x of u) UNIT_ALIASES[x.id.toLocaleLowerCase('hu')] = x.id;
  UNIT_RE = Object.keys(UNIT_ALIASES).sort((x, y) => y.length - x.length).map(esc).join('|');
  QTY_TOKEN = new RegExp('^' + NUM + '(?:(' + UNIT_RE + ')\\.?|x|×)?$', 'iu');
  UNIT_TOKEN = new RegExp('^(?:' + UNIT_RE + ')\\.?$', 'iu');
}
setUnits(DEFAULT_UNITS);

export function normUnit(u) {
  return UNIT_ALIASES[String(u || '').trim().toLocaleLowerCase('hu')] || '';
}
const unitStep = (u) => (UNITS.find((x) => x.id === u) || { step: 1 }).step;

/** "1/2" -> 0.5, "1,5" -> 1.5, "2" -> 2; egyébként NaN */
function parseNum(s) {
  const t = String(s ?? '').trim();
  const fr = /^(\d+)\/(\d+)$/.exec(t);
  if (fr) return Number(fr[2]) ? Number(fr[1]) / Number(fr[2]) : NaN;
  return /^\d+(?:[.,]\d+)?$/.test(t) ? Number(t.replace(',', '.')) : NaN;
}
const numStr = (n) => String(Math.round(n * 1000) / 1000);

/** Régi, szabad szöveges mennyiség („2 l”, „1/2 kg”, „10 db”) szétbontása szám + egységre. */
export function splitQty(qty, unit) {
  const q = String(qty ?? '').trim();
  if (unit) return { qty: q, unit };
  if (!q) return { qty: '', unit: '' };
  const m = new RegExp('^' + NUM + '\\s*(' + UNIT_RE + ')?\\.?$', 'iu').exec(q);
  if (m) return { qty: numStr(parseNum(m[1])), unit: normUnit(m[2]) };
  return { qty: q, unit: '' };   // nem értelmezhető (pl. „M-es”) -> marad szövegként
}

/** Megjelenítés: „1,5 kg”, „10 db”, „2”. */
export function formatQty(qty, unit) {
  const q = String(qty ?? '').trim();
  if (!q) return '';
  const n = Number(q);
  const s = Number.isFinite(n) ? n.toLocaleString('hu-HU', { maximumFractionDigits: 3 }) : q;
  return unit ? s + ' ' + unit : s;
}

/** Léptetés az egység lépésközével; a minimum egy lépés. */
export function stepQty(qty, unit, dir) {
  const step = unitStep(unit);
  const n = Number(qty);
  const cur = Number.isFinite(n) && String(qty).trim() !== '' ? n : 0;
  if (cur === 0 && dir > 0) return numStr(step);
  return numStr(Math.max(step, cur + dir * step));
}

/**
 * Gyors bevitel értelmezése: „2 kg alma”, „2kg alma”, „alma 2 kg”, „3 tej”, „2x tej”, „tej 2”.
 * -> {name, qty, unit} (qty üres, ha nem volt benne szám)
 */
export function parseQuick(text) {
  const t = String(text || '').trim().replace(/\s+/g, ' ');
  let m = new RegExp('^' + NUM + '\\s*(?:(' + UNIT_RE + ')\\.?|x|×)?\\s+(.+)$', 'iu').exec(t);
  if (m) return { name: m[3].trim(), qty: numStr(parseNum(m[1])), unit: normUnit(m[2]) };
  m = new RegExp('^(.+?)\\s+' + NUM + '\\s*(?:(' + UNIT_RE + ')\\.?|x|×)?$', 'iu').exec(t);
  if (m) return { name: m[1].trim(), qty: numStr(parseNum(m[2])), unit: normUnit(m[3]) };
  return { name: t, qty: '', unit: '' };
}

// ---------- Okos bevitel: bolt és címzett felismerése ----------

/** Kisbetű, ékezet nélkül: „Hétvégi Ház” -> „hetvegi haz”. */
export const normText = (s) => String(s || '').toLocaleLowerCase('hu').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();

/** Gyakori magyar ragok, amelyekkel a bolt/címzett a mondat végén előfordul („lidlbe”, „nagyinak”, „hétvégi házba”). */
const SUFFIXES = ['', 'ba', 'be', 'ban', 'ben', 'bol', 'bul', 'nak', 'nek', 'ra', 're', 'ert', 'hoz', 'hez', 'hoz', 'nal', 'nel', 'tol', 'es', 'os', 'as', 's'];

/**
 * Keresőszavak egy bolthoz/címzetthez: a neve, az id-ja és a megadott kulcsszavak (vesszővel), normalizálva.
 * -> [['hetvegi','haz'], ['nyaralo'], …] (szavakra bontva), a hosszabbak elöl.
 */
export function entityKeys(e) {
  const raw = [e.name, String(e.id || '').replace(/-/g, ' '), ...String(e.keywords || '').split(',')];
  const keys = [...new Set(raw.map(normText).filter((k) => k.length >= 2))];
  return keys.map((k) => k.split(' ')).sort((a, b) => b.length - a.length || b.join(' ').length - a.join(' ').length);
}

/** Egyezik-e a token a kulcsszóval (pontosan, vagy kötőjeles/ragozott alakban). */
function tokenMatches(tok, key, allowSuffix) {
  const t = normText(tok).replace(/^@/, '');
  if (t === key) return true;
  if (!allowSuffix || !t.startsWith(key)) return false;
  let rest = t.slice(key.length);
  // rövid (2 betűs) kulcsnál csak kötőjeles rag fogadható el („dm-be”), különben túl sok lenne a véletlen egyezés
  if (key.length < 3 && rest && !rest.startsWith('-')) return false;
  rest = rest.replace(/^-/, '');
  return SUFFIXES.includes(rest);
}

function matchEntityAt(tokens, end, entities, ignore) {
  // a tokens[...end] végére illeszkedő leghosszabb kulcsszó
  let best = null;
  for (const e of entities) {
    if (ignore && ignore.has(e.id)) continue;
    for (const words of e.keys) {
      const n = words.length;
      if (n > end + 1) continue;
      const start = end - n + 1;
      let ok = true;
      for (let i = 0; i < n; i++) if (!tokenMatches(tokens[start + i], words[i], i === n - 1)) { ok = false; break; }
      if (ok && (!best || n > best.n)) best = { id: e.id, n, start };
    }
  }
  return best;
}


/**
 * Okos gyors bevitel: mennyiség (elöl vagy hátul), valamint a sor VÉGÉN álló bolt és címzett.
 * Pl. „alma 2 kg lidl”, „tej 2 l nagyinak”, „gyújtós hétvégi házba tesco”, „2 kg alma @lidl”.
 * A „@” előtagú szó bárhol állhat; enélkül csak a sor végén ismerjük fel (így pl. a „Tesco kenyér” neve nem sérül).
 * opts: {stores:[{id,keys}], people:[{id,keys}], ignore:Set(id)}
 * -> {name, qty, unit, store, person}
 */
export function parseSmart(text, opts = {}) {
  const stores = opts.stores || [], people = opts.people || [], ignore = opts.ignore;
  let tokens = String(text || '').trim().split(/\s+/).filter(Boolean);
  let store = '', person = '', qty = '', unit = '';
  // 1) „@szó” bárhol
  tokens = tokens.filter((tok) => {
    if (!tok.startsWith('@') || tok.length < 2) return true;
    const one = [tok];
    const s = !store && matchEntityAt(one, 0, stores, ignore);
    if (s && s.n === 1) { store = s.id; return false; }
    const p = !person && matchEntityAt(one, 0, people, ignore);
    if (p && p.n === 1) { person = p.id; return false; }
    return true;
  });
  // 2) a sor végéről: bolt, címzett, mennyiség – tetszőleges sorrendben
  for (let guard = 0; guard < 6 && tokens.length > 1; guard++) {
    const end = tokens.length - 1;
    const s = !store && matchEntityAt(tokens, end, stores, ignore);
    const p = !person && matchEntityAt(tokens, end, people, ignore);
    const hit = s && p ? (s.n >= p.n ? s : p) : s || p;
    if (hit && hit.start >= 1) {
      if (hit === s) store = s.id; else person = p.id;
      tokens = tokens.slice(0, hit.start);
      continue;
    }
    if (!qty) {
      const m = QTY_TOKEN.exec(tokens[end]);
      if (m && end >= 1) { qty = numStr(parseNum(m[1])); unit = normUnit(m[2]); tokens = tokens.slice(0, end); continue; }
      if (UNIT_TOKEN.test(tokens[end]) && end >= 2 && /^\d/.test(tokens[end - 1])) {
        const n = parseNum(tokens[end - 1]);
        if (Number.isFinite(n)) { qty = numStr(n); unit = normUnit(tokens[end]); tokens = tokens.slice(0, end - 1); continue; }
      }
    }
    break;
  }
  // 3) a maradék: mennyiség elöl („2 kg alma”) – ha még nem volt
  const rest = tokens.join(' ');
  if (!qty) { const q = parseQuick(rest); return { name: q.name, qty: q.qty, unit: q.unit, store, person }; }
  return { name: rest, qty, unit, store, person };
}

// ---------- Vásárlási napló és gyakori tételek ----------

const dayKey = (ts) => { const d = new Date(ts); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
export { dayKey };

/**
 * Napló: a megvett tételek napok (újak elöl), azon belül boltok szerint.
 * -> [{day, ts, groups:[{store, ts, items[]}]}]
 */
export function journal(items) {
  const days = new Map();
  for (const it of items) {
    if (it.deleted || !(it.bought_at > 0)) continue;
    const k = dayKey(it.bought_at);
    if (!days.has(k)) days.set(k, { day: k, ts: 0, stores: new Map() });
    const d = days.get(k);
    d.ts = Math.max(d.ts, it.bought_at);
    const sk = it.bought_store || '';
    if (!d.stores.has(sk)) d.stores.set(sk, { store: sk, ts: 0, items: [] });
    const g = d.stores.get(sk);
    g.ts = Math.max(g.ts, it.bought_at);
    g.items.push(it);
  }
  return [...days.values()].sort((a, b) => b.ts - a.ts).map((d) => ({
    day: d.day, ts: d.ts,
    groups: [...d.stores.values()].sort((a, b) => b.ts - a.ts).map((g) => ({ ...g, items: g.items.sort((a, b) => String(a.name).localeCompare(String(b.name), 'hu')) })),
  }));
}

/**
 * Gyakran vett tételek, amelyek most nincsenek a listán (gyors újrafelvételhez).
 * -> a legutóbbi verzió tételenként, gyakoriság szerint csökkenő sorrendben.
 */
export function frequent(items, limit = 8) {
  const key = (it) => String(it.name).trim().toLocaleLowerCase('hu');
  const onList = new Set(items.filter((i) => !i.deleted && !(i.bought_at > 0)).map(key));
  const stat = new Map();
  for (const it of items) {
    if (it.deleted || !(it.bought_at > 0)) continue;
    const k = key(it);
    if (onList.has(k)) continue;
    const s = stat.get(k) || { n: 0, last: null };
    s.n++;
    if (!s.last || it.bought_at > s.last.bought_at) s.last = it;
    stat.set(k, s);
  }
  return [...stat.values()].sort((a, b) => b.n - a.n || b.last.bought_at - a.last.bought_at).slice(0, limit).map((s) => s.last);
}

// ---------- Duplikátumok és terméklista ----------

/** Két tétel „ugyanaz”, ha a neve (kis-nagybetű/ékezet nélkül), a címzettje és a boltjai is egyeznek. */
const dupKey = (it) => [normText(it.name), it.for || '', [...(it.stores || [])].sort().join(',')].join('|');

/** Van-e már ugyanilyen nyitott (nem megvett, nem törölt) tétel a listán? -> a meglévő tétel vagy null */
export function findDuplicate(items, cand) {
  const k = dupKey(cand);
  return items.find((i) => i.id !== cand.id && !i.deleted && !(i.bought_at > 0) && dupKey(i) === k) || null;
}

/** Két mennyiség összeadása, ha ugyanaz az egység és mindkettő szám; különben null. */
export function addQty(a, b) {
  const na = Number(a.qty), nb = Number(b.qty);
  if ((a.unit || '') !== (b.unit || '') || !String(a.qty).trim() || !String(b.qty).trim() || !Number.isFinite(na) || !Number.isFinite(nb)) return null;
  return numStr(na + nb);
}

/** Termék keresése név vagy keresőszó (pl. „krumpli” → Burgonya) alapján. */
export function findProduct(products, name) {
  const n = normText(name);
  if (!n) return null;
  const live = products.filter((p) => !p.deleted);
  return live.find((p) => normText(p.name) === n)
    || live.find((p) => String(p.keywords || '').split(',').some((k) => normText(k) === n)) || null;
}

// ---------- Sablonok ----------

/**
 * Sablon alkalmazásának terve: a sablon tételei sorrendben, jelölve, ha már a listán vannak
 * (nyitott, ki nem pipált, azonos nevű tétel) – ezeket alapból nem vesszük fel újra.
 * -> [{item, onList}]
 */
export function templatePlan(templateItems, items) {
  const open = new Set(items.filter((i) => !i.deleted && !(i.bought_at > 0) && !i.checked).map((i) => normText(i.name)));
  return templateItems.filter((t) => !t.deleted)
    .sort((a, b) => (a.sort - b.sort) || String(a.name).localeCompare(String(b.name), 'hu'))
    .map((t) => ({ item: t, onList: open.has(normText(t.name)) }));
}

/**
 * Sablontételek készítése meglévő tételekből (lista vagy napló). Azonos nevűekből csak a legutóbbi marad.
 * newId: azonosító-generátor (a tisztaság kedvéért kívülről jön).
 */
export function templateItemsFrom(items, templateId, newId) {
  const latest = new Map();
  for (const it of items) {
    if (it.deleted) continue;
    const k = normText(it.name);
    const prev = latest.get(k);
    if (!prev || (it.updated_at || 0) > (prev.updated_at || 0)) latest.set(k, it);
  }
  return [...latest.values()].sort((a, b) => String(a.name).localeCompare(String(b.name), 'hu')).map((it, i) => ({
    id: newId(), template: templateId, name: it.name, qty: it.qty || '', unit: it.unit || '', category: it.category || '',
    stores: [...(it.stores || [])], for: it.for || '', sort: (i + 1) * 10, deleted: false,
  }));
}

/** Csak #rrggbb fogadható el színként (CSS-be kerülő érték!). */
export function safeColor(c, fallback = '') {
  return /^#[0-9a-fA-F]{6}$/.test(String(c || '')) ? c : fallback;
}

// ---------- Keresés és kategória-tipp a beviteli mezőhöz ----------

/** Tételek szűrése a beírt szövegre: a tétel nevében vagy a hozzá tartozó termék keresőszavaiban szerepel (ékezet- és kisbetű-függetlenül). */
export function filterItems(items, products, query) {
  const q = normText(query);
  if (!q) return items;
  const kw = new Map(products.filter((p) => !p.deleted).map((p) => [normText(p.name), normText(p.keywords)]));
  return items.filter((it) => { const n = normText(it.name); return n.includes(q) || (kw.get(n) || '').includes(q); });
}

/**
 * Kategória-tipp egy új névhez: azokat a termékeket nézi, amelyekkel van közös szava (a ragozást is tűri: „sajtok” ~ „sajt”),
 * és a leggyakoribb kategóriájukat adja. Az „egyeb” nem számít tippnek. -> kategória-id, vagy '' ha nincs tipp.
 */
export function guessCategory(products, name) {
  const words = normText(name).split(' ').filter((w) => w.length >= 3);
  if (!words.length) return '';
  // azonos szó, ragozott alak (előtag) vagy összetett szó vége („kecskesajt” ~ „sajt”)
  const same = (a, b) => a === b || (a.length >= 4 && b.length >= 4 && (a.startsWith(b) || b.startsWith(a) || a.endsWith(b) || b.endsWith(a)));
  const votes = new Map();
  for (const p of products) {
    if (p.deleted || !p.category || p.category === 'egyeb') continue;
    const pw = normText(`${p.name} ${String(p.keywords || '').replace(/,/g, ' ')}`).split(' ').filter((w) => w.length >= 3);
    if (pw.some((w) => words.some((x) => same(x, w)))) votes.set(p.category, (votes.get(p.category) || 0) + 1);
  }
  let best = '', n = 0;
  for (const [c, v] of votes) if (v > n) { best = c; n = v; }
  return best;
}

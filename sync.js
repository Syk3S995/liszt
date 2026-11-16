// Szinkron-vezérlő (a Raktár app elve szerint):
//  - kötegelés: a gyorsan egymás után tett módosítások rövid várakozás után EGY kérésben mennek fel;
//  - adatverzió: ha nincs mit feltölteni, a kérés csak a verziót küldi – változatlan szerveradatnál a szerver
//    semmit nem olvas be és nem küld le („változatlan”), így a háttérellenőrzés olcsó és gyors;
//  - ritkább háttér-ellenőrzés (3 perc), hiba után egyre ritkább újrapróbálás (15 mp … 3 perc);
//  - a háttér-ellenőrzés nem villogtatja a jelzőt és nem rajzolja újra a felületet, ha nincs változás.
import * as store from './store.js';
import * as backend from './backend.js';

const OVERLAP_MS = 5000;           // a kézi Sheet-szerkesztés és a zárak miatti időcsúszás ellen (a merge idempotens)
const BATCH_DELAY = 800;           // ennyi csend után megy fel a köteg
const SYNC_BATCH = 200;            // egy kérésben legfeljebb ennyi változás (a szerver 500 fölött elutasítja)
const POLL_MS = 3 * 60 * 1000;     // háttér-ellenőrzés látható oldalnál
const MIN_GAP_MS = 20 * 1000;      // visszatéréskor (fókusz) ennél gyakrabban nem ellenőriz
const RETRY_MIN = 15000, RETRY_MAX = 180000;

let running = false;
let again = false;
let batchTimer = null, retryTimer = null, retryDelay = RETRY_MIN;
let lastRun = 0;
let status = { kind: 'local', text: 'Helyi mód' };
const listeners = new Set();

export const onStatus = (fn) => { listeners.add(fn); fn(status); return () => listeners.delete(fn); };
function setStatus(kind, text) {
  if (status.kind === kind && status.text === text) return;   // változatlan állapot: ne rajzoljon újra
  status = { kind, text };
  listeners.forEach((f) => f(status));
}
export const getStatus = () => status;

export const getAuth = () => store.getMeta('auth', null);
export async function setAuth(a) { await store.setMeta('auth', a); }

/** Helyi módosítás után: rövid várakozás, és ami addig összegyűlt, egy kérésben megy fel. */
function syncSoon(delay = BATCH_DELAY) {
  if (!backend.enabled()) return;
  clearTimeout(batchTimer);
  batchTimer = setTimeout(() => runSync(), delay);
}

function scheduleRetry() {
  clearTimeout(retryTimer);
  retryTimer = setTimeout(() => runSync(), retryDelay);
  retryDelay = Math.min(retryDelay * 2, RETRY_MAX);
}

// ---- Szinkron napló (a Fiók oldalon látszik): utolsó sikeres szinkron, utolsó hiba, az utolsó LOG_MAX futás ----
const LOG_MAX = 20;
/** -> {running, lastOk, lastError:{at,text}|null, log:[{at, ms, kind, full, sent, recv, err}]} */
export function getSyncInfo() {
  return { running, lastOk: store.getMeta('lastSyncOk', 0), lastError: store.getMeta('lastSyncError', null), log: store.getMeta('syncLog', []) };
}
async function logRun(entry) {
  const log = [entry, ...store.getMeta('syncLog', [])].slice(0, LOG_MAX);
  await store.setMeta('syncLog', log);
  if (entry.kind === 'ok' || entry.kind === 'same') await store.setMeta('lastSyncOk', entry.at);
  else await store.setMeta('lastSyncError', { at: entry.at, text: entry.err || entry.kind });
}
const ERR_TEXT = { auth: 'Lejárt bejelentkezés', busy: 'A szerver foglalt, újrapróbálja', too_many_changes: 'Túl sok változás egyszerre', server_error: 'Szerverhiba', bad_request: 'Hibás kérés' };

/**
 * full: teljes újratöltés (since=0, verzió nélkül). Kézi indításnál (Szinkron most) a jelző is pörög;
 * háttér-ellenőrzésnél (nincs feltöltendő) csendben fut.
 */
export async function runSync({ full = false, manual = false } = {}) {
  if (!backend.enabled()) return;
  clearTimeout(batchTimer);
  if (running) { again = true; return; }
  const auth = getAuth();
  if (!auth || auth.exp <= Date.now()) { setStatus('auth', 'Jelentkezz be a szinkronhoz'); return; }
  if (!navigator.onLine) { setStatus('offline', pendingText('Offline')); return; }
  clearTimeout(retryTimer);
  running = true;
  lastRun = Date.now();
  const queue = store.getQueue();
  const sent = queue.slice(0, SYNC_BATCH);
  if (queue.length > sent.length) again = true;            // a többi a következő körben
  const quiet = !sent.length && !full && !manual;
  if (!quiet) setStatus('syncing', 'Szinkron…');
  const t0 = Date.now();
  const base = { at: t0, full, sent: sent.length, recv: 0 };
  try {
    const since = full ? 0 : store.getMeta('since', 0);
    // Verziót csak akkor küldünk, ha nincs feltöltendő: ilyenkor változatlan szerveradatnál nem jön le semmi.
    const version = full || sent.length ? '' : store.getMeta('dataVersion', '');
    const res = await backend.sync(auth.token, since, sent.map((q) => ({ t: q.t, r: store.toWire(q.t, q.r) })), version);
    if (!res.ok) {
      const err = ERR_TEXT[res.error] || res.error;
      await logRun({ ...base, ms: Date.now() - t0, kind: res.error === 'auth' ? 'auth' : 'error', err });
      if (res.error === 'auth') { await store.delMeta('auth'); setStatus('auth', 'Jelentkezz be a szinkronhoz'); }
      else { setStatus('error', 'Hiba: ' + err); scheduleRetry(); }
      return;
    }
    retryDelay = RETRY_MIN;
    if (res.token && res.exp) await setAuth({ ...auth, token: res.token, exp: res.exp }); // csúszó lejárat
    if (res.unchanged) {
      await logRun({ ...base, ms: Date.now() - t0, kind: 'same' });
    } else {
      await store.clearQueue(sent);
      const data = res.data || {};
      await store.applyIncoming(data);
      await store.setMeta('since', Math.max(0, Number(res.serverTime) - OVERLAP_MS));
      await store.setMeta('dataVersion', String(res.version || ''));
      const recv = Object.values(data).reduce((s, l) => s + (Array.isArray(l) ? l.length : 0), 0);
      await logRun({ ...base, ms: Date.now() - t0, kind: 'ok', recv });
    }
    setStatus('ok', store.pendingCount() ? pendingText('') : 'Mentve');
  } catch (e) {
    console.warn('sync hiba', e);
    await logRun({ ...base, ms: Date.now() - t0, kind: navigator.onLine ? 'error' : 'offline', err: navigator.onLine ? 'Hálózati hiba' : 'Nincs kapcsolat' });
    setStatus(navigator.onLine ? 'error' : 'offline', pendingText(navigator.onLine ? 'Hiba' : 'Offline'));
    if (navigator.onLine) scheduleRetry();
  } finally {
    running = false;
    if (again) { again = false; if (store.pendingCount() && status.kind === 'ok') syncSoon(200); }
  }
}

function pendingText(prefix) {
  const n = store.pendingCount();
  const p = n ? `${n} változás vár` : '';
  return [prefix, p].filter(Boolean).join(' · ') || 'Mentve';
}

/** Helyi módosítás után hívandó. */
export function localChanged() {
  if (!backend.enabled()) return;
  setStatus(navigator.onLine ? 'pending' : 'offline', pendingText(navigator.onLine ? '' : 'Offline'));
  syncSoon();
}

export function startTriggers() {
  if (!backend.enabled()) return;
  runSync();
  addEventListener('online', () => runSync());
  addEventListener('offline', () => setStatus('offline', pendingText('Offline')));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && Date.now() - lastRun > MIN_GAP_MS) runSync();
  });
  setInterval(() => { if (document.visibilityState === 'visible' && Date.now() - lastRun >= POLL_MS - 1000) runSync(); }, 30000);
}

export function initStatus() {
  if (!backend.enabled()) setStatus('local', 'Helyi mód');
}

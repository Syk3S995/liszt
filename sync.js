// Szinkron-vezérlő: push + pull egy kérésben, állapotjelzéssel.
import * as store from './store.js';
import * as backend from './backend.js';

const OVERLAP_MS = 5000; // a kézi Sheet-szerkesztés és a zárak miatti időcsúszás ellen (a merge idempotens)
let running = false;
let again = false;
let timer = null;
let status = { kind: 'local', text: 'Helyi mód' };
const listeners = new Set();

export const onStatus = (fn) => { listeners.add(fn); fn(status); return () => listeners.delete(fn); };
function setStatus(kind, text) { status = { kind, text }; listeners.forEach((f) => f(status)); }
export const getStatus = () => status;

export const getAuth = () => store.getMeta('auth', null);
export const authValid = () => { const a = getAuth(); return !!a && a.exp > Date.now(); };

export async function setAuth(a) { await store.setMeta('auth', a); }

export function scheduleSync(delay = 1000) {
  if (!backend.enabled()) return;
  clearTimeout(timer);
  timer = setTimeout(() => runSync(), delay);
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
  if (entry.kind === 'ok') await store.setMeta('lastSyncOk', entry.at);
  else await store.setMeta('lastSyncError', { at: entry.at, text: entry.err || entry.kind });
}
const ERR_TEXT = { auth: 'Lejárt bejelentkezés', busy: 'A szerver foglalt, újrapróbálja', too_many_changes: 'Túl sok változás egyszerre', server_error: 'Szerverhiba', bad_request: 'Hibás kérés' };

export async function runSync({ full = false } = {}) {
  if (!backend.enabled()) return;
  if (running) { again = true; return; }
  const auth = getAuth();
  if (!auth || auth.exp <= Date.now()) { setStatus('auth', 'Jelentkezz be a szinkronhoz'); return; }
  if (!navigator.onLine) { setStatus('offline', pendingText('Offline')); return; }
  running = true;
  setStatus('syncing', 'Szinkron…');
  const t0 = Date.now();
  const sent = store.getQueue();
  const base = { at: t0, full, sent: sent.length, recv: 0 };
  try {
    const since = full ? 0 : store.getMeta('since', 0);
    const res = await backend.sync(auth.token, since, sent.map((q) => ({ t: q.t, r: store.toWire(q.t, q.r) })));
    if (!res.ok) {
      const err = ERR_TEXT[res.error] || res.error;
      await logRun({ ...base, ms: Date.now() - t0, kind: res.error === 'auth' ? 'auth' : 'error', err });
      if (res.error === 'auth') { await store.delMeta('auth'); setStatus('auth', 'Jelentkezz be a szinkronhoz'); }
      else setStatus('error', 'Hiba: ' + err);
      return;
    }
    if (res.token && res.exp) await setAuth({ ...auth, token: res.token, exp: res.exp }); // csúszó lejárat
    await store.clearQueue(sent);
    const data = res.data || {};
    await store.applyIncoming(data);
    await store.setMeta('since', Math.max(0, Number(res.serverTime) - OVERLAP_MS));
    const recv = Object.values(data).reduce((s, l) => s + (Array.isArray(l) ? l.length : 0), 0);
    await logRun({ ...base, ms: Date.now() - t0, kind: 'ok', recv });
    setStatus('ok', store.pendingCount() ? pendingText('') : 'Mentve');
  } catch (e) {
    console.warn('sync hiba', e);
    await logRun({ ...base, ms: Date.now() - t0, kind: navigator.onLine ? 'error' : 'offline', err: navigator.onLine ? 'Hálózati hiba' : 'Nincs kapcsolat' });
    setStatus(navigator.onLine ? 'error' : 'offline', pendingText(navigator.onLine ? 'Hiba' : 'Offline'));
  } finally {
    running = false;
    if (again) { again = false; scheduleSync(200); }
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
  scheduleSync();
}

export function startTriggers() {
  if (!backend.enabled()) return;
  runSync();
  addEventListener('online', () => runSync());
  addEventListener('offline', () => setStatus('offline', pendingText('Offline')));
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') runSync(); });
  setInterval(() => { if (document.visibilityState === 'visible') runSync(); }, 30000);
}

export function initStatus() {
  if (!backend.enabled()) setStatus('local', 'Helyi mód (demó)');
}

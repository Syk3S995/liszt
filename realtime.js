// Supabase Realtime (Phoenix-protokoll, WebSocket) – csak jelzésre: a public.meta sor (adatverzió) változásakor szól,
// hogy van új adat; a tényleges letöltést a sync.js végzi. Külső függőség nélkül. Ha a kapcsolat nem él, a sync.js
// ritkább háttér-lekérdezése tartalékként tovább működik.
import { CONFIG } from './config.js';

const TOPIC = 'realtime:liszt-meta';
let ws = null, hb = null, retry = null, delay = 2000, stopped = true, joined = false, opts = null, n = 0;

export const supported = () => !!CONFIG.SUPABASE_URL && typeof WebSocket !== 'undefined';
export const connected = () => joined;

const send = (msg) => { try { if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg)); } catch { /* lezárul, újracsatlakozik */ } };
const nextRef = () => String(++n);

/** o: {getToken: () => jwt|null, onChange: () => void, onState?: (connected) => void} */
export function start(o) {
  if (!supported()) return;
  opts = o; stopped = false;
  if (!ws && !retry) open();
}

export function stop() {
  stopped = true; joined = false;
  clearTimeout(retry); retry = null; clearInterval(hb);
  const s = ws; ws = null;
  try { s && s.close(); } catch { /* már zárt */ }
}

/** Megújított hozzáférési token átadása a nyitott kapcsolatnak. */
export function setToken(token) {
  if (joined && token) send({ topic: TOPIC, event: 'access_token', payload: { access_token: token }, ref: nextRef() });
}

function open() {
  const token = opts.getToken();
  if (!token) return;
  const url = CONFIG.SUPABASE_URL.replace(/\/+$/, '').replace(/^http/, 'ws') + '/realtime/v1/websocket?apikey=' + encodeURIComponent(CONFIG.SUPABASE_KEY) + '&vsn=1.0.0';
  let s;
  try { s = new WebSocket(url); } catch { return schedule(); }
  ws = s;
  s.onopen = () => {
    const ref = nextRef();
    send({ topic: TOPIC, event: 'phx_join', ref, join_ref: ref, payload: {
      config: { broadcast: { ack: false, self: false }, presence: { key: '' }, private: false,
        postgres_changes: [{ event: '*', schema: 'public', table: 'meta' }] },
      access_token: token } });
    clearInterval(hb);
    hb = setInterval(() => send({ topic: 'phoenix', event: 'heartbeat', payload: {}, ref: nextRef() }), 25000);
  };
  s.onmessage = (e) => {
    let m; try { m = JSON.parse(e.data); } catch { return; }
    if (m.topic === TOPIC && m.event === 'phx_reply') {
      if (m.payload && m.payload.status === 'ok') { if (!joined) { joined = true; delay = 2000; opts.onState && opts.onState(true); } }
      else { try { s.close(); } catch { /* */ } }   // pl. lejárt token: zárás -> újracsatlakozás friss tokennel
    } else if (m.event === 'postgres_changes') opts.onChange();
    else if (m.event === 'phx_error' || m.event === 'phx_close') { try { s.close(); } catch { /* */ } }
  };
  s.onclose = () => {
    if (s !== ws) return;
    clearInterval(hb); ws = null;
    const was = joined; joined = false;
    if (was && opts.onState) opts.onState(false);
    if (!stopped) schedule();
  };
  s.onerror = () => { /* az onclose kezeli */ };
}

function schedule() {
  clearTimeout(retry);
  retry = setTimeout(() => { retry = null; if (!stopped && !ws) open(); }, delay);
  delay = Math.min(delay * 2, 60000);
}

/** Visszatéréskor / online eseménykor: ha lezárt a kapcsolat, azonnal újra próbál. */
export function nudge() {
  if (stopped || ws) return;
  clearTimeout(retry); retry = null; delay = 2000; open();
}

// Az egyetlen modul, ami a szerverrel beszél. Két átvitel:
//  - Supabase (éles): CONFIG.SUPABASE_URL + SUPABASE_KEY – Google ID-token -> Supabase Auth, adat a sync()/me() RPC-n át;
//  - mock (helyi teszt): CONFIG.API_URL – a mock/server.ps1 ugyanazt a szerződést adja.
// A hívók (sync.js, app.js) a két átvitelnél ugyanazt az alakot kapják.
import { CONFIG } from './config.js';

const SB = () => String(CONFIG.SUPABASE_URL || '').replace(/\/+$/, '');
const useSb = () => !!CONFIG.SUPABASE_URL;

export const enabled = () => !!(CONFIG.SUPABASE_URL || CONFIG.API_URL);

// ---- mock ----
async function post(payload) {
  const res = await fetch(CONFIG.API_URL, { method: 'POST', body: JSON.stringify(payload), credentials: 'omit', cache: 'no-store' });
  if (!res.ok) throw new Error('http_' + res.status);
  return res.json();
}

// ---- Supabase ----
async function sbFetch(path, body, jwt) {
  const headers = { apikey: CONFIG.SUPABASE_KEY, 'Content-Type': 'application/json' };
  if (jwt) headers.Authorization = 'Bearer ' + jwt;
  return fetch(SB() + path, { method: 'POST', headers, body: JSON.stringify(body), credentials: 'omit', cache: 'no-store' });
}
const sessionOf = (s) => ({ token: s.access_token, refresh: s.refresh_token, exp: (Number(s.expires_at) || (Date.now() / 1000 + Number(s.expires_in || 3600))) * 1000 });

/** -> {ok, token, refresh?, exp, email, personId, name} | {ok:false, error} */
export async function login(idToken) {
  if (!useSb()) return post({ action: 'login', idToken });
  const res = await sbFetch('/auth/v1/token?grant_type=id_token', { provider: 'google', id_token: idToken });
  if (!res.ok) return { ok: false, error: res.status >= 500 ? 'server_error' : 'invalid_token' };
  const s = sessionOf(await res.json());
  const who = await sbFetch('/rest/v1/rpc/me', {}, s.token);
  if (!who.ok) throw new Error('http_' + who.status);
  const me = await who.json();
  return me && me.ok ? { ok: true, ...s, email: me.email, personId: me.personId, name: me.name } : { ok: false, error: (me && me.error) || 'not_allowed' };
}

/** Lejáró token megújítása. -> {ok, token, refresh, exp} | {ok:false, fatal} (fatal: a refresh token már nem jó) */
export async function refresh(refreshToken) {
  const res = await sbFetch('/auth/v1/token?grant_type=refresh_token', { refresh_token: refreshToken });
  if (res.ok) return { ok: true, ...sessionOf(await res.json()) };
  return { ok: false, fatal: res.status >= 400 && res.status < 500 };
}

/**
 * -> {ok, serverTime, version, data:{Items,…}} | {ok, unchanged:true, version} | {ok:false, error:'auth'|'not_allowed'|…}
 * version: a készülék utolsó adatverziója – ha a szerveren azóta nem változott semmi, nem jön le adat.
 * counts: a helyi sorszámok táblánként (csak ha nincs feltöltendő): azonos verziónál eltérés esetén a szerver teljes állapotot ad ({full:true}).
 */
export async function sync(token, since, changes, version = '', counts = null) {
  if (!useSb()) return post({ action: 'sync', token, since, changes, version, counts });
  const res = await sbFetch('/rest/v1/rpc/sync', { p_since: since, p_changes: changes, p_version: version, p_counts: counts }, token);
  if (res.status === 401) return { ok: false, error: 'auth' };
  if (!res.ok) throw new Error('http_' + res.status);
  return res.json();
}

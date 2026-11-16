// Az egyetlen modul, ami a szerverrel beszél. Backend-csere esetén csak ezt kell lecserélni.
import { CONFIG } from './config.js';

async function post(payload) {
  // Content-Type nélkül küldjük: text/plain -> nincs CORS preflight (GAS-hoz kell).
  const res = await fetch(CONFIG.API_URL, {
    method: 'POST',
    body: JSON.stringify(payload),
    redirect: 'follow',
    credentials: 'omit',
    cache: 'no-store',
  });
  if (!res.ok) throw new Error('http_' + res.status);
  return res.json();
}

export const enabled = () => !!CONFIG.API_URL;

/** -> {ok, token, exp, email, personId, name} | {ok:false, error} */
export const login = (idToken) => post({ action: 'login', idToken });

/** -> {ok, serverTime, data:{Items,Stores,People,Views}} | {ok:false, error:'auth'} */
export const sync = (token, since, changes) => post({ action: 'sync', token, since, changes });

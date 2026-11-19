// Nem titkos beállítások. Üres API_URL = csak helyi mód (szinkron nélkül, üres adatokkal).
export const CONFIG = {
  API_URL: '',            // csak a helyi mock szerverhez ('/api'); élesben üres
  GOOGLE_CLIENT_ID: '769271415006-favqj0jc53u8jsng48c46freo4t8o5ut.apps.googleusercontent.com',   // OAuth Client ID (Web application)
  SUPABASE_URL: 'https://diemfzlbiycqguvmakis.supabase.co',   // a projekt URL-je (publikus)
  SUPABASE_KEY: 'sb_publishable_RJFMTsSGu9Jf8WzpkslsOQ_6jAQGqB2',   // publikus kulcs: a védelmet a jogosultsági szabályok adják, nem a titkossága
  MOCK_AUTH: false,       // true: a mock szerver "bejelentkezés" gombja Google helyett (csak fejlesztéshez!)
};

// Nem titkos beállítások. Üres API_URL = csak helyi mód (szinkron nélkül, üres adatokkal).
export const CONFIG = {
  API_URL: 'https://script.google.com/macros/s/AKfycbxt6AxIoOtuG8orf96OHSfKdtn-lMxMIEYJg9oFKNs27IQBDCPvxaGdg8RWk-JvUCs5/exec',            // pl. 'https://script.google.com/macros/s/.../exec' vagy '/api' (mock)
  GOOGLE_CLIENT_ID: '769271415006-favqj0jc53u8jsng48c46freo4t8o5ut.apps.googleusercontent.com',   // OAuth Client ID (Web application)
  MOCK_AUTH: false,       // true: a mock szerver "bejelentkezés" gombja Google helyett (csak fejlesztéshez!)
};

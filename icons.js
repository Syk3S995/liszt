// Egyszerű vonalas ikonok (inline SVG, DOM-mal építve – nincs innerHTML).
const NS = 'http://www.w3.org/2000/svg';
const P = {
  cart: 'M3 4h2.5l2.2 10.5a1 1 0 0 0 1 .8h8.6a1 1 0 0 0 1-.8L20 7H6.3M10 19.5a.9.9 0 1 0 1.8 0 .9.9 0 1 0-1.8 0M16 19.5a.9.9 0 1 0 1.8 0 .9.9 0 1 0-1.8 0',
  list: 'M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01',
  store: 'M4 9l1.5-5h13L20 9M4 9v11h16V9M4 9a2.7 2.7 0 0 0 5.3 0 2.7 2.7 0 0 0 5.4 0A2.7 2.7 0 0 0 20 9M10 20v-5h4v5',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 20c1.3-3.6 4.2-5 8-5s6.7 1.4 8 5',
  tag: 'M4 4h7l9 9-7 7-9-9zM8 8h.01',
  sliders: 'M4 7h9M17 7h3M4 17h3M11 17h9M15 5v4M9 15v4',
  cloudOk: 'M7 18a4.5 4.5 0 0 1-.5-9A6 6 0 0 1 18 9.5a4 4 0 0 1-.2 8.5zM9.5 13l2 2 3.5-3.5',
  cloudUp: 'M7 18a4.5 4.5 0 0 1-.5-9A6 6 0 0 1 18 9.5a4 4 0 0 1-.2 8.5zM12 16v-5m-2 2 2-2 2 2',
  cloudOff: 'M7 18a4.5 4.5 0 0 1-.5-9A6 6 0 0 1 18 9.5a4 4 0 0 1-.2 8.5zM4 4l16 16',
  sync: 'M20 12a8 8 0 0 1-14 5.3M4 12a8 8 0 0 1 14-5.3M18 3v4h-4M6 21v-4h4',
  err: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7.5v5.5M12 16.5v.01',
  plus: 'M12 5v14M5 12h14',
  x: 'M6 6l12 12M18 6 6 18',
  edit: 'M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4',
  trash: 'M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13',
  up: 'm6 15 6-6 6 6',
  down: 'm6 9 6 6 6-6',
  flag: 'M6 21V4M6 5h11l-2 4 2 4H6',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  search: 'M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13zM15.5 15.5 20 20',
  eye: 'M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12zM12 14.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
  // ---- kategória-piktogramok ----
  apple: 'M12 7.5c-1.6-1.3-4.2-1.4-5.6.1C4.5 9.6 5 13.8 7 16.8c1.2 1.8 2.6 3 4 2.5.6-.2.8-.3 1-.3s.4.1 1 .3c1.4.5 2.8-.7 4-2.5 2-3 2.5-7.2.6-9.2-1.4-1.5-4-1.4-5.6-.1zM12 7.5c0-2 .8-3.5 2.8-4.3',
  leaf: 'M5 19c0-8 5-14 15-14 0 10-6 15-14 15M5 19l7-7',
  bread: 'M6.5 11a3.5 3.5 0 0 1-.5-7h12a3.5 3.5 0 0 1-.5 7V19a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1zM10 8.5v3M14 8.5v3',
  milk: 'M8.5 3h7M9.5 3v3L7.5 9.5V20a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1V9.5l-2-3.5V3M7.5 13.5h9',
  cheese: 'M3 18v-6.5L14 5l7 6.5V18zM3 11.5h18M8 15h.01M14.5 15.5h.01',
  egg: 'M12 3c-3.4 0-6 5-6 9.5a6 6 0 0 0 12 0C18 8 15.4 3 12 3z',
  meat: 'M14.5 14.5 10 19a2 2 0 1 1-2.8-.2 2 2 0 1 1-.2-2.8l4.5-4.5M14.5 14.5a5 5 0 1 0-3-3',
  fish: 'M5 12c3-4 7-5 10.5-4 2.5.7 4.5 2.3 5.5 4-1 1.7-3 3.3-5.5 4-3.5 1-7.5 0-10.5-4zM5 12 2 8.5M5 12l-3 3.5M16.5 11.5h.01',
  snow: 'M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9M9.5 4.5 12 7l2.5-2.5M9.5 19.5 12 17l2.5 2.5',
  jar: 'M8 3h8v3H8zM7 6h10a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1zM6 11h12',
  can: 'M6 6c0-1.1 2.7-2 6-2s6 .9 6 2v12c0 1.1-2.7 2-6 2s-6-.9-6-2zM6 6c0 1.1 2.7 2 6 2s6-.9 6-2M6 12c0 1.1 2.7 2 6 2s6-.9 6-2',
  cookie: 'M12 3a9 9 0 1 0 9 9 3 3 0 0 1-3-3 3 3 0 0 1-3-3 3 3 0 0 1-3-3zM9 10h.01M8 15h.01M13 16h.01',
  bottle: 'M10 2.5h4M10.5 2.5v3.5L8.5 9.5a2 2 0 0 0-.5 1.3V20.5a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V10.8a2 2 0 0 0-.5-1.3L13.5 6V2.5M8 14h8',
  coffee: 'M5 9h11v6a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4zM16 10.5h1.5a2.2 2.2 0 0 1 0 4.5H16M8.5 3.5v3M12 3.5v3',
  wine: 'M8 3h8l-.5 5a3.5 3.5 0 0 1-7 0zM12 11.5V20M8.5 20h7',
  home: 'M4 11l8-7 8 7M6 9.5V20h12V9.5M10 20v-5h4v5',
  soap: 'M9 10h6a2 2 0 0 1 2 2v8a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1v-8a2 2 0 0 1 2-2zM10 10V7h4v3M12 7V4h3.5',
  pill: 'M4.5 12.5l8-8a4.9 4.9 0 0 1 7 7l-8 8a4.9 4.9 0 0 1-7-7zM8.5 8.5l7 7',
  paw: 'M12 13c-3 0-5 3-5 5 0 1.5 1.5 2 2.5 2s1.5-.5 2.5-.5 1.5.5 2.5.5 2.5-.5 2.5-2c0-2-2-5-5-5zM5 11a1.5 1.8 0 1 0 3 0 1.5 1.8 0 1 0-3 0M16 11a1.5 1.8 0 1 0 3 0 1.5 1.8 0 1 0-3 0M8.5 6.5a1.5 1.8 0 1 0 3 0 1.5 1.8 0 1 0-3 0M12.5 6.5a1.5 1.8 0 1 0 3 0 1.5 1.8 0 1 0-3 0',
  baby: 'M9 8h6M10 8V5.5a2 2 0 0 1 4 0V8M8 8h8v11a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2zM8 12.5h3M8 16h3',
  box: 'M4 8l8-4 8 4v8l-8 4-8-4zM4 8l8 4 8-4M12 12v8',
  cabin: 'M3 12 12 4l9 8M5 10.5V20h14v-9.5M9.5 20v-4.5h5V20M16.5 5v3',
  heart: 'M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z',
  book: 'M5 4.5A1.5 1.5 0 0 1 6.5 3H19v15H6.5A1.5 1.5 0 0 0 5 19.5zM5 19.5A1.5 1.5 0 0 0 6.5 21H19v-3M9 7.5h6',
  minus: 'M5 12h14',
  template: 'M6 3h9l4 4v14H6zM15 3v4h4M9 11h7M9 15h7M9 19h4',
  back: 'M15 5l-7 7 7 7',
  save: 'M5 4h11l3 3v13H5zM8 4v5h7V4M8 20v-6h8v6',
  undo: 'M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11',
};

/** A kategória-szerkesztőben választható piktogramok (sorrendben). */
export const CAT_ICONS = ['apple', 'leaf', 'bread', 'milk', 'cheese', 'egg', 'meat', 'fish', 'snow', 'jar', 'can', 'cookie',
  'bottle', 'coffee', 'wine', 'home', 'soap', 'pill', 'baby', 'paw', 'box', 'tag'];

/** Címzett-ikonok (személy, hely, háziállat…). */
export const PERSON_ICONS = ['user', 'home', 'cabin', 'baby', 'paw', 'heart', 'tag'];
export const personIconName = (p) => (p && PERSON_ICONS.includes(p.icon) ? p.icon : 'user');

/** Sablon-ikonok. */
export const TEMPLATE_ICONS = ['template', 'cart', 'home', 'cabin', 'heart', 'apple', 'bread', 'coffee', 'wine', 'soap', 'baby', 'paw', 'box', 'tag'];
export const templateIconName = (t) => (t && TEMPLATE_ICONS.includes(t.icon) ? t.icon : 'template');

/** Ikon a kategóriához: a saját `icon` mező, különben az ismert id-k alapértelmezése. */
const DEFAULT_CAT_ICON = { 'zoldseg-gyumolcs': 'apple', pekaru: 'bread', tejtermek: 'milk', hus: 'meat', fagyasztott: 'snow',
  szarazaru: 'jar', ital: 'bottle', haztartas: 'home', drogeria: 'soap', egyeb: 'box' };
export function catIconName(cat) {
  if (cat && CAT_ICONS.includes(cat.icon)) return cat.icon;
  return (cat && DEFAULT_CAT_ICON[cat.id]) || 'box';
}

export function icon(name, size = 20) {
  const s = document.createElementNS(NS, 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('width', size);
  s.setAttribute('height', size);
  s.setAttribute('fill', 'none');
  s.setAttribute('stroke', 'currentColor');
  s.setAttribute('stroke-width', name === 'more' ? '2.6' : '1.8');
  s.setAttribute('stroke-linecap', 'round');
  s.setAttribute('stroke-linejoin', 'round');
  s.setAttribute('aria-hidden', 'true');
  s.setAttribute('class', 'ico ico-' + name);
  const p = document.createElementNS(NS, 'path');
  p.setAttribute('d', P[name] || '');
  s.append(p);
  return s;
}

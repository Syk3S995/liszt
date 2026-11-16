// Alap terméklista: egy friss telepítés is ebből indul (kategória, szokásos egység, keresőszavak).
// Első indításkor egyszer bekerül a Products táblába (determinisztikus id-vel, így több eszközről sem duplázódik),
// utána a Kezelés → Termékek fülön szabadon szerkeszthető.
// Formátum: [név, kategória-id, egység, keresőszavak]
export const DEFAULT_PRODUCTS = [
  // Zöldség-gyümölcs
  ['Alma', 'zoldseg-gyumolcs', 'kg', ''], ['Banán', 'zoldseg-gyumolcs', 'kg', ''], ['Narancs', 'zoldseg-gyumolcs', 'kg', ''],
  ['Citrom', 'zoldseg-gyumolcs', 'db', ''], ['Mandarin', 'zoldseg-gyumolcs', 'kg', ''], ['Szőlő', 'zoldseg-gyumolcs', 'kg', ''],
  ['Körte', 'zoldseg-gyumolcs', 'kg', ''], ['Eper', 'zoldseg-gyumolcs', 'doboz', ''], ['Kivi', 'zoldseg-gyumolcs', 'db', ''],
  ['Burgonya', 'zoldseg-gyumolcs', 'kg', 'krumpli'], ['Vöröshagyma', 'zoldseg-gyumolcs', 'kg', 'hagyma'], ['Fokhagyma', 'zoldseg-gyumolcs', 'db', ''],
  ['Paradicsom', 'zoldseg-gyumolcs', 'kg', ''], ['Paprika', 'zoldseg-gyumolcs', 'db', ''], ['Uborka', 'zoldseg-gyumolcs', 'db', ''],
  ['Sárgarépa', 'zoldseg-gyumolcs', 'kg', 'répa'], ['Petrezselyem', 'zoldseg-gyumolcs', 'csomag', ''], ['Saláta', 'zoldseg-gyumolcs', 'db', 'fejes saláta'],
  ['Káposzta', 'zoldseg-gyumolcs', 'db', ''], ['Cukkini', 'zoldseg-gyumolcs', 'db', ''], ['Gomba', 'zoldseg-gyumolcs', 'doboz', 'csiperke'],
  ['Brokkoli', 'zoldseg-gyumolcs', 'db', ''], ['Avokádó', 'zoldseg-gyumolcs', 'db', ''],
  // Pékáru
  ['Kenyér', 'pekaru', 'db', ''], ['Zsemle', 'pekaru', 'db', 'zsömle'], ['Kifli', 'pekaru', 'db', ''], ['Kalács', 'pekaru', 'db', ''],
  ['Toast kenyér', 'pekaru', 'csomag', 'toastkenyér, tost'], ['Kakaós csiga', 'pekaru', 'db', ''], ['Pogácsa', 'pekaru', 'db', ''],
  ['Tortilla', 'pekaru', 'csomag', ''],
  // Tejtermék
  ['Tej', 'tejtermek', 'l', ''], ['Vaj', 'tejtermek', 'db', ''], ['Margarin', 'tejtermek', 'db', 'rama'], ['Tejföl', 'tejtermek', 'db', ''],
  ['Joghurt', 'tejtermek', 'db', ''], ['Kefir', 'tejtermek', 'db', ''], ['Túró', 'tejtermek', 'db', ''], ['Trappista sajt', 'tejtermek', 'csomag', 'sajt, trappista'],
  ['Mozzarella', 'tejtermek', 'db', ''], ['Tejszín', 'tejtermek', 'db', 'főzőtejszín, habtejszín'], ['Tojás', 'tejtermek', 'db', ''],
  ['Túró Rudi', 'tejtermek', 'db', 'rudi'], ['Krémsajt', 'tejtermek', 'db', ''],
  // Hús
  ['Csirkemell', 'hus', 'kg', ''], ['Csirkecomb', 'hus', 'kg', ''], ['Darált hús', 'hus', 'kg', 'darálthús'], ['Sertéskaraj', 'hus', 'kg', 'karaj'],
  ['Sonka', 'hus', 'csomag', 'felvágott'], ['Szalámi', 'hus', 'csomag', ''], ['Kolbász', 'hus', 'db', ''], ['Virsli', 'hus', 'csomag', ''],
  ['Bacon', 'hus', 'csomag', 'szalonna'], ['Hal', 'hus', 'kg', 'halfilé'],
  // Fagyasztott
  ['Fagyasztott zöldség', 'fagyasztott', 'csomag', 'mirelit zöldség'], ['Mirelit borsó', 'fagyasztott', 'csomag', 'borsó'],
  ['Hasábburgonya', 'fagyasztott', 'csomag', 'sült krumpli, mirelit krumpli'], ['Jégkrém', 'fagyasztott', 'db', 'fagyi'],
  ['Pizza (fagyasztott)', 'fagyasztott', 'db', 'fagyasztott pizza'], ['Halrudacska', 'fagyasztott', 'csomag', ''],
  // Szárazáru
  ['Liszt', 'szarazaru', 'kg', ''], ['Cukor', 'szarazaru', 'kg', ''], ['Só', 'szarazaru', 'kg', ''], ['Rizs', 'szarazaru', 'kg', ''],
  ['Tészta', 'szarazaru', 'csomag', 'spagetti, makaróni'], ['Étolaj', 'szarazaru', 'l', 'olaj, napraforgó olaj'], ['Olívaolaj', 'szarazaru', 'üveg', ''],
  ['Ecet', 'szarazaru', 'üveg', ''], ['Kávé', 'szarazaru', 'csomag', ''], ['Tea', 'szarazaru', 'doboz', ''], ['Kakaó', 'szarazaru', 'doboz', ''],
  ['Müzli', 'szarazaru', 'csomag', 'zabpehely'], ['Méz', 'szarazaru', 'üveg', ''], ['Lekvár', 'szarazaru', 'üveg', ''],
  ['Paradicsomszósz', 'szarazaru', 'üveg', 'passata, ketchup'], ['Konzerv', 'szarazaru', 'doboz', ''], ['Bab', 'szarazaru', 'doboz', ''],
  ['Kukorica (konzerv)', 'szarazaru', 'doboz', 'kukorica'], ['Pirospaprika', 'szarazaru', 'csomag', 'fűszerpaprika'], ['Bors', 'szarazaru', 'csomag', ''],
  ['Csokoládé', 'szarazaru', 'db', 'csoki'], ['Keksz', 'szarazaru', 'csomag', ''], ['Chips', 'szarazaru', 'csomag', ''], ['Sütőpor', 'szarazaru', 'csomag', ''],
  ['Élesztő', 'szarazaru', 'csomag', ''], ['Majonéz', 'szarazaru', 'db', ''], ['Mustár', 'szarazaru', 'db', ''],
  // Ital
  ['Ásványvíz', 'ital', 'l', 'víz'], ['Szénsavas víz', 'ital', 'l', 'szóda'], ['Gyümölcslé', 'ital', 'l', 'üdítő, juice'],
  ['Üdítő', 'ital', 'l', 'kóla, cola'], ['Sör', 'ital', 'db', ''], ['Bor', 'ital', 'üveg', ''], ['Szörp', 'ital', 'üveg', ''],
  // Háztartás
  ['WC-papír', 'haztartas', 'csomag', 'wc papír, toalettpapír'], ['Papírtörlő', 'haztartas', 'csomag', 'kéztörlő'], ['Szalvéta', 'haztartas', 'csomag', ''],
  ['Mosogatószer', 'haztartas', 'db', ''], ['Mosogatógép tabletta', 'haztartas', 'doboz', 'mosogatótabletta'], ['Mosószer', 'haztartas', 'doboz', 'mosópor, mosógél'],
  ['Öblítő', 'haztartas', 'db', ''], ['Szemeteszsák', 'haztartas', 'csomag', 'szemetes zsák'], ['Alufólia', 'haztartas', 'db', ''],
  ['Folpack', 'haztartas', 'db', 'fólia'], ['Szivacs', 'haztartas', 'csomag', ''], ['Tisztítószer', 'haztartas', 'db', 'hypo, ablaktisztító'],
  ['Elem', 'haztartas', 'csomag', 'akkumulátor'], ['Gyújtós', 'haztartas', 'csomag', 'tűzifa-gyújtós'],
  // Drogéria
  ['Fogkrém', 'drogeria', 'db', ''], ['Fogkefe', 'drogeria', 'db', ''], ['Sampon', 'drogeria', 'db', ''], ['Tusfürdő', 'drogeria', 'db', ''],
  ['Szappan', 'drogeria', 'db', ''], ['Dezodor', 'drogeria', 'db', 'deo'], ['Kézkrém', 'drogeria', 'db', ''], ['Papírzsebkendő', 'drogeria', 'csomag', 'zsepi, zsebkendő'],
  ['Vatta', 'drogeria', 'csomag', 'vattakorong'], ['Pelenka', 'drogeria', 'csomag', ''], ['Borotva', 'drogeria', 'csomag', ''],
  ['Fájdalomcsillapító', 'drogeria', 'doboz', 'gyógyszer'], ['Vitamin', 'drogeria', 'doboz', ''],
  // Egyéb
  ['Kutyaeledel', 'egyeb', 'csomag', 'kutyakaja'], ['Macskaeledel', 'egyeb', 'csomag', 'macskakaja'], ['Virág', 'egyeb', 'db', ''],
];

// Téma: 'auto' (rendszerbeállítás), 'light' vagy 'dark'. Szinkron töltődik (nem modul), hogy ne villanjon fel a rossz téma.
(function () {
  // Keretbe ágyazás elleni védelem (clickjacking): idegen oldal keretében az app nem jelenik meg.
  // (A GitHub Pages nem tud ilyen fejlécet küldeni, a <meta> CSP pedig ezt nem tudja tiltani.)
  if (window.top !== window.self) {
    document.documentElement.style.display = 'none';
    try { window.top.location = window.self.location.href; } catch (e) { /* a keretező tiltja: az oldal rejtve marad */ }
    throw new Error('Az alkalmazás keretben nem futtatható.');
  }
  var KEY = 'bevasarlo_theme';
  function get() { try { return localStorage.getItem(KEY) || 'auto'; } catch (e) { return 'auto'; } }
  function apply(t) {
    if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
    else document.documentElement.removeAttribute('data-theme');
    // a böngésző/rendszersáv színe a választott témához
    var m = document.querySelector('meta[name=theme-color]');
    if (m) {
      if (!m.hasAttribute('data-def')) m.setAttribute('data-def', m.getAttribute('content'));
      m.setAttribute('content', t === 'dark' ? '#201911' : t === 'light' ? '#ffffff' : m.getAttribute('data-def'));
    }
  }
  window.BevTheme = {
    get: get,
    set: function (t) { try { if (t === 'auto') localStorage.removeItem(KEY); else localStorage.setItem(KEY, t); } catch (e) { /* nincs tárhely */ } apply(t); },
  };
  apply(get());
})();

'use strict';

/* ═══════════════════════════════════════════════
   MAIN – inizializzazione dell'applicazione
═══════════════════════════════════════════════ */

function adjustLayout() {
  const h = document.getElementById('appHeader').offsetHeight;
  document.documentElement.style.setProperty('--header-h', h + 'px');
  document.body.style.paddingTop = h + 'px';
}

adjustLayout();
window.addEventListener('resize', adjustLayout);
if (document.fonts) document.fonts.ready.then(adjustLayout);

renderFavorites();

'use strict';

/* ═══════════════════════════════════════════════
   NAVIGATION – routing tra pagine + ricerca stazione
═══════════════════════════════════════════════ */

/* ── Ricerca/autocomplete stazione (header) ── */

const searchInput = document.getElementById('searchInput');
const searchClear = document.getElementById('searchClear');
const acDropdown  = document.getElementById('acDropdown');
const acList      = document.getElementById('acList');
let   searchTimer = null;

searchInput.addEventListener('input', () => {
  const q = searchInput.value.trim();
  searchClear.classList.toggle('d-none', q.length === 0);
  clearTimeout(searchTimer);
  if (q.length < 2) { closeDropdown(); return; }
  searchTimer = setTimeout(() => doSearch(q), 380);
});

searchInput.addEventListener('focus', () => {
  if (searchInput.value.trim().length >= 2 && acList.children.length > 0)
    acDropdown.classList.add('show');
});

searchClear.addEventListener('click', () => {
  searchInput.value = '';
  searchClear.classList.add('d-none');
  closeDropdown();
  searchInput.focus();
});

document.addEventListener('click', e => {
  if (!e.target.closest('#searchWrap')) closeDropdown();
});

function closeDropdown() {
  acDropdown.classList.remove('show');
  acList.innerHTML = '';
}

async function doSearch(q) {
  acList.innerHTML = '<div class="d-flex justify-content-center align-items-center py-3"><div class="spinner-border spinner-border-sm text-primary" role="status"></div><span class="ms-2 text-secondary">Ricerca...</span></div>';
  acDropdown.classList.add('show');
  try {
    const list = await searchStations(q);
    if (!list.length) { closeDropdown(); return; }
    acList.innerHTML = list.slice(0, 9).map(renderAcItem).join('');
    acDropdown.classList.add('show');
    acList.querySelectorAll('.ac-item').forEach(el =>
      el.addEventListener('click', e => {
        e.preventDefault();
        selectStation(el.dataset.id, el.dataset.name);
      }));
  } catch {
    closeDropdown();
    showToast('Errore nella ricerca – riprova');
  }
}

function selectStation(id, name) {
  station = { id, name };
  searchInput.value = name;
  searchClear.classList.remove('d-none');
  closeDropdown();
  showPage('orari');
  chosenDate = null;
  loadOrari();
}

/* ── Page routing ── */

function showPage(page) {
  document.querySelectorAll('.app-page').forEach(p => p.classList.add('d-none'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  const searchWrap = document.getElementById('searchWrap');

  if (page === 'orari') {
    document.getElementById('pageOrari').classList.remove('d-none');
    document.getElementById('navOrari').classList.add('active');
    searchWrap.classList.remove('d-none');
  } else if (page === 'itinerario') {
    searchWrap.classList.add('d-none');
    closeDropdown();
    document.getElementById('pageItinerario').classList.remove('d-none');
    document.getElementById('navItinerario').classList.add('active');
    initItinerario();
    // Aggiorna data/ora se il chip "Adesso" è attivo (o nessun chip selezionato)
    const activeChip = document.querySelector('.route-time-btn.active');
    if (!activeChip || activeChip.dataset.hour === 'now') {
      const now = new Date();
      const p   = n => String(n).padStart(2, '0');
      document.getElementById('routeDate').value = toLocalIso(now).slice(0, 10);
      document.getElementById('routeTime').value = `${p(now.getHours())}:${p(now.getMinutes())}`;
    }
  } else if (page === 'impostazioni') {
    searchWrap.classList.add('d-none');
    closeDropdown();
    document.getElementById('pageImpostazioni').classList.remove('d-none');
    document.getElementById('navImpostazioni').classList.add('active');
    renderImpostazioni();
  } else {
    // preferiti
    searchWrap.classList.add('d-none');
    closeDropdown();
    document.getElementById('pagePreferiti').classList.remove('d-none');
    document.getElementById('navPreferiti').classList.add('active');
    renderFavorites();
  }
}

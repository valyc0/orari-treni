'use strict';

/* ═══════════════════════════════════════════════
   NAVIGATION – routing tra pagine + ricerca stazione
═══════════════════════════════════════════════ */

/* ── Ricerche recenti ── */

const MAX_RECENT = 6;

function saveRecentStation(st) {
  let r = JSON.parse(localStorage.getItem('treni_recent_stations') || '[]');
  r = [st, ...r.filter(s => s.id !== st.id)].slice(0, MAX_RECENT);
  localStorage.setItem('treni_recent_stations', JSON.stringify(r));
}
function getRecentStations() {
  return JSON.parse(localStorage.getItem('treni_recent_stations') || '[]');
}

function saveRecentRoute(from, to) {
  let r = JSON.parse(localStorage.getItem('treni_recent_routes') || '[]');
  r = [{ from, to }, ...r.filter(x => !(x.from.id === from.id && x.to.id === to.id))].slice(0, MAX_RECENT);
  localStorage.setItem('treni_recent_routes', JSON.stringify(r));
}
function getRecentRoutes() {
  return JSON.parse(localStorage.getItem('treni_recent_routes') || '[]');
}

function renderOrariEmpty() {
  const recents = getRecentStations();
  const content = document.getElementById('orariContent');
  if (!recents.length) {
    content.innerHTML = `
      <div class="d-flex flex-column align-items-center justify-content-center text-muted py-5 mt-3">
        <i class="bi bi-train-front-fill" style="font-size:5rem;opacity:.12"></i>
        <h5 class="mt-3 fw-semibold">Cerca una stazione</h5>
        <p class="small mb-0">Inserisci il nome per vedere partenze e arrivi</p>
      </div>`;
    return;
  }
  content.innerHTML = `
    <div class="px-3 pt-3">
      <p class="text-muted small mb-2 fw-semibold text-uppercase" style="letter-spacing:.04em">
        <i class="bi bi-clock-history me-1"></i>Recenti
      </p>
      <div class="list-group shadow-sm rounded-3">
        ${recents.map(s => `
          <button class="list-group-item list-group-item-action border-0 d-flex align-items-center gap-3 py-3"
                  onclick="selectStation('${esc(s.id)}','${esc(s.name).replace(/'/g,"\\'") }')">
            <i class="bi bi-geo-alt-fill text-primary fs-5 flex-shrink-0"></i>
            <span class="fw-semibold">${esc(s.name)}</span>
          </button>`).join('')}
      </div>
    </div>`;
}

function renderItinerarioRecenti() {
  const recents = getRecentRoutes();
  const resEl   = document.getElementById('routeResults');
  if (!recents.length || resEl.innerHTML.trim()) return;
  resEl.innerHTML = `
    <div class="px-3 pt-2 pb-3">
      <p class="text-muted small mb-2 fw-semibold text-uppercase" style="letter-spacing:.04em">
        <i class="bi bi-clock-history me-1"></i>Recenti
      </p>
      <div class="list-group shadow-sm rounded-3">
        ${recents.map((r, i) => `
          <button class="list-group-item list-group-item-action border-0 py-3"
                  onclick="selectRecentRoute(${i})">
            <div class="d-flex align-items-center gap-2">
              <i class="bi bi-circle-fill text-success flex-shrink-0" style="font-size:.45rem"></i>
              <span class="fw-semibold text-truncate">${esc(r.from.name)}</span>
            </div>
            <div class="d-flex align-items-center gap-2 mt-1">
              <i class="bi bi-geo-alt-fill text-danger flex-shrink-0" style="font-size:.8rem"></i>
              <span class="fw-semibold text-truncate">${esc(r.to.name)}</span>
            </div>
          </button>`).join('')}
      </div>
    </div>`;
}

function selectRecentRoute(i) {
  const r = getRecentRoutes()[i];
  if (!r) return;
  routeFrom = r.from;
  routeTo   = r.to;
  document.getElementById('routeFrom').value = r.from.name;
  document.getElementById('routeTo').value   = r.to.name;
  document.getElementById('clearFrom').classList.remove('d-none');
  document.getElementById('clearTo').classList.remove('d-none');
  // aggiorna icona salva
  const routeKey = `${r.from.id}→${r.to.id}`;
  const isSaved  = favorites.some(f => f.type === 'route' && f.routeKey === routeKey);
  const btnS = document.getElementById('btnSaveRoute');
  if (btnS) btnS.innerHTML = `<i class="bi bi-star${isSaved ? '-fill' : ''}"></i>`;
  // svuota risultati precedenti e cerca
  document.getElementById('routeResults').innerHTML = '';
  searchRoute();
}

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
  saveRecentStation({ id, name });
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
    if (!station) renderOrariEmpty();
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
    renderItinerarioRecenti();
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

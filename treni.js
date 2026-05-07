'use strict';

/* ═══════════════════════════════════════════════
   CONFIG
═══════════════════════════════════════════════ */
const VT_BASE   = 'https://www.viaggiatreno.it/infomobilita/resteasy/viaggiatreno';
const REFRESH_MS = 60_000;
const DAYS   = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

// CORS proxy pool – viene usato il primo che risponde correttamente
const PROXY_POOL = [
  u => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
  u => `https://corsproxy.io/?url=${encodeURIComponent(u)}`,
  u => `https://api.codetabs.com/v1/proxy/?quest=${encodeURIComponent(u)}`,
  u => `https://cors-proxy.fringe.zone/${u}`,
  u => `https://thingproxy.freeboard.io/fetch/${u}`,
];

let _proxyOk = null; // indice del proxy funzionante

/* ═══════════════════════════════════════════════
   STATE
═══════════════════════════════════════════════ */
let station     = null;
let activeTab   = 'partenze';
let chosenDate  = null;
let autoRefresh = false;
let refreshTimer = null;
let favorites   = JSON.parse(localStorage.getItem('treni_fav') || '[]');
let notifThresholds = JSON.parse(localStorage.getItem('notif_thresholds') || 'null') || [
  { min: 10, enabled: true },
  { min: 5,  enabled: true },
  { min: 2,  enabled: true },
];
let _bsToast    = null;
let _shownTrainsKeys = new Set();

/* ═══════════════════════════════════════════════
   LAYOUT
═══════════════════════════════════════════════ */
function adjustLayout() {
  const h = document.getElementById('appHeader').offsetHeight;
  document.documentElement.style.setProperty('--header-h', h + 'px');
  document.body.style.paddingTop = h + 'px';
}

/* ═══════════════════════════════════════════════
   API – proxy con auto-fallback
═══════════════════════════════════════════════ */
function viTimestamp(date) {
  const d   = date || new Date();
  const off = d.getTimezoneOffset();
  const sign = off <= 0 ? '+' : '-';
  const abs  = Math.abs(off);
  const offStr = String(Math.floor(abs/60)).padStart(2,'0') + String(abs%60).padStart(2,'0');
  return `${DAYS[d.getDay()]} ${MONTHS[d.getMonth()]} ${String(d.getDate()).padStart(2,'0')} `+
         `${d.getFullYear()} ${String(d.getHours()).padStart(2,'0')}:`+
         `${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')} GMT${sign}${offStr}`;
}

async function proxyFetch(path) {
  const targetUrl = VT_BASE + path;

  // Se già sappiamo quale proxy funziona, usiamo quello
  const start = _proxyOk !== null ? _proxyOk : 0;
  for (let i = 0; i < PROXY_POOL.length; i++) {
    const idx = (start + i) % PROXY_POOL.length;
    try {
      const resp = await fetch(PROXY_POOL[idx](targetUrl), {
        cache: 'no-store',
        signal: AbortSignal.timeout(10000)
      });
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      const text = await resp.text();
      // Scarta risposte HTML (homepage del proxy)
      if (text.trimStart().startsWith('<')) throw new Error('HTML response');
      _proxyOk = idx;
      return text;
    } catch { /* prova il prossimo */ }
  }
  throw new Error('Tutti i proxy falliti');
}

async function apiText(path)  { return proxyFetch(path); }
async function apiJson(path)  { return JSON.parse(await proxyFetch(path)); }

async function searchStations(q) {
  const text = await apiText('/autocompletaStazione/' + encodeURIComponent(q));
  if (!text || !text.trim()) return [];
  return text.trim().split('\n')
    .map(line => { const p = line.split('|'); return { name: p[0].trim(), id: (p[1]||'').trim() }; })
    .filter(s => s.id);
}

async function getDepartures(stId, date, rawTs) {
  const ts = rawTs || viTimestamp(date);
  return apiJson('/partenze/' + stId + '/' + encodeURIComponent(ts));
}
async function getArrivals(stId, date, rawTs) {
  const ts = rawTs || viTimestamp(date);
  return apiJson('/arrivi/'   + stId + '/' + encodeURIComponent(ts));
}

/* ═══════════════════════════════════════════════
   PAGE NAVIGATION
═══════════════════════════════════════════════ */
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
      const p = n => String(n).padStart(2, '0');
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
    searchWrap.classList.add('d-none');
    closeDropdown();
    document.getElementById('pagePreferiti').classList.remove('d-none');
    document.getElementById('navPreferiti').classList.add('active');
    renderFavorites();
  }
}

/* ═══════════════════════════════════════════════
   SEARCH / AUTOCOMPLETE
═══════════════════════════════════════════════ */
const searchInput = document.getElementById('searchInput');
const searchClear = document.getElementById('searchClear');
const acDropdown  = document.getElementById('acDropdown');
const acList      = document.getElementById('acList');
let searchTimer   = null;

searchInput.addEventListener('input', () => {
  const q = searchInput.value.trim();
  searchClear.classList.toggle('d-none', q.length === 0);
  clearTimeout(searchTimer);
  if (q.length < 2) { closeDropdown(); return; }
  searchTimer = setTimeout(() => doSearch(q), 380);
});
searchInput.addEventListener('focus', () => {
  if (searchInput.value.trim().length >= 2 && acList.children.length > 0) acDropdown.classList.add('show');
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
function closeDropdown() { acDropdown.classList.remove('show'); acList.innerHTML = ''; }

async function doSearch(q) {
  acList.innerHTML = '<div class="d-flex justify-content-center align-items-center py-3"><div class="spinner-border spinner-border-sm text-primary" role="status"></div><span class="ms-2 text-secondary">Ricerca...</span></div>';
  acDropdown.classList.add('show');
  try {
    const list = await searchStations(q);
    if (!list.length) { closeDropdown(); return; }
    acList.innerHTML = list.slice(0, 9).map(s => `
      <a href="#" class="list-group-item list-group-item-action ac-item d-flex align-items-center gap-2 py-3"
         data-id="${esc(s.id)}" data-name="${esc(s.name)}">
        <i class="bi bi-train-front text-primary flex-shrink-0"></i>
        <span>${esc(s.name)}</span>
      </a>`).join('');
    acDropdown.classList.add('show');
    acList.querySelectorAll('.ac-item').forEach(el =>
      el.addEventListener('click', e => { e.preventDefault(); selectStation(el.dataset.id, el.dataset.name); }));
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

/* ═══════════════════════════════════════════════
   ORARI PAGE
═══════════════════════════════════════════════ */
function loadOrari() {
  if (!station) return;
  const d = chosenDate || new Date();
  document.getElementById('orariContent').innerHTML =
    renderStationBar() + renderDatetimeBar(d) + renderTabsHTML() +
    renderAutoRefreshBar() + `<div id="trainsList">${renderLoading()}</div>`;

  document.querySelectorAll('[data-tab]').forEach(btn =>
    btn.addEventListener('click', () => {
      activeTab = btn.dataset.tab;
      document.querySelectorAll('[data-tab]').forEach(b =>
        b.classList.toggle('active', b.dataset.tab === activeTab));
      fetchAndRenderTrains();
    }));

  document.getElementById('btnGo').addEventListener('click', () => {
    const dateVal = document.getElementById('orariDate').value;
    const timeVal = document.getElementById('orariTime').value;
    chosenDate = dateVal ? new Date(`${dateVal}T${timeVal || '00:00'}`) : null;
    fetchAndRenderTrains();
  });
  setupTimeChips('orariDate', 'orariTime', '.orari-time-btn', () => {
    const dateVal = document.getElementById('orariDate').value;
    const timeVal = document.getElementById('orariTime').value;
    chosenDate = dateVal ? new Date(`${dateVal}T${timeVal || '00:00'}`) : null;
    fetchAndRenderTrains();
  });
  document.getElementById('autoRefreshToggle').addEventListener('change', e => {
    autoRefresh = e.target.checked;
    clearInterval(refreshTimer);
    if (autoRefresh) refreshTimer = setInterval(() => fetchAndRenderTrains(true), REFRESH_MS);
  });
  document.getElementById('btnFav').addEventListener('click', toggleFavorite);

  fetchAndRenderTrains();
}

function renderStationBar() {
  const isFav = favorites.some(f => f.id === station.id);
  return `
  <div class="d-flex align-items-center justify-content-between bg-white border-bottom px-3 py-2 shadow-sm">
    <div class="d-flex align-items-center gap-2 overflow-hidden">
      <i class="bi bi-geo-alt-fill text-primary fs-5 flex-shrink-0"></i>
      <span class="fw-bold text-truncate">${esc(station.name)}</span>
    </div>
    <div class="d-flex align-items-center gap-1 flex-shrink-0 ms-2">
      <button class="btn btn-link p-1 fs-4 lh-1 text-warning" id="btnFav">
        <i class="bi bi-star${isFav?'-fill':''}"></i>
      </button>
      <button class="btn btn-sm btn-outline-primary rounded-pill px-3" id="btnRefresh" onclick="fetchAndRenderTrains()">
        <i class="bi bi-arrow-clockwise" id="refreshIco"></i>
      </button>
    </div>
  </div>`;
}

function renderDatetimeBar(d) {
  const p = n => String(n).padStart(2, '0');
  const dateStr = `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}`;
  const timeStr = `${p(d.getHours())}:${p(d.getMinutes())}`;
  return `
  <div class="bg-light border-bottom px-3 pt-2 pb-2">
    <div class="d-flex gap-2 mb-2">
      <input type="date" class="form-control form-control-sm flex-grow-1" id="orariDate" value="${dateStr}">
      <button class="btn btn-primary px-4 fw-bold" id="btnGo">
        <i class="bi bi-search me-1"></i>Cerca
      </button>
    </div>
    <div class="d-flex gap-2 flex-wrap align-items-center">
      <button class="btn btn-sm btn-outline-secondary orari-time-btn" data-hour="now">Adesso</button>
      <button class="btn btn-sm btn-outline-secondary orari-time-btn" data-hour="6">Mattina</button>
      <button class="btn btn-sm btn-outline-secondary orari-time-btn" data-hour="13">Pomeriggio</button>
      <button class="btn btn-sm btn-outline-secondary orari-time-btn" data-hour="18">Sera</button>
      <button class="btn btn-sm btn-outline-secondary orari-time-btn" data-hour="21">Notte</button>
      <input type="time" class="form-control form-control-sm ms-auto" id="orariTime"
             style="max-width:100px" value="${timeStr}">
    </div>
  </div>`;
}

function renderTabsHTML() {
  return `
  <div class="sticky-tabs bg-white shadow-sm">
    <ul class="nav nav-tabs border-0 mb-0">
      <li class="nav-item flex-fill text-center">
        <button class="nav-link w-100 rounded-0 py-3 ${activeTab==='partenze'?'active':'border-0'}" data-tab="partenze">
          <i class="bi bi-arrow-up-right-circle${activeTab==='partenze'?'-fill':''} me-1"></i>Partenze
        </button>
      </li>
      <li class="nav-item flex-fill text-center">
        <button class="nav-link w-100 rounded-0 py-3 ${activeTab==='arrivi'?'active':'border-0'}" data-tab="arrivi">
          <i class="bi bi-arrow-down-left-circle${activeTab==='arrivi'?'-fill':''} me-1"></i>Arrivi
        </button>
      </li>
    </ul>
  </div>`;
}

function renderAutoRefreshBar() {
  return `
  <div class="d-flex align-items-center justify-content-between bg-light px-3 py-2 border-bottom">
    <small class="text-muted" id="lastUpdateLabel">–</small>
    <div class="d-flex align-items-center gap-2">
      <small class="text-muted">Auto</small>
      <div class="form-check form-switch mb-0">
        <input class="form-check-input" type="checkbox" id="autoRefreshToggle" role="switch" ${autoRefresh?'checked':''}>
      </div>
    </div>
  </div>`;
}

function renderLoading() {
  return `
  <div class="d-flex flex-column align-items-center justify-content-center py-5 text-muted">
    <div class="spinner-border text-primary" role="status" style="width:2.5rem;height:2.5rem"></div>
    <small class="mt-3">Caricamento…</small>
  </div>`;
}

async function fetchAndRenderTrains(silent = false) {
  const listEl = document.getElementById('trainsList');
  if (!listEl || !station) return;
  if (!silent) listEl.innerHTML = renderLoading();

  const ico     = document.getElementById('refreshIco');
  const btnRef  = document.getElementById('btnRefresh');
  if (ico)    ico.classList.add('spin');
  if (btnRef) btnRef.disabled = true;

  try {
    const d      = chosenDate || new Date();
    const trains = activeTab === 'partenze'
      ? await getDepartures(station.id, d)
      : await getArrivals(station.id, d);

    _shownTrainsKeys = new Set();
    const tsKey = activeTab === 'partenze' ? 'orarioPartenza' : 'orarioArrivo';
    trains.forEach(t => _shownTrainsKeys.add(t.numeroTreno + '|' + (t.dataPartenzaTreno || '')));
    const firstTs = trains.length ? trains[0][tsKey] : null;
    const lastTs  = trains.length ? trains[trains.length - 1][tsKey] : null;

    listEl.innerHTML = `
      <div class="px-3 pt-2">
        <button class="btn btn-outline-secondary btn-sm w-100 mb-2" id="btnLoadPrevTrains">
          <i class="bi bi-arrow-up me-1"></i>Orari precedenti
        </button>
      </div>
      <div id="trainsCardList">${renderTrainsList(trains)}</div>
      <div class="px-3 pb-3">
        <button class="btn btn-outline-secondary btn-sm w-100 mt-2" id="btnLoadNextTrains">
          <i class="bi bi-arrow-down me-1"></i>Orari successivi
        </button>
      </div>`;

    if (firstTs) document.getElementById('btnLoadPrevTrains').onclick = () => loadMoreTrains('prev', firstTs);
    if (lastTs)  document.getElementById('btnLoadNextTrains').onclick = () => loadMoreTrains('next', lastTs);

    const now = formatTime(new Date());
    const lbl = document.getElementById('lastUpdateLabel');
    if (lbl) lbl.textContent = 'Aggiornato: ' + now;
    const lu = document.getElementById('lastUpdate');
    if (lu)  lu.textContent = 'Aggiornato: ' + now;
  } catch {
    listEl.innerHTML = `
      <div class="text-center text-muted py-5">
        <i class="bi bi-wifi-off" style="font-size:3rem;opacity:.25"></i>
        <h6 class="mt-3 fw-semibold">Errore di caricamento</h6>
        <p class="small mb-0">Verifica la connessione e riprova</p>
      </div>`;
    showToast('Impossibile caricare i dati');
  } finally {
    if (ico)    ico.classList.remove('spin');
    if (btnRef) btnRef.disabled = false;
  }
}

async function loadMoreTrains(direction, anchorTs) {
  const btnId = direction === 'prev' ? 'btnLoadPrevTrains' : 'btnLoadNextTrains';
  const btnEl = document.getElementById(btnId);
  if (!btnEl) return;
  const origHTML = btnEl.innerHTML;
  btnEl.disabled = true;
  btnEl.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Caricamento...';

  try {
    const baseDate = direction === 'prev'
      ? new Date(anchorTs - 3 * 60 * 60 * 1000)
      : new Date(anchorTs);

    const trains = activeTab === 'partenze'
      ? await getDepartures(station.id, baseDate)
      : await getArrivals(station.id, baseDate);

    const tsKey = activeTab === 'partenze' ? 'orarioPartenza' : 'orarioArrivo';
    const newTrains = trains.filter(t => {
      const key = t.numeroTreno + '|' + (t.dataPartenzaTreno || '');
      if (_shownTrainsKeys.has(key)) return false;
      if (direction === 'prev' && t[tsKey] >= anchorTs) return false;
      if (direction === 'next' && t[tsKey] <= anchorTs) return false;
      return true;
    });

    if (!newTrains.length) {
      btnEl.disabled = true;
      btnEl.innerHTML = direction === 'prev'
        ? '<i class="bi bi-check me-1"></i>Nessun orario precedente'
        : '<i class="bi bi-check me-1"></i>Nessun orario successivo';
      return;
    }

    newTrains.forEach(t => _shownTrainsKeys.add(t.numeroTreno + '|' + (t.dataPartenzaTreno || '')));
    const cardListEl = document.getElementById('trainsCardList');
    const html = `<div class="px-3 pt-3 pb-2">${newTrains.map(renderTrainCard).join('')}</div>`;

    if (direction === 'prev') {
      cardListEl.insertAdjacentHTML('afterbegin', html);
      const newFirstTs = newTrains[0][tsKey];
      btnEl.disabled = false;
      btnEl.innerHTML = origHTML;
      btnEl.onclick = () => loadMoreTrains('prev', newFirstTs);
    } else {
      cardListEl.insertAdjacentHTML('beforeend', html);
      const newLastTs = newTrains[newTrains.length - 1][tsKey];
      btnEl.disabled = false;
      btnEl.innerHTML = origHTML;
      btnEl.onclick = () => loadMoreTrains('next', newLastTs);
    }
  } catch {
    btnEl.disabled = false;
    btnEl.innerHTML = origHTML;
    showToast('Errore nel caricamento');
  }
}

function renderTrainsList(trains) {
  if (!trains || !trains.length) {
    return `
      <div class="text-center text-muted py-5">
        <i class="bi bi-calendar-x" style="font-size:3rem;opacity:.25"></i>
        <h6 class="mt-3 fw-semibold">Nessun treno trovato</h6>
        <p class="small mb-0">Prova a cambiare orario o data</p>
      </div>`;
  }
  return `<div class="px-3 pt-3 pb-2">${trains.map(renderTrainCard).join('')}</div>`;
}

function renderTrainCard(t) {
  const isDep = activeTab === 'partenze';

  const timeMs  = isDep ? t.orarioPartenza : t.orarioArrivo;
  const timeStr = timeMs ? formatTime(new Date(timeMs))
    : (isDep ? t.compOrarioPartenza : t.compOrarioArrivo) || '--:--';
  const timeLabel = isDep ? 'Partenza' : 'Arrivo';
  const dest  = isDep ? (t.destinazione || '—') : (t.origine || '—');

  const platEff  = isDep ? t.binarioEffettivoPartenzaDescrizione : t.binarioEffettivoArrivoDescrizione;
  const platProg = isDep ? t.binarioProgrammatoPartenzaDescrizione : t.binarioProgrammatoArrivoDescrizione;
  const platShow   = platEff || platProg || null;
  const platChanged = platEff && platProg && platEff.trim() !== platProg.trim();

  const cat = (t.categoriaDescrizione || t.categoria || '').trim().toUpperCase() || 'REG';
  const [catBg, catTx] = getCatColors(cat);

  const delay = t.ritardo || 0;
  let delayBadge;
  if      (delay > 15) delayBadge = `<span class="badge bg-danger">+${delay} min</span>`;
  else if (delay > 0)  delayBadge = `<span class="badge bg-warning text-dark">+${delay} min</span>`;
  else if (delay < 0)  delayBadge = `<span class="badge bg-success">${delay} min</span>`;
  else                 delayBadge = `<span class="badge bg-success"><i class="bi bi-check-lg"></i> In orario</span>`;

  let statusBadge = '';
  if      (t.nonPartito) statusBadge = `<span class="badge bg-secondary">Non partito</span>`;
  else if (t.inStazione) statusBadge = `<span class="badge bg-success bg-opacity-75"><i class="bi bi-geo-alt-fill"></i> In stazione</span>`;

  let platHTML;
  if (platShow) {
    platHTML = `
      <div class="d-flex align-items-center gap-2 flex-wrap mt-2">
        <span class="text-muted small">Binario</span>
        <span class="badge ${platChanged?'bg-warning text-dark':'bg-primary'} platform-num">${esc(platShow)}</span>
        ${platChanged ? `<small class="text-muted fst-italic">var. da <strong>${esc(platProg)}</strong></small>` : ''}
      </div>`;
  } else {
    platHTML = `<div class="mt-2"><small class="text-muted fst-italic">Binario non disponibile</small></div>`;
  }

  return `
  <div class="card mb-2 border-0 shadow-sm">
    <div class="card-body p-3">
      <div class="d-flex justify-content-between align-items-start mb-2">
        <div class="d-flex align-items-center gap-2 flex-wrap me-2">
          <span class="badge ${catBg} ${catTx}">${esc(cat)}</span>
          <span class="text-muted small fw-semibold">${esc((t.compNumeroTreno||String(t.numeroTreno||'')).trim())}</span>
          ${statusBadge}
        </div>
        ${delayBadge}
      </div>
      <div class="d-flex justify-content-between align-items-center">
        <span class="fw-bold lh-sm me-3">${esc(dest)}</span>
        <div class="text-end flex-shrink-0">
          <div class="train-time text-primary lh-1">${timeStr}</div>
          <div class="text-muted small mt-1">${timeLabel}</div>
        </div>
      </div>
      ${platHTML}
    </div>
  </div>`;
}

/* ═══════════════════════════════════════════════
   FAVORITES
═══════════════════════════════════════════════ */
function toggleFavorite() {
  if (!station) return;
  const idx = favorites.findIndex(f => f.type !== 'route' && f.id === station.id);
  if (idx >= 0) { favorites.splice(idx, 1); showToast('Rimosso dai preferiti'); }
  else          { favorites.push({ id: station.id, name: station.name }); showToast('Aggiunto ai preferiti ⭐'); }
  saveFavorites();
  const btn   = document.getElementById('btnFav');
  const isFav = favorites.some(f => f.type !== 'route' && f.id === station.id);
  if (btn) btn.innerHTML = `<i class="bi bi-star${isFav?'-fill':''}"></i>`;
}

function toggleRouteFavorite() {
  if (!routeFrom || !routeTo) { showToast('Seleziona prima partenza e arrivo'); return; }
  const routeKey = `${routeFrom.id}→${routeTo.id}`;
  const idx = favorites.findIndex(f => f.type === 'route' && f.routeKey === routeKey);
  const btn = document.getElementById('btnSaveRoute');
  if (idx >= 0) {
    favorites.splice(idx, 1);
    showToast('Itinerario rimosso dai preferiti');
    if (btn) btn.innerHTML = `<i class="bi bi-star me-1"></i>Salva itinerario`;
  } else {
    favorites.push({ type: 'route', routeKey, fromId: routeFrom.id, fromName: routeFrom.name, toId: routeTo.id, toName: routeTo.name });
    showToast('Itinerario salvato ⭐');
    if (btn) btn.innerHTML = `<i class="bi bi-star-fill me-1"></i>Salvato`;
  }
  saveFavorites();
}

function saveFavorites() { localStorage.setItem('treni_fav', JSON.stringify(favorites)); }

function renderFavorites() {
  const el = document.getElementById('favList');
  if (!el) return;
  if (!favorites.length) {
    el.innerHTML = `
      <div class="text-center text-muted py-5">
        <i class="bi bi-star" style="font-size:3.5rem;opacity:.18"></i>
        <h6 class="mt-3 fw-semibold">Nessun preferito</h6>
        <p class="small mb-0">Salva stazioni o itinerari con ☆</p>
      </div>`;
    return;
  }

  const stations = favorites.filter(f => f.type !== 'route');
  const routes   = favorites.filter(f => f.type === 'route');

  let html = '';

  if (stations.length) {
    html += `<div class="px-3 pt-3 pb-1"><small class="text-muted fw-semibold text-uppercase" style="font-size:.7rem;letter-spacing:.08em">Stazioni</small></div>`;
    html += `<div class="list-group list-group-flush px-3">` +
      stations.map(f => `
        <div class="list-group-item list-group-item-action border-0 rounded-3 mb-2 shadow-sm
                    d-flex align-items-center gap-3 py-3 fav-card"
             style="cursor:pointer" data-id="${esc(f.id)}" data-name="${esc(f.name)}">
          <div class="rounded-3 p-2 flex-shrink-0" style="background:#dbeafe">
            <i class="bi bi-train-front-fill text-primary fs-4"></i>
          </div>
          <div class="flex-grow-1 overflow-hidden">
            <div class="fw-bold text-truncate">${esc(f.name)}</div>
            <small class="text-muted">${esc(f.id)}</small>
          </div>
          <button class="btn btn-link text-danger p-1 flex-shrink-0 btn-remove-fav"
                  data-id="${esc(f.id)}" aria-label="Rimuovi">
            <i class="bi bi-x-circle-fill fs-5"></i>
          </button>
        </div>`).join('') + `</div>`;
  }

  if (routes.length) {
    html += `<div class="px-3 pt-3 pb-1"><small class="text-muted fw-semibold text-uppercase" style="font-size:.7rem;letter-spacing:.08em">Itinerari</small></div>`;
    html += `<div class="list-group list-group-flush px-3 pb-3">` +
      routes.map(f => `
        <div class="list-group-item list-group-item-action border-0 rounded-3 mb-2 shadow-sm
                    d-flex align-items-center gap-3 py-3 fav-route-card"
             style="cursor:pointer" data-from-id="${esc(f.fromId)}" data-from-name="${esc(f.fromName)}"
             data-to-id="${esc(f.toId)}" data-to-name="${esc(f.toName)}">
          <div class="rounded-3 p-2 flex-shrink-0" style="background:#dcfce7">
            <i class="bi bi-signpost-split-fill text-success fs-4"></i>
          </div>
          <div class="flex-grow-1 overflow-hidden">
            <div class="fw-bold text-truncate">${esc(f.fromName)}</div>
            <div class="d-flex align-items-center gap-1">
              <i class="bi bi-arrow-down text-muted" style="font-size:.75rem"></i>
              <span class="text-muted small text-truncate">${esc(f.toName)}</span>
            </div>
          </div>
          <button class="btn btn-link text-danger p-1 flex-shrink-0 btn-remove-route"
                  data-key="${esc(f.routeKey)}" aria-label="Rimuovi">
            <i class="bi bi-x-circle-fill fs-5"></i>
          </button>
        </div>`).join('') + `</div>`;
  }

  el.innerHTML = html;

  el.querySelectorAll('.fav-card').forEach(card =>
    card.addEventListener('click', e => {
      if (e.target.closest('.btn-remove-fav')) return;
      selectStation(card.dataset.id, card.dataset.name);
    }));
  el.querySelectorAll('.btn-remove-fav').forEach(btn =>
    btn.addEventListener('click', e => {
      e.stopPropagation();
      favorites = favorites.filter(f => f.type !== 'route' && f.id !== btn.dataset.id || f.type === 'route');
      saveFavorites(); renderFavorites();
      showToast('Rimosso dai preferiti');
    }));

  el.querySelectorAll('.fav-route-card').forEach(card =>
    card.addEventListener('click', e => {
      if (e.target.closest('.btn-remove-route')) return;
      // Carica l'itinerario nella pagina Itinerario e avvia la ricerca
      routeFrom = { id: card.dataset.fromId, name: card.dataset.fromName };
      routeTo   = { id: card.dataset.toId,   name: card.dataset.toName   };
      showPage('itinerario');
      // Dopo init, popola i campi e cerca
      document.getElementById('routeFrom').value = card.dataset.fromName;
      document.getElementById('routeTo').value   = card.dataset.toName;
      document.getElementById('clearFrom').classList.remove('d-none');
      document.getElementById('clearTo').classList.remove('d-none');
      // aggiorna bottone salva
      const routeKey = `${routeFrom.id}→${routeTo.id}`;
      const isSaved = favorites.some(f => f.type === 'route' && f.routeKey === routeKey);
      const btnS = document.getElementById('btnSaveRoute');
      if (btnS) btnS.innerHTML = `<i class="bi bi-star${isSaved?'-fill':''} me-1"></i>${isSaved?'Salvato':'Salva itinerario'}`;
      searchRoute();
    }));
  el.querySelectorAll('.btn-remove-route').forEach(btn =>
    btn.addEventListener('click', e => {
      e.stopPropagation();
      favorites = favorites.filter(f => f.routeKey !== btn.dataset.key);
      saveFavorites(); renderFavorites();
      showToast('Itinerario rimosso dai preferiti');
    }));
}

/* ═══════════════════════════════════════════════
   UTILS
═══════════════════════════════════════════════ */
function esc(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
function formatTime(d) {
  return String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0');
}
function toLocalIso(d) {
  const p = n => String(n).padStart(2,'0');
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
function getCatColors(cat) {
  if (/FR|AV/.test(cat))  return ['bg-danger',   'text-white'];
  if (/ICN/.test(cat))    return ['bg-cat-icn',   'text-white'];
  if (/IC/.test(cat))     return ['bg-cat-ic',    'text-white'];
  if (/EC/.test(cat))     return ['bg-warning',   'text-dark'];
  if (/REG|RV/.test(cat)) return ['bg-success',   'text-white'];
  return ['bg-secondary', 'text-white'];
}

/* ── TOAST ── */
function showToast(msg) {
  const el = document.getElementById('appToast');
  document.getElementById('toastBody').textContent = msg;
  if (!_bsToast) _bsToast = bootstrap.Toast.getOrCreateInstance(el, { delay: 2600 });
  _bsToast.show();
}

/* ═══════════════════════════════════════════════
   ITINERARIO
═══════════════════════════════════════════════ */
let routeFrom = null; // { id, name }
let routeTo   = null;
let _itinerarioInited = false;
let _countdownInterval = null;
let _shownRouteKeys = new Set();

/* ═══════════════════════════════════════════════
   NOTIFICHE
═══════════════════════════════════════════════ */
async function requestNotifPermission() {
  if (!('Notification' in window) || !('serviceWorker' in navigator)) return;
  if (Notification.permission === 'default') {
    await Notification.requestPermission();
  }
}

async function sendNotification(title, body, tag, vibrate) {
  if (!('serviceWorker' in navigator) || Notification.permission !== 'granted') return;
  try {
    const reg = await navigator.serviceWorker.ready;
    reg.showNotification(title, {
      body,
      icon: './icons/icon-192.png',
      tag,
      renotify: true,
      vibrate,
    });
  } catch (_) { /* silenzioso */ }
}

/* Restituisce un pattern di vibrazione in base al "rango" della soglia:
   rank 0 = soglia più lontana (es. 10 min) → 2 pulsazioni
   rank 1 = soglia intermedia (es. 5 min)   → 3 pulsazioni
   rank 2 = soglia più vicina (es. 2 min)   → 4 pulsazioni  */
function getVibrationPattern(rank) {
  const pulse = 200 + rank * 100;
  const count = rank + 2; // 2, 3, 4, ...
  const pattern = [];
  for (let i = 0; i < count; i++) {
    pattern.push(pulse);
    if (i < count - 1) pattern.push(100);
  }
  return pattern;
}

/* ═══════════════════════════════════════════════
   IMPOSTAZIONI
═══════════════════════════════════════════════ */
function renderImpostazioni() {
  const list = document.getElementById('thresholdList');
  if (!list) return;
  list.innerHTML = notifThresholds.map((t, i) => `
    <div class="d-flex align-items-center gap-3 mb-3" id="thr-row-${i}">
      <div class="form-check form-switch mb-0 flex-shrink-0">
        <input class="form-check-input" type="checkbox" role="switch"
               id="thr-enabled-${i}" ${t.enabled ? 'checked' : ''}>
      </div>
      <div class="input-group input-group-sm" style="max-width:120px">
        <input type="number" class="form-control" id="thr-min-${i}"
               value="${t.min}" min="1" max="180">
        <span class="input-group-text">min</span>
      </div>
      <span class="text-muted small flex-grow-1">prima della partenza</span>
      <button class="btn btn-sm btn-outline-danger px-2" onclick="removeThreshold(${i})" title="Rimuovi">
        <i class="bi bi-trash"></i>
      </button>
    </div>
  `).join('');

  notifThresholds.forEach((_, i) => {
    document.getElementById(`thr-enabled-${i}`)
      .addEventListener('change', saveThresholds);
    document.getElementById(`thr-min-${i}`)
      .addEventListener('change', saveThresholds);
  });

  const btnAdd = document.getElementById('btnAddThreshold');
  btnAdd.onclick = () => {
    notifThresholds.push({ min: 15, enabled: true });
    saveThresholds();
    renderImpostazioni();
  };
}

function saveThresholds() {
  notifThresholds = notifThresholds.map((t, i) => ({
    min:     Math.max(1, parseInt(document.getElementById(`thr-min-${i}`)?.value, 10) || t.min),
    enabled: document.getElementById(`thr-enabled-${i}`)?.checked ?? t.enabled,
  }));
  localStorage.setItem('notif_thresholds', JSON.stringify(notifThresholds));
}

function removeThreshold(index) {
  if (notifThresholds.length <= 1) return; // almeno 1 soglia
  notifThresholds.splice(index, 1);
  localStorage.setItem('notif_thresholds', JSON.stringify(notifThresholds));
  renderImpostazioni();
}
function setupTimeChips(dateId, timeId, chipSel, onChange) {
  const p = n => String(n).padStart(2, '0');
  document.querySelectorAll(chipSel).forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll(chipSel).forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const h = btn.dataset.hour;
      if (h === 'now') {
        const n = new Date();
        document.getElementById(dateId).value = toLocalIso(n).slice(0, 10);
        document.getElementById(timeId).value = `${p(n.getHours())}:${p(n.getMinutes())}`;
      } else {
        document.getElementById(timeId).value = `${p(parseInt(h))}:00`;
      }
      if (onChange) onChange();
    });
  });
  document.getElementById(timeId).addEventListener('input', () => {
    document.querySelectorAll(chipSel).forEach(b => b.classList.remove('active'));
  });
}

function initItinerario() {
  if (_itinerarioInited) return;
  _itinerarioInited = true;

  // imposta data e ora al momento attuale
  const now = new Date();
  document.getElementById('routeDate').value = toLocalIso(now).slice(0, 10);
  const p = n => String(n).padStart(2,'0');
  document.getElementById('routeTime').value = `${p(now.getHours())}:${p(now.getMinutes())}`;

  // chip orario rapido
  setupTimeChips('routeDate', 'routeTime', '.route-time-btn', searchRoute);

  // quando l'utente modifica manualmente il campo orario, deseleziona i chip
  // (già gestito da setupTimeChips)

  // autocomplete Da
  setupRouteAc(
    document.getElementById('routeFrom'),
    document.getElementById('acFromList'),
    document.getElementById('acFrom'),
    document.getElementById('clearFrom'),
    s => { routeFrom = s; }
  );
  // autocomplete A
  setupRouteAc(
    document.getElementById('routeTo'),
    document.getElementById('acToList'),
    document.getElementById('acTo'),
    document.getElementById('clearTo'),
    s => { routeTo = s; }
  );

  // scambia
  document.getElementById('btnSwap').addEventListener('click', () => {
    const tmpSt  = routeFrom; routeFrom = routeTo; routeTo = tmpSt;
    const fromEl = document.getElementById('routeFrom');
    const toEl   = document.getElementById('routeTo');
    const tmpVal = fromEl.value; fromEl.value = toEl.value; toEl.value = tmpVal;
  });

  // cerca
  document.getElementById('btnSearchRoute').addEventListener('click', searchRoute);

  // salva itinerario preferito
  document.getElementById('btnSaveRoute').addEventListener('click', toggleRouteFavorite);
}

function setupRouteAc(input, listEl, dropEl, clearBtn, onSelect) {
  let timer = null;
  function closeRouteDropdown() { dropEl.classList.remove('show'); listEl.innerHTML = ''; }
  input.addEventListener('input', () => {
    const q = input.value.trim();
    clearBtn.classList.toggle('d-none', q.length === 0);
    clearTimeout(timer);
    if (q.length < 2) { closeRouteDropdown(); return; }
    timer = setTimeout(async () => {
      listEl.innerHTML = '<div class="d-flex justify-content-center align-items-center py-3"><div class="spinner-border spinner-border-sm text-primary" role="status"></div><span class="ms-2 text-secondary">Ricerca...</span></div>';
      dropEl.classList.add('show');
      try {
        const list = await searchStations(q);
        if (!list.length) { closeRouteDropdown(); return; }
        listEl.innerHTML = list.slice(0, 8).map(s => `
          <a href="#" class="list-group-item list-group-item-action ac-item d-flex align-items-center gap-2 py-3"
             data-id="${esc(s.id)}" data-name="${esc(s.name)}">
            <i class="bi bi-train-front text-primary flex-shrink-0"></i>
            <span>${esc(s.name)}</span>
          </a>`).join('');
        dropEl.classList.add('show');
        listEl.querySelectorAll('.ac-item').forEach(el =>
          el.addEventListener('click', e => {
            e.preventDefault();
            onSelect({ id: el.dataset.id, name: el.dataset.name });
            input.value = el.dataset.name;
            clearBtn.classList.remove('d-none');
            closeRouteDropdown();
          }));
      } catch { closeRouteDropdown(); }
    }, 380);
  });
  input.addEventListener('focus', () => {
    if (input.value.trim().length >= 2 && listEl.children.length > 0) dropEl.classList.add('show');
  });
  clearBtn.addEventListener('click', () => {
    input.value = ''; onSelect(null);
    clearBtn.classList.add('d-none');
    closeRouteDropdown();
    input.focus();
  });
  document.addEventListener('click', e => {
    if (!e.target.closest(`#${input.closest('.route-input-wrap').id}`))
      closeRouteDropdown();
  });
}

async function searchRoute() {
  if (!routeFrom || !routeTo) {
    showToast('Inserisci stazione di partenza e arrivo');
    return;
  }
  if (_countdownInterval) { clearInterval(_countdownInterval); _countdownInterval = null; }
  // Aggiorna icona bottone salva in base allo stato preferiti
  const routeKey = `${routeFrom.id}→${routeTo.id}`;
  const isSaved  = favorites.some(f => f.type === 'route' && f.routeKey === routeKey);
  const btnS = document.getElementById('btnSaveRoute');
  if (btnS) btnS.innerHTML = `<i class="bi bi-star${isSaved?'-fill':''} me-1"></i>${isSaved?'Salvato':'Salva itinerario'}`;

  const dateStr = document.getElementById('routeDate').value;   // YYYY-MM-DD
  const timeStr = document.getElementById('routeTime').value;   // HH:mm
  const date0 = dateStr
    ? new Date(`${dateStr}T${timeStr || '00:00'}`)
    : new Date();

  const resEl = document.getElementById('routeResults');
  resEl.innerHTML = `
    <div class="d-flex flex-column align-items-center justify-content-center py-5 text-muted">
      <div class="spinner-border text-primary" role="status" style="width:2.5rem;height:2.5rem"></div>
      <small class="mt-3">Ricerca treni…</small>
    </div>`;

  try {
    // Recupera partenze da A e arrivi a B in 3 finestre orarie consecutive (+0h, +1h, +2h)
    // per coprire una fascia di ~3 ore dalla data scelta
    const windows = [0, 60, 120].map(deltaMin => {
      const d = new Date(date0.getTime() + deltaMin * 60000);
      return viTimestamp(d);
    });

    const [depResults, arrResults] = await Promise.all([
      // partenze dalla stazione A nelle 3 finestre
      Promise.all(windows.map(ts =>
        getDepartures(routeFrom.id, null, ts).catch(() => [])
      )),
      // arrivi alla stazione B nelle 3 finestre
      Promise.all(windows.map(ts =>
        getArrivals(routeTo.id, null, ts).catch(() => [])
      ))
    ]);

    // Deduplica per numeroTreno (tenendo il primo trovato)
    const depMap = new Map();
    depResults.flat().forEach(t => {
      const key = t.numeroTreno + '|' + t.dataPartenzaTreno;
      if (!depMap.has(key)) depMap.set(key, t);
    });
    const arrMap = new Map();
    arrResults.flat().forEach(t => {
      const key = t.numeroTreno + '|' + t.dataPartenzaTreno;
      if (!arrMap.has(key)) arrMap.set(key, t);
    });

    // Incrocia: un treno valido parte da A e arriva a B (orarioPartenza < orarioArrivo)
    const matches = [];
    depMap.forEach((dep, key) => {
      const arr = arrMap.get(key);
      if (!arr) return;
      const tDep = dep.orarioPartenza || dep.orarioPartenzaZero;
      const tArr = arr.orarioArrivo  || arr.orarioArrivoZero;
      if (tDep && tArr && tDep < tArr) {
        matches.push({ dep, arr });
      }
    });

    // Ordina per orario di partenza
    matches.sort((a, b) =>
      (a.dep.orarioPartenza || a.dep.orarioPartenzaZero) -
      (b.dep.orarioPartenza || b.dep.orarioPartenzaZero)
    );

    if (!matches.length) {
      resEl.innerHTML = `
        <div class="text-center text-muted py-5">
          <i class="bi bi-map" style="font-size:3rem;opacity:.25"></i>
          <h6 class="mt-3 fw-semibold">Nessun treno trovato</h6>
          <p class="small mb-0">Prova a cambiare data o orario</p>
        </div>`;
      return;
    }

    _shownRouteKeys = new Set(matches.map(m => m.dep.numeroTreno + '|' + m.dep.dataPartenzaTreno));
    const firstTs = matches[0].dep.orarioPartenza || matches[0].dep.orarioPartenzaZero;
    const lastTs  = matches[matches.length - 1].dep.orarioPartenza || matches[matches.length - 1].dep.orarioPartenzaZero;

    resEl.innerHTML = `
      <div class="px-3 py-2">
        <small class="text-muted fw-semibold">
          ${esc(routeFrom.name)} → ${esc(routeTo.name)}
          &nbsp;•&nbsp; ${matches.length} treno${matches.length === 1 ? '' : 'i'}
        </small>
      </div>
      <div class="px-3">
        <button class="btn btn-outline-secondary btn-sm w-100 mb-3" id="btnLoadPrev">
          <i class="bi bi-arrow-up me-1"></i>Treni precedenti
        </button>
      </div>
      <div class="px-3 pb-3" id="routeCardList">${matches.map(renderRouteCard).join('')}</div>
      <div class="px-3 pb-3">
        <button class="btn btn-outline-secondary btn-sm w-100" id="btnLoadNext">
          <i class="bi bi-arrow-down me-1"></i>Treni successivi
        </button>
      </div>`;

    document.getElementById('btnLoadPrev').onclick = () => loadMoreRoute('prev', firstTs);
    document.getElementById('btnLoadNext').onclick = () => loadMoreRoute('next', lastTs);
    attachRouteCardCountdowns(resEl);
  } catch (e) {
    resEl.innerHTML = `
      <div class="text-center text-muted py-5">
        <i class="bi bi-wifi-off" style="font-size:3rem;opacity:.25"></i>
        <h6 class="mt-3 fw-semibold">Errore di caricamento</h6>
        <p class="small mb-0">Verifica la connessione e riprova</p>
      </div>`;
    showToast('Impossibile caricare i treni');
  }
}

function attachRouteCardCountdowns(container) {
  if (_countdownInterval) clearInterval(_countdownInterval);
  _countdownInterval = setInterval(() => {
    document.querySelectorAll('.solution-card.cd-open').forEach(updateCountdownCard);
  }, 1000);
  container.querySelectorAll('.solution-card:not([data-cd-ready])').forEach(card => {
    card.dataset.cdReady = '1';
    card.style.cursor = 'pointer';
    card.addEventListener('click', () => {
      const isOpen = card.classList.contains('cd-open');
      document.querySelectorAll('.solution-card.cd-open').forEach(c => {
        c.classList.remove('cd-open');
        c.querySelector('.countdown-panel').classList.add('d-none');
        delete c.dataset.prevSec; // resetta soglie vibrazione alla chiusura
      });
      if (!isOpen) {
        requestNotifPermission();
        card.classList.add('cd-open');
        card.querySelector('.countdown-panel').classList.remove('d-none');
        updateCountdownCard(card);
      }
    });
  });
}

function updateCountdownCard(card) {
  const depTs = parseInt(card.dataset.depTs, 10);
  const el = card.querySelector('.countdown-value');
  if (!el || isNaN(depTs)) return;
  const diff = depTs - Date.now();
  if (diff <= 0) {
    el.textContent = 'Partito';
    el.className = 'countdown-value fw-bold text-danger';
    return;
  }
  const totalSec = Math.floor(diff / 1000);

  // Notifica + vibrazione una sola volta al passaggio sotto le soglie configurate
  const prevSec = parseInt(card.dataset.prevSec || '99999', 10);
  const trainLabel = card.dataset.trainLabel || 'Treno';
  const enabledThresholds = notifThresholds
    .filter(t => t.enabled && t.min > 0)
    .sort((a, b) => b.min - a.min); // discendente: [10, 5, 2, ...]
  for (let i = 0; i < enabledThresholds.length; i++) {
    const sec = enabledThresholds[i].min * 60;
    const minLabel = enabledThresholds[i].min;
    if (prevSec >= sec && totalSec < sec) {
      const vib = getVibrationPattern(i);
      if (navigator.vibrate) navigator.vibrate(vib);
      const body = minLabel === 1
        ? 'Partenza tra meno di 1 minuto'
        : `Partenza tra meno di ${minLabel} minuti`;
      sendNotification(trainLabel, body, `treno-${minLabel}min`, vib);
      break;
    }
  }
  card.dataset.prevSec = totalSec;

  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const p = n => String(n).padStart(2, '0');
  el.textContent = h > 0 ? `${h}:${p(m)}:${p(s)}` : `${p(m)}:${p(s)}`;
  el.className = 'countdown-value fw-bold fs-3 ' +
    (totalSec < 300 ? 'text-danger' : totalSec < 900 ? 'text-warning' : 'text-success');
}

async function loadMoreRoute(direction, anchorTs) {
  const btnId = direction === 'prev' ? 'btnLoadPrev' : 'btnLoadNext';
  const btnEl = document.getElementById(btnId);
  if (!btnEl) return;
  const origHTML = btnEl.innerHTML;
  btnEl.disabled = true;
  btnEl.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Caricamento...';

  try {
    const baseDate = direction === 'prev'
      ? new Date(anchorTs - 3 * 60 * 60 * 1000)
      : new Date(anchorTs);

    const windows = [0, 60, 120].map(delta => {
      const d = new Date(baseDate.getTime() + delta * 60000);
      return viTimestamp(d);
    });

    const [depResults, arrResults] = await Promise.all([
      Promise.all(windows.map(ts => getDepartures(routeFrom.id, null, ts).catch(() => []))),
      Promise.all(windows.map(ts => getArrivals(routeTo.id, null, ts).catch(() => [])))
    ]);

    const depMap = new Map();
    depResults.flat().forEach(t => {
      const key = t.numeroTreno + '|' + t.dataPartenzaTreno;
      if (!depMap.has(key)) depMap.set(key, t);
    });
    const arrMap = new Map();
    arrResults.flat().forEach(t => {
      const key = t.numeroTreno + '|' + t.dataPartenzaTreno;
      if (!arrMap.has(key)) arrMap.set(key, t);
    });

    const newMatches = [];
    depMap.forEach((dep, key) => {
      if (_shownRouteKeys.has(key)) return;
      const arr = arrMap.get(key);
      if (!arr) return;
      const tDep = dep.orarioPartenza || dep.orarioPartenzaZero;
      const tArr = arr.orarioArrivo  || arr.orarioArrivoZero;
      if (!tDep || !tArr || tDep >= tArr) return;
      if (direction === 'prev' && tDep >= anchorTs) return;
      if (direction === 'next' && tDep <= anchorTs) return;
      newMatches.push({ dep, arr });
    });

    newMatches.sort((a, b) =>
      (a.dep.orarioPartenza || a.dep.orarioPartenzaZero) -
      (b.dep.orarioPartenza || b.dep.orarioPartenzaZero)
    );
    newMatches.forEach(m => _shownRouteKeys.add(m.dep.numeroTreno + '|' + m.dep.dataPartenzaTreno));

    const listEl = document.getElementById('routeCardList');
    if (!newMatches.length) {
      btnEl.disabled = true;
      btnEl.innerHTML = direction === 'prev'
        ? '<i class="bi bi-check me-1"></i>Nessun treno precedente'
        : '<i class="bi bi-check me-1"></i>Nessun treno successivo';
      return;
    }

    const html = newMatches.map(renderRouteCard).join('');
    if (direction === 'prev') {
      listEl.insertAdjacentHTML('afterbegin', html);
      const newFirstTs = newMatches[0].dep.orarioPartenza || newMatches[0].dep.orarioPartenzaZero;
      btnEl.disabled = false;
      btnEl.innerHTML = origHTML;
      btnEl.onclick = () => loadMoreRoute('prev', newFirstTs);
    } else {
      listEl.insertAdjacentHTML('beforeend', html);
      const newLastTs = newMatches[newMatches.length - 1].dep.orarioPartenza || newMatches[newMatches.length - 1].dep.orarioPartenzaZero;
      btnEl.disabled = false;
      btnEl.innerHTML = origHTML;
      btnEl.onclick = () => loadMoreRoute('next', newLastTs);
    }
    attachRouteCardCountdowns(listEl);
  } catch {
    btnEl.disabled = false;
    btnEl.innerHTML = origHTML;
    showToast('Errore nel caricamento');
  }
}

function renderRouteCard({ dep, arr }) {
  const cat      = (dep.categoriaDescrizione || dep.categoria || '').trim().toUpperCase() || 'REG';
  const [bg, tx] = getCatColors(cat);
  const numLabel = (dep.compNumeroTreno || String(dep.numeroTreno || '')).trim();

  const tDep = dep.orarioPartenza || dep.orarioPartenzaZero;
  const tArr = arr.orarioArrivo  || arr.orarioArrivoZero;
  const depTime = tDep ? formatTime(new Date(tDep)) : '--:--';
  const arrTime = tArr ? formatTime(new Date(tArr)) : '--:--';

  // Durata
  let durStr = '';
  if (tDep && tArr) {
    const mins = Math.round((tArr - tDep) / 60000);
    if (mins > 0) durStr = mins < 60 ? `${mins} min` : `${Math.floor(mins/60)}h ${mins%60}m`;
  }

  // Ritardo
  const ritardo = dep.ritardo || 0;
  let delayBadge = '';
  if      (ritardo > 5) delayBadge = `<span class="badge bg-danger ms-1">+${ritardo}'</span>`;
  else if (ritardo > 0) delayBadge = `<span class="badge bg-warning text-dark ms-1">+${ritardo}'</span>`;

  // Binario partenza (da dep)
  const binDep = dep.binarioEffettivoPartenzaDescrizione || dep.binarioProgrammatoPartenzaDescrizione;
  const binDepChanged = dep.binarioEffettivoPartenzaDescrizione && dep.binarioProgrammatoPartenzaDescrizione &&
                        dep.binarioEffettivoPartenzaDescrizione !== dep.binarioProgrammatoPartenzaDescrizione;
  // Binario arrivo (da arr)
  const binArr = arr.binarioEffettivoArrivoDescrizione || arr.binarioProgrammatoArrivoDescrizione;
  const binArrChanged = arr.binarioEffettivoArrivoDescrizione && arr.binarioProgrammatoArrivoDescrizione &&
                        arr.binarioEffettivoArrivoDescrizione !== arr.binarioProgrammatoArrivoDescrizione;

  const binDepHtml = binDep ? `
    <div class="d-flex align-items-center gap-1 mt-1">
      <small class="text-muted">Bin.</small>
      <span class="badge ${binDepChanged?'bg-warning text-dark':'bg-primary'} platform-num">${esc(binDep)}</span>
      ${binDepChanged ? `<small class="text-muted fst-italic">var.</small>` : ''}
    </div>` : '';
  const binArrHtml = binArr ? `
    <div class="d-flex align-items-center gap-1 mt-1">
      <small class="text-muted">Bin.</small>
      <span class="badge ${binArrChanged?'bg-warning text-dark':'bg-danger'} platform-num">${esc(binArr)}</span>
      ${binArrChanged ? `<small class="text-muted fst-italic">var.</small>` : ''}
    </div>` : '';

  // Provenienza/Direzione
  const fromLabel = dep.origine || '';
  const toLabel   = arr.destinazione || dep.destinazione || '';

  const trainLabel = `${cat} ${numLabel} → ${routeTo.name}`.trim();
  return `
  <div class="card border-0 shadow-sm mb-3 solution-card" data-dep-ts="${tDep || ''}" data-train-label="${esc(trainLabel)}">
    <div class="card-body p-3">
      <div class="d-flex align-items-center gap-2 mb-3 flex-wrap">
        <span class="badge ${bg} ${tx} fs-6 px-2 py-1">${esc(cat)}</span>
        <span class="fw-bold">${esc(numLabel)}</span>
        ${delayBadge}
        ${durStr ? `<span class="badge bg-light text-secondary border ms-auto">${esc(durStr)}</span>` : ''}
      </div>

      <div class="d-flex gap-3">
        <div class="d-flex flex-column align-items-center flex-shrink-0" style="padding-top:4px">
          <div class="sol-dot"></div>
          <div class="sol-line flex-grow-1 my-1"></div>
          <div class="sol-dot" style="background:#dc3545"></div>
        </div>
        <div class="flex-grow-1">
          <!-- partenza -->
          <div class="d-flex justify-content-between align-items-start mb-1">
            <div>
              <div class="fw-bold">${esc(routeFrom.name)}</div>
              ${fromLabel ? `<small class="text-muted">da ${esc(fromLabel)}</small>` : ''}
              ${binDepHtml}
            </div>
            <div class="fw-bold text-primary ms-3" style="font-size:1.4rem;line-height:1">${depTime}</div>
          </div>
          <hr class="my-2">
          <!-- arrivo -->
          <div class="d-flex justify-content-between align-items-start">
            <div>
              <div class="fw-bold">${esc(routeTo.name)}</div>
              ${toLabel ? `<small class="text-muted">dir. ${esc(toLabel)}</small>` : ''}
              ${binArrHtml}
            </div>
            <div class="fw-bold text-danger ms-3" style="font-size:1.4rem;line-height:1">${arrTime}</div>
          </div>
        </div>
      </div>
      <div class="countdown-panel d-none border-top mt-2 pt-2 pb-1 text-center">
        <small class="text-muted text-uppercase" style="font-size:.7rem;letter-spacing:.05em">Partenza tra</small>
        <div class="countdown-value fw-bold fs-3 text-success">--:--</div>
      </div>
    </div>
  </div>`;
}

/* ═══════════════════════════════════════════════
   INIT
═══════════════════════════════════════════════ */
adjustLayout();
window.addEventListener('resize', adjustLayout);
if (document.fonts) document.fonts.ready.then(adjustLayout);
renderFavorites();

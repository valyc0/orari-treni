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
async function getTrainDetails(codOrigine, numeroTreno, dataPartenzaTreno) {
  return apiJson(`/andamentoTreno/${codOrigine}/${numeroTreno}/${dataPartenzaTreno}`);
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

function resetThresholds() {
  notifThresholds = [
    { min: 10, enabled: true },
    { min: 5,  enabled: true },
    { min: 2,  enabled: true },
  ];
  localStorage.setItem('notif_thresholds', JSON.stringify(notifThresholds));
  renderImpostazioni();
  showToast('Soglie ripristinate ai valori default');
}

async function cancelAllNotifications() {
  if (!('serviceWorker' in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.ready;
    const notifications = await reg.getNotifications();
    notifications.forEach(n => n.close());
    showToast(`${notifications.length} notifiche annullate`);
  } catch (_) { showToast('Errore nell\'annullamento'); }
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

    // Deduplica le partenze per chiave completa (evita duplicati tra finestre orarie)
    const depMap = new Map();
    depResults.flat().forEach(t => {
      if (!t.numeroTreno) return;
      const key = String(t.numeroTreno) + '|' + (t.dataPartenzaTreno ?? '');
      if (!depMap.has(key)) depMap.set(key, t);
    });
    // Arrivi: mappa per solo numeroTreno – dataPartenzaTreno può differire tra /partenze e /arrivi
    const arrByNum = new Map();
    arrResults.flat().forEach(t => {
      if (!t.numeroTreno) return;
      const numKey = String(t.numeroTreno);
      if (!arrByNum.has(numKey)) arrByNum.set(numKey, t);
    });

    // Incrocia: un treno valido parte da A e arriva a B (orarioPartenza < orarioArrivo)
    const matches = [];
    depMap.forEach((dep) => {
      const arr = arrByNum.get(String(dep.numeroTreno));
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
      // Nessun treno diretto: prova con una coincidenza
      resEl.innerHTML = `
        <div class="d-flex flex-column align-items-center justify-content-center py-4 text-muted">
          <div class="spinner-border spinner-border-sm text-primary mb-2" role="status"></div>
          <small>Nessun treno diretto — cerco coincidenze…</small>
        </div>`;
      let connections = [];
      try {
        connections = await searchRouteWithConnections(date0);
      } catch (err) { console.error('searchRouteWithConnections error:', err); }
      if (!connections.length) {
        resEl.innerHTML = `
          <div class="text-center text-muted py-5">
            <i class="bi bi-map" style="font-size:3rem;opacity:.25"></i>
            <h6 class="mt-3 fw-semibold">Nessun treno trovato</h6>
            <p class="small mb-0">Prova a cambiare data o orario</p>
          </div>`;
        return;
      }
      resEl.innerHTML = `
        <div class="px-3 py-2">
          <small class="text-muted fw-semibold">
            ${esc(routeFrom.name)} → ${esc(routeTo.name)}
            &nbsp;•&nbsp; ${connections.length} soluzione${connections.length === 1 ? '' : 'i'} con coincidenza
          </small>
        </div>
        <div class="px-3 pb-3">${connections.map(renderConnectionCard).join('')}</div>`;
      attachRouteCardCountdowns(resEl);
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

    // pulsante allarme: stoppa propagazione e toglla lo stato
    const notifBtn = card.querySelector('.cd-notif-btn');
    if (notifBtn) {
      notifBtn.addEventListener('click', async e => {
        e.stopPropagation();
        const isActive = card.dataset.notifDisabled !== '1';
        if (isActive) {
          // disattiva
          card.dataset.notifDisabled = '1';
        } else {
          // attiva: richiedi permesso se necessario
          await requestNotifPermission();
          card.dataset.notifDisabled = '';
        }
        updateNotifBtn(card);
      });
    }

    // pulsante vedi tratta
    const trattaBtn = card.querySelector('.cd-tratta-btn');
    if (trattaBtn) {
      trattaBtn.addEventListener('click', e => {
        e.stopPropagation();
        openTrattaModal(card);
      });
    }

    card.addEventListener('click', () => {
      const isOpen = card.classList.contains('cd-open');
      document.querySelectorAll('.solution-card.cd-open').forEach(c => {
        c.classList.remove('cd-open');
        c.querySelector('.countdown-panel').classList.add('d-none');
        delete c.dataset.prevSec; // resetta soglie vibrazione alla chiusura
      });
      if (!isOpen) {
        // allarme disattivo di default all'apertura
        card.dataset.notifDisabled = '1';
        card.classList.add('cd-open');
        card.querySelector('.countdown-panel').classList.remove('d-none');
        updateNotifBtn(card);
        updateCountdownCard(card);
      }
    });
  });
}

function updateNotifBtn(card) {
  const btn = card.querySelector('.cd-notif-btn');
  if (!btn) return;
  const disabled = card.dataset.notifDisabled === '1';
  if (disabled) {
    btn.className = 'btn btn-sm btn-success cd-notif-btn';
    btn.innerHTML = '<i class="bi bi-bell me-1"></i>Attiva allarme';
  } else {
    btn.className = 'btn btn-sm btn-outline-danger cd-notif-btn';
    btn.innerHTML = '<i class="bi bi-bell-slash me-1"></i>Disattiva allarme';
  }
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
  if (card.dataset.notifDisabled !== '1') {
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
      if (!t.numeroTreno) return;
      const key = String(t.numeroTreno) + '|' + (t.dataPartenzaTreno ?? '');
      if (!depMap.has(key)) depMap.set(key, t);
    });
    // Arrivi: mappa per solo numeroTreno – dataPartenzaTreno può differire tra /partenze e /arrivi
    const arrByNum = new Map();
    arrResults.flat().forEach(t => {
      if (!t.numeroTreno) return;
      const numKey = String(t.numeroTreno);
      if (!arrByNum.has(numKey)) arrByNum.set(numKey, t);
    });

    const newMatches = [];
    depMap.forEach((dep, key) => {
      if (_shownRouteKeys.has(key)) return;
      const arr = arrByNum.get(String(dep.numeroTreno));
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
  const codOrigine = dep.codOrigine || '';
  const trainNum   = dep.numeroTreno || '';
  const trainDate  = dep.dataPartenzaTreno || '';
  return `
  <div class="card border-0 shadow-sm mb-3 solution-card"
       data-dep-ts="${tDep || ''}"
       data-train-label="${esc(trainLabel)}"
       data-train-num="${esc(String(trainNum))}"
       data-train-date="${esc(String(trainDate))}"
       data-cod-origine="${esc(codOrigine)}"
       data-route-from="${esc(routeFrom.name)}"
       data-route-to="${esc(routeTo.name)}">
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
        <div class="d-flex gap-2 justify-content-center mt-1">
          <button class="btn btn-sm btn-success cd-notif-btn">
            <i class="bi bi-bell me-1"></i>Attiva allarme
          </button>
          <button class="btn btn-sm btn-outline-primary cd-tratta-btn">
            <i class="bi bi-map me-1"></i>Vedi tratta
          </button>
        </div>
      </div>
    </div>
  </div>`;
}

/* ═══════════════════════════════════════════════
   TRATTA / ANDAMENTO TRENO
═══════════════════════════════════════════════ */
let _trattaModal        = null;
let _trattaCard         = null;
let _trattaInterval     = null;
let _trattaCountdown    = null;
const TRATTA_REFRESH_S  = 30;

function openTrattaModal(card) {
  _trattaCard = card;
  const label = card.dataset.trainLabel || 'Tratta';
  document.getElementById('trattaModalTitle').textContent = label;
  document.getElementById('trattaModalBody').innerHTML = `
    <div class="d-flex flex-column align-items-center justify-content-center py-5 text-muted">
      <div class="spinner-border text-primary" role="status"></div>
      <small class="mt-3">Caricamento tratta…</small>
    </div>`;

  if (!_trattaModal) {
    const modalEl = document.getElementById('trattaModal');
    _trattaModal = new bootstrap.Modal(modalEl);
    document.getElementById('trattaRefreshBtn').addEventListener('click', () => {
      if (_trattaCard) { _startTrattaAutoRefresh(); loadTratta(_trattaCard); }
    });
    modalEl.addEventListener('hidden.bs.modal', _stopTrattaAutoRefresh);
  }
  _trattaModal.show();
  _startTrattaAutoRefresh();
  loadTratta(card);
}

function _startTrattaAutoRefresh() {
  _stopTrattaAutoRefresh();
  let remaining = TRATTA_REFRESH_S;
  _updateTrattaCountdownBadge(remaining);
  _trattaCountdown = setInterval(() => {
    remaining--;
    _updateTrattaCountdownBadge(remaining);
    if (remaining <= 0) {
      remaining = TRATTA_REFRESH_S;
      if (_trattaCard) loadTratta(_trattaCard);
    }
  }, 1000);
}

function _stopTrattaAutoRefresh() {
  clearInterval(_trattaCountdown);
  clearInterval(_trattaInterval);
  _trattaCountdown = null;
  _trattaInterval  = null;
  _updateTrattaCountdownBadge(null);
}

function _updateTrattaCountdownBadge(sec) {
  const btn = document.getElementById('trattaRefreshBtn');
  if (!btn) return;
  btn.innerHTML = sec !== null
    ? `<i class="bi bi-arrow-clockwise"></i> <small>${sec}s</small>`
    : `<i class="bi bi-arrow-clockwise"></i>`;
}

async function loadTratta(card) {
  const trainNum   = card.dataset.trainNum;
  const trainDate  = card.dataset.trainDate;
  const codOrigine = card.dataset.codOrigine;
  const fromName   = card.dataset.routeFrom || '';
  const toName     = card.dataset.routeTo   || '';
  const depTs      = parseInt(card.dataset.depTs, 10) || 0;
  // Dati secondo treno (coincidenza)
  const trainNum2   = card.dataset.train2Num   || '';
  const trainDate2  = card.dataset.train2Date  || '';
  const codOrigine2 = card.dataset.codOrigine2 || '';
  const transferSt  = card.dataset.transferStation || '';
  const body       = document.getElementById('trattaModalBody');
  if (!trainNum) {
    body.innerHTML = `<p class="text-center text-muted py-4">Dati treno non disponibili</p>`;
    return;
  }

  // Spinner solo al primo caricamento (body vuoto), poi aggiorna silenziosamente
  const isFirstLoad = !body.querySelector('.d-flex:not(.spinner-border)') && !body.querySelector('.px-3');
  if (isFirstLoad) {
    body.innerHTML = `
      <div class="d-flex flex-column align-items-center justify-content-center py-5 text-muted">
        <div class="spinner-border text-primary" role="status"></div>
        <small class="mt-3">Caricamento tratta…</small>
      </div>`;
  }

  try {
    if (trainNum2 && codOrigine2 && trainDate2) {
      // Coincidenza: carica entrambi i treni in parallelo
      const [data1, data2] = await Promise.all([
        apiJson(`/andamentoTreno/${encodeURIComponent(codOrigine)}/${encodeURIComponent(trainNum)}/${encodeURIComponent(trainDate)}`),
        apiJson(`/andamentoTreno/${encodeURIComponent(codOrigine2)}/${encodeURIComponent(trainNum2)}/${encodeURIComponent(trainDate2)}`),
      ]);
      body.innerHTML = renderFermateWithConnection(data1, data2, fromName, transferSt, toName, depTs);
    } else {
      const path = `/andamentoTreno/${encodeURIComponent(codOrigine)}/${encodeURIComponent(trainNum)}/${encodeURIComponent(trainDate)}`;
      const data = await apiJson(path);
      body.innerHTML = renderFermate(data, fromName, toName, depTs);
    }
    // Ripristina il countdown senza resettare il timer
  } catch {
    body.innerHTML = `
      <div class="text-center text-muted py-4">
        <i class="bi bi-wifi-off" style="font-size:2.5rem;opacity:.25"></i>
        <p class="mt-2 small">Impossibile caricare la tratta</p>
      </div>`;
  }
}

function renderFermate(data, fromName, toName, depTs) {
  const fermate = data.fermate || [];
  if (!fermate.length) return `<p class="text-center text-muted py-4">Nessuna fermata disponibile</p>`;

  const ritardo = data.ritardo || 0;
  const ultimaStaz = data.stazioneUltimoRilevamento || '';
  const ultimaOra  = data.oraUltimoRilevamento
    ? formatTime(new Date(data.oraUltimoRilevamento)) : '';

  // Trova la fermata "corrente" (ultima passata)
  // 1) Fermate con dato reale dall'API (actualFermataType o orario reale)
  let lastPassedIdx = -1;
  fermate.forEach((f, i) => {
    if (f.actualFermataType === 1 || f.actualFermataType === 2 ||
        f.effettiva || f.arrivoReale || f.partenzaReale) {
      lastPassedIdx = i;
    }
  });
  // 2) Euristica temporale con ritardo: orario programmato + ritardo globale < ora attuale
  const now = Date.now();
  const delayMs = (ritardo || 0) * 60000;
  fermate.forEach((f, i) => {
    if (i <= lastPassedIdx) return;
    const oraProg = f.programmata || f.arrivo_teorico || f.partenza_teorica;
    if (oraProg && (oraProg + delayMs) < now) lastPassedIdx = i;
  });

  // Identifica indici fermata di partenza e arrivo itinerario (match case-insensitive)
  const norm = s => (s || '').trim().toLowerCase();
  const fromNorm = norm(fromName);
  const toNorm   = norm(toName);
  const fromIdx = fermate.findIndex(f => norm(f.stazione).includes(fromNorm) || fromNorm.includes(norm(f.stazione)));
  const toIdx   = fermate.findIndex(f => norm(f.stazione).includes(toNorm)   || toNorm.includes(norm(f.stazione)));

  // 3) Se la fermata di partenza itinerario è identificata e il suo orario previsto
  //    (depTs dalla card + ritardo) è già passato, segna tutto fino a lei come passato
  if (fromIdx >= 0 && depTs > 0 && (depTs + delayMs) < now) {
    lastPassedIdx = Math.max(lastPassedIdx, fromIdx);
  }

  let html = '';

  // Banner direzione: prima e ultima fermata dell'intero percorso
  if (fermate.length >= 2) {
    const capoInizio = fermate[0];
    const capoFine   = fermate[fermate.length - 1];
    const oraInizio  = capoInizio.partenza_teorica || capoInizio.programmata;
    const oraFine    = capoFine.arrivo_teorico || capoFine.programmata;
    html += `
      <div class="px-3 py-2 border-bottom" style="background:rgba(26,86,219,.04)">
        <div class="d-flex align-items-center gap-2">
          <i class="bi bi-train-front-fill text-primary" style="font-size:1.1rem"></i>
          <div class="flex-grow-1 min-w-0">
            <div class="d-flex align-items-center gap-1 flex-wrap" style="font-size:.8rem">
              <span class="fw-semibold text-truncate">${esc(capoInizio.stazione)}</span>
              ${oraInizio ? `<span class="text-muted">${formatTime(new Date(oraInizio))}</span>` : ''}
              <i class="bi bi-arrow-right text-muted mx-1"></i>
              <span class="fw-semibold text-truncate">${esc(capoFine.stazione)}</span>
              ${oraFine ? `<span class="text-muted">${formatTime(new Date(oraFine))}</span>` : ''}
            </div>
            <div class="text-muted" style="font-size:.72rem"><i class="bi bi-arrow-down me-1"></i>Orari crescenti dall'alto verso il basso</div>
          </div>
        </div>
      </div>`;
  }

  if (ultimaStaz || ritardo) {
    const ritBadge = ritardo > 5
      ? `<span class="badge bg-danger ms-2">+${ritardo} min</span>`
      : ritardo > 0
        ? `<span class="badge bg-warning text-dark ms-2">+${ritardo} min</span>`
        : `<span class="badge bg-success ms-2">Puntuale</span>`;
    html += `
      <div class="px-3 py-2 border-bottom d-flex align-items-center gap-2 flex-wrap">
        <i class="bi bi-geo-alt-fill text-primary"></i>
        <span class="small fw-semibold">${ultimaStaz ? esc(ultimaStaz) : '—'}</span>
        ${ultimaOra ? `<span class="text-muted small">${ultimaOra}</span>` : ''}
        ${ritBadge}
      </div>`;
  }

  html += '<div class="px-3 pt-2 pb-3">';
  fermate.forEach((f, i) => {
    const isPassed  = i < lastPassedIdx;
    const isCurrent = i === lastPassedIdx;

    const isFrom    = fromIdx >= 0 && i === fromIdx;
    const isTo      = toIdx   >= 0 && i === toIdx;
    const inRoute   = fromIdx >= 0 && toIdx >= 0 && i > fromIdx && i < toIdx;

    const oraProg = f.arrivo_teorico || f.programmata;
    const oraReal = f.effettiva || f.arrivoReale || f.partenzaReale;
    const oraStr  = oraProg ? formatTime(new Date(oraProg)) : '--:--';
    const oraRealStr = oraReal && oraReal !== oraProg ? formatTime(new Date(oraReal)) : null;

    const fRitardo = f.ritardo || 0;
    let ritBadge = '';
    if (isCurrent || isPassed) {
      if (fRitardo > 5)      ritBadge = `<span class="badge bg-danger ms-1">+${fRitardo}'</span>`;
      else if (fRitardo > 0) ritBadge = `<span class="badge bg-warning text-dark ms-1">+${fRitardo}'</span>`;
    }

    // Colore dot e linea
    let dotColor, lineColor, dotSize;
    if (isFrom) {
      dotColor = '#1a56db'; lineColor = '#1a56db'; dotSize = 14;
    } else if (isTo) {
      dotColor = '#dc3545'; lineColor = isPassed ? '#6c757d' : '#ced4da'; dotSize = 14;
    } else if (inRoute) {
      dotColor = isPassed ? '#6c757d' : '#1a56db';
      lineColor = isPassed ? '#6c757d' : '#1a56db';
      dotSize = 8;
    } else {
      dotColor = isPassed ? '#6c757d' : '#ced4da';
      lineColor = isPassed ? '#6c757d' : '#ced4da';
      dotSize = 8;
    }
    if (isCurrent) { dotColor = '#1a56db'; dotSize = 14; }

    // Stile nome fermata
    let nameCls, timeStyle;
    if (isFrom) {
      nameCls = 'fw-bold text-primary'; timeStyle = 'color:#1a56db;font-weight:700';
    } else if (isTo) {
      nameCls = 'fw-bold text-danger';  timeStyle = 'color:#dc3545;font-weight:700';
    } else if (inRoute) {
      nameCls = isPassed ? 'text-muted' : 'fw-semibold'; timeStyle = '';
    } else {
      nameCls = isPassed ? 'text-muted' : 'text-muted'; timeStyle = 'color:#9ca3af';
    }
    if (isCurrent) nameCls += ' text-primary';

    // Sfondo riga per fermate itinerario
    let rowBg = '';
    if (isFrom) rowBg = 'background:rgba(26,86,219,.06);border-radius:6px;padding:2px 4px;';
    else if (isTo) rowBg = 'background:rgba(220,53,69,.06);border-radius:6px;padding:2px 4px;';
    else if (inRoute) rowBg = 'background:rgba(26,86,219,.03);border-radius:4px;padding:1px 4px;';

    const isLast = i === fermate.length - 1;
    const dotOutline = isCurrent ? ';outline:3px solid rgba(26,86,219,.3)' : '';

    html += `
      <div class="d-flex gap-2 align-items-stretch" style="min-height:${isLast?'auto':'48px'}">
        <!-- timeline -->
        <div class="d-flex flex-column align-items-center flex-shrink-0" style="width:18px;padding-top:4px">
          <div style="width:${dotSize}px;height:${dotSize}px;border-radius:50%;background:${dotColor};flex-shrink:0${dotOutline}"></div>
          ${!isLast ? `<div style="width:3px;flex:1;background:${lineColor};border-radius:2px;margin-top:3px"></div>` : ''}
        </div>
        <!-- contenuto -->
        <div class="flex-grow-1 pb-2" style="${rowBg}">
          <div class="d-flex justify-content-between align-items-start">
            <span class="${nameCls}" style="font-size:.9rem">${esc(f.stazione || '')}</span>
            <span class="ms-2 flex-shrink-0" style="font-size:.9rem;${timeStyle}">${oraStr}${oraRealStr && oraRealStr !== oraStr ? ` <span class="text-muted" style="font-size:.75rem">(${oraRealStr})</span>` : ''}</span>
          </div>
          ${ritBadge}
          ${isCurrent ? `<div class="text-primary" style="font-size:.72rem;margin-top:1px"><i class="bi bi-train-front-fill me-1"></i>Qui ora</div>` : ''}
          ${i === 0 ? `<div class="text-secondary" style="font-size:.72rem"><i class="bi bi-flag-fill me-1"></i>Capolinea partenza</div>` : ''}
          ${i === fermate.length - 1 ? `<div class="text-secondary" style="font-size:.72rem"><i class="bi bi-flag-fill me-1"></i>Capolinea arrivo</div>` : ''}
          ${isFrom ? `<div class="text-primary" style="font-size:.72rem"><i class="bi bi-circle-fill me-1"></i>Partenza itinerario</div>` : ''}
          ${isTo   ? `<div class="text-danger"  style="font-size:.72rem"><i class="bi bi-geo-alt-fill me-1"></i>Arrivo itinerario</div>` : ''}
        </div>
      </div>`;
  });
  html += '</div>';
  return html;
}

function renderFermateWithConnection(data1, data2, fromName, transferName, toName, depTs) {
  // Renderizza le fermate di entrambi i treni con un separatore visivo di cambio
  const cat1 = (data1.categoria || '').trim().toUpperCase() || 'REG';
  const cat2 = (data2.categoria || '').trim().toUpperCase() || 'REG';
  const [bg1, tx1] = getCatColors(cat1);
  const [bg2, tx2] = getCatColors(cat2);
  const num1 = data1.numeroTreno || '';
  const num2 = data2.numeroTreno || '';

  // Taglia leg1: dalla stazione di partenza itinerario fino alla stazione di coincidenza (inclusa)
  const fermate1 = data1.fermate || [];
  const norm = s => (s || '').trim().toLowerCase();
  const fromNorm = norm(fromName);
  const transNorm = norm(transferName);
  const fromIdx1 = fermate1.findIndex(f => norm(f.stazione).includes(fromNorm) || fromNorm.includes(norm(f.stazione)));
  const transIdx1 = fermate1.findIndex(f => norm(f.stazione).includes(transNorm) || transNorm.includes(norm(f.stazione)));
  const slice1 = fermate1.slice(
    fromIdx1 >= 0 ? fromIdx1 : 0,
    transIdx1 >= 0 ? transIdx1 + 1 : fermate1.length
  );

  // Taglia leg2: dalla stazione di coincidenza fino alla stazione di arrivo itinerario (inclusa)
  const fermate2 = data2.fermate || [];
  const toNorm = norm(toName);
  const transIdx2 = fermate2.findIndex(f => norm(f.stazione).includes(transNorm) || transNorm.includes(norm(f.stazione)));
  const toIdx2 = fermate2.findIndex(f => norm(f.stazione).includes(toNorm) || toNorm.includes(norm(f.stazione)));
  const slice2 = fermate2.slice(
    transIdx2 >= 0 ? transIdx2 : 0,
    toIdx2 >= 0 ? toIdx2 + 1 : fermate2.length
  );

  const ritardo1 = data1.ritardo || 0;
  const ritardo2 = data2.ritardo || 0;
  const now = Date.now();
  const delayMs1 = ritardo1 * 60000;
  const delayMs2 = ritardo2 * 60000;

  // Calcola lastPassedIdx per ogni treno
  function calcLastPassed(fermate, delayMs) {
    let idx = -1;
    fermate.forEach((f, i) => {
      if (f.actualFermataType === 1 || f.actualFermataType === 2 || f.effettiva || f.arrivoReale || f.partenzaReale) idx = i;
    });
    fermate.forEach((f, i) => {
      if (i <= idx) return;
      const oraProg = f.programmata || f.arrivo_teorico || f.partenza_teorica;
      if (oraProg && (oraProg + delayMs) < now) idx = i;
    });
    return idx;
  }
  const lastPassed1 = calcLastPassed(slice1, delayMs1);
  const lastPassed2 = calcLastPassed(slice2, delayMs2);

  function renderLegStops(fermate, lastPassedIdx, startName, endName, isLast, delayMs) {
    const ritardo = Math.round(delayMs / 60000);
    let html = '';
    fermate.forEach((f, i) => {
      const isPassed  = i < lastPassedIdx;
      const isCurrent = i === lastPassedIdx;
      const isFirst   = i === 0;
      const isEnd     = i === fermate.length - 1;

      const normSt = norm(f.stazione);
      const normStart = norm(startName);
      const normEnd   = norm(endName);
      const isFrom = normSt.includes(normStart) || normStart.includes(normSt);
      const isTo   = normSt.includes(normEnd)   || normEnd.includes(normSt);
      const inRoute = !isFrom && !isTo;

      const oraProg = f.arrivo_teorico || f.programmata;
      const oraReal = f.effettiva || f.arrivoReale || f.partenzaReale;
      const oraStr  = oraProg ? formatTime(new Date(oraProg)) : '--:--';
      const oraRealStr = oraReal && oraReal !== oraProg ? formatTime(new Date(oraReal)) : null;

      const fRit = f.ritardo || ritardo || 0;
      let ritBadge = '';
      if ((isCurrent || isPassed) && fRit > 0) {
        ritBadge = fRit > 5
          ? `<span class="badge bg-danger ms-1">+${fRit}'</span>`
          : `<span class="badge bg-warning text-dark ms-1">+${fRit}'</span>`;
      }

      let dotColor, dotSize;
      if (isFrom || isTo) { dotColor = isFrom ? '#1a56db' : '#dc3545'; dotSize = 14; }
      else { dotColor = isPassed ? '#6c757d' : '#1a56db'; dotSize = 8; }
      if (isCurrent) { dotColor = '#1a56db'; dotSize = 14; }

      const lineColor = isPassed ? '#6c757d' : '#1a56db';
      const dotOutline = isCurrent ? ';outline:3px solid rgba(26,86,219,.3)' : '';

      let nameCls = isPassed ? 'text-muted' : (isFrom || isTo ? `fw-bold ${isFrom ? 'text-primary' : 'text-danger'}` : 'fw-semibold');
      if (isCurrent) nameCls = 'fw-bold text-primary';

      let rowBg = '';
      if (isFrom) rowBg = 'background:rgba(26,86,219,.06);border-radius:6px;padding:2px 4px;';
      else if (isTo) rowBg = 'background:rgba(220,53,69,.06);border-radius:6px;padding:2px 4px;';

      const showLine = !(isEnd && isLast);
      html += `
        <div class="d-flex gap-2 align-items-stretch" style="min-height:${showLine?'48px':'auto'}">
          <div class="d-flex flex-column align-items-center flex-shrink-0" style="width:18px;padding-top:4px">
            <div style="width:${dotSize}px;height:${dotSize}px;border-radius:50%;background:${dotColor};flex-shrink:0${dotOutline}"></div>
            ${showLine ? `<div style="width:3px;flex:1;background:${lineColor};border-radius:2px;margin-top:3px"></div>` : ''}
          </div>
          <div class="flex-grow-1 pb-2" style="${rowBg}">
            <div class="d-flex justify-content-between align-items-start">
              <span class="${nameCls}" style="font-size:.9rem">${esc(f.stazione || '')}</span>
              <span class="ms-2 flex-shrink-0" style="font-size:.9rem">${oraStr}${oraRealStr ? ` <span class="text-muted" style="font-size:.75rem">(${oraRealStr})</span>` : ''}</span>
            </div>
            ${(isFrom || isTo || isCurrent) ? (() => {
              const binEff  = isFrom ? (f.binarioEffettivoPartenzaDescrizione || f.binarioProgrammatoPartenzaDescrizione)
                                     : (f.binarioEffettivoArrivoDescrizione   || f.binarioProgrammatoArrivoDescrizione);
              const binProg = isFrom ? f.binarioProgrammatoPartenzaDescrizione : f.binarioProgrammatoArrivoDescrizione;
              const changed = binEff && binProg && binEff !== binProg;
              return binEff ? `<div class="d-flex align-items-center gap-1 mt-1">
                <small class="text-muted">Bin.</small>
                <span class="badge ${changed ? 'bg-warning text-dark' : (isFrom ? 'bg-primary' : 'bg-danger')} platform-num">${esc(binEff)}</span>
                ${changed ? `<small class="text-muted fst-italic">var. da ${esc(binProg)}</small>` : ''}
              </div>` : '';
            })() : ''}
            ${ritBadge}
            ${isCurrent ? `<div class="text-primary" style="font-size:.72rem"><i class="bi bi-train-front-fill me-1"></i>Qui ora</div>` : ''}
          </div>
        </div>`;
    });
    return html;
  }

  let html = '';

  // Intestazione treno 1
  html += `<div class="px-3 pt-2 pb-1 border-bottom" style="background:rgba(26,86,219,.04)">
    <div class="d-flex align-items-center gap-2">
      <span class="badge ${bg1} ${tx1}">${esc(cat1)}</span>
      <span class="fw-semibold small">${esc(String(num1))}</span>
      ${ritardo1 > 0 ? `<span class="badge bg-${ritardo1 > 5 ? 'danger' : 'warning'} ${ritardo1 > 5 ? '' : 'text-dark'} ms-auto">+${ritardo1} min</span>` : '<span class="badge bg-success ms-auto">Puntuale</span>'}
    </div>
  </div>`;
  html += `<div class="px-3 pt-2">${renderLegStops(slice1, lastPassed1, fromName, transferName, false, delayMs1)}</div>`;

  // Separatore cambio
  html += `
  <div class="mx-3 my-2 rounded-3 border border-warning d-flex align-items-center gap-2 px-3 py-2" style="background:#fffbeb">
    <i class="bi bi-arrow-repeat text-warning fs-5"></i>
    <div>
      <div class="fw-bold small">Cambio a ${esc(transferName)}</div>
      <div class="text-muted" style="font-size:.75rem">Prosegui con ${esc(cat2)} ${esc(String(num2))}</div>
    </div>
  </div>`;

  // Intestazione treno 2
  html += `<div class="px-3 pt-1 pb-1 border-bottom" style="background:rgba(26,86,219,.04)">
    <div class="d-flex align-items-center gap-2">
      <span class="badge ${bg2} ${tx2}">${esc(cat2)}</span>
      <span class="fw-semibold small">${esc(String(num2))}</span>
      ${ritardo2 > 0 ? `<span class="badge bg-${ritardo2 > 5 ? 'danger' : 'warning'} ${ritardo2 > 5 ? '' : 'text-dark'} ms-auto">+${ritardo2} min</span>` : '<span class="badge bg-success ms-auto">Puntuale</span>'}
    </div>
  </div>`;
  html += `<div class="px-3 pt-2 pb-3">${renderLegStops(slice2, lastPassed2, transferName, toName, true, delayMs2)}</div>`;

  return html;
}

/* ═══════════════════════════════════════════════
   RICERCA CON COINCIDENZE (andamentoTreno)
═══════════════════════════════════════════════ */
async function searchRouteWithConnections(date0) {
  const windows = [0, 60, 120].map(delta => {
    const d = new Date(date0.getTime() + delta * 60000);
    return viTimestamp(d);
  });

  const [depResults, arrResults] = await Promise.all([
    Promise.all(windows.map(ts => getDepartures(routeFrom.id, null, ts).catch(() => []))),
    Promise.all(windows.map(ts => getArrivals(routeTo.id, null, ts).catch(() => [])))
  ]);

  // Deduplica
  const depMap = new Map();
  depResults.flat().forEach(t => {
    if (!t.numeroTreno || !t.codOrigine || !t.dataPartenzaTreno) return;
    const key = String(t.numeroTreno);
    if (!depMap.has(key)) depMap.set(key, t);
  });
  const arrMap = new Map();
  arrResults.flat().forEach(t => {
    if (!t.numeroTreno || !t.codOrigine || !t.dataPartenzaTreno) return;
    const key = String(t.numeroTreno);
    if (!arrMap.has(key)) arrMap.set(key, t);
  });

  if (!depMap.size || !arrMap.size) return [];

  // Fetch andamentoTreno per tutti i treni in parallelo
  const [depDetails, arrDetails] = await Promise.all([
    Promise.all([...depMap.values()].map(t =>
      getTrainDetails(t.codOrigine, t.numeroTreno, t.dataPartenzaTreno)
        .then(d => ({ train: t, fermate: d.fermate || [] }))
        .catch(() => ({ train: t, fermate: [] }))
    )),
    Promise.all([...arrMap.values()].map(t =>
      getTrainDetails(t.codOrigine, t.numeroTreno, t.dataPartenzaTreno)
        .then(d => ({ train: t, fermate: d.fermate || [] }))
        .catch(() => ({ train: t, fermate: [] }))
    ))
  ]);

  // Mappa: stopId → [{ train, fermata, arrTime }] per fermate DOPO routeFrom
  const transferFromMap = new Map();
  for (const { train, fermate } of depDetails) {
    const fromIdx = fermate.findIndex(f => f.id === routeFrom.id);
    if (fromIdx < 0) continue;
    for (let i = fromIdx + 1; i < fermate.length; i++) {
      const f = fermate[i];
      if (!f.id) continue;
      const arrTime = f.effettivaArrivo || f.programmataArrivo || f.arrivo_teorico || f.programmata;
      if (!arrTime) continue;
      if (!transferFromMap.has(f.id)) transferFromMap.set(f.id, []);
      transferFromMap.get(f.id).push({ train, fermata: f, arrTime });
    }
  }

  const MIN_TRANSFER_MS = 5 * 60 * 1000;
  const connections = [];

  for (const { train: arrTrain, fermate } of arrDetails) {
    const toIdx = fermate.findIndex(f => f.id === routeTo.id);
    if (toIdx <= 0) continue;
    for (let i = 0; i < toIdx; i++) {
      const f = fermate[i];
      if (!f.id || !transferFromMap.has(f.id)) continue;
      const depTime = f.effettivaPartenza || f.programmataPartenza || f.partenza_teorica || f.programmata;
      if (!depTime) continue;

      const candidates = transferFromMap.get(f.id).filter(c =>
        c.arrTime + MIN_TRANSFER_MS <= depTime
      );
      for (const cand of candidates) {
        const depFromA = cand.train.orarioPartenza || cand.train.orarioPartenzaZero;
        const arrAtB   = arrTrain.orarioArrivo  || arrTrain.orarioArrivoZero;
        if (!depFromA || !arrAtB) continue;
        const key = `${cand.train.numeroTreno}→${arrTrain.numeroTreno}`;
        connections.push({
          key,
          leg1:     { train: cand.train, depTime: depFromA },
          transfer: {
            stationId:   f.id,
            stationName: f.stazione || cand.fermata.stazione,
            arrTime:     cand.arrTime,
            depTime:     depTime,
            waitMin:     Math.round((depTime - cand.arrTime) / 60000),
            binEff:  f.binarioEffettivoPartenzaDescrizione || f.binarioProgrammatoPartenzaDescrizione || null,
            binProg: f.binarioProgrammatoPartenzaDescrizione || null,
          },
          leg2:     { train: arrTrain, arrTime: arrAtB },
          totalMin: Math.round((arrAtB - depFromA) / 60000),
        });
      }
    }
  }

  // Ordina per orario di partenza, deduplicato per stessa coppia di treni
  connections.sort((a, b) => a.leg1.depTime - b.leg1.depTime);
  const seen = new Set();
  return connections.filter(c => {
    if (seen.has(c.key)) return false;
    seen.add(c.key);
    return true;
  });
}

function renderConnectionCard(c) {
  const { leg1, transfer, leg2, totalMin } = c;
  const cat1 = (leg1.train.categoriaDescrizione || leg1.train.categoria || '').trim().toUpperCase() || 'REG';
  const cat2 = (leg2.train.categoriaDescrizione || leg2.train.categoria || '').trim().toUpperCase() || 'REG';
  const [bg1, tx1] = getCatColors(cat1);
  const [bg2, tx2] = getCatColors(cat2);
  const num1 = (leg1.train.compNumeroTreno || String(leg1.train.numeroTreno || '')).trim();
  const num2 = (leg2.train.compNumeroTreno || String(leg2.train.numeroTreno || '')).trim();
  const depTime = formatTime(new Date(leg1.depTime));
  const arrTime = formatTime(new Date(leg2.arrTime));
  const transArr = formatTime(new Date(transfer.arrTime));
  const transDep = formatTime(new Date(transfer.depTime));
  const durStr = totalMin < 60 ? `${totalMin} min` : `${Math.floor(totalMin/60)}h ${totalMin%60}m`;
  const trainLabel = `${cat1} ${num1} + ${cat2} ${num2} → ${routeTo.name}`.trim();

  // Binario partenza leg1 (da /partenze)
  const binDep1 = leg1.train.binarioEffettivoPartenzaDescrizione || leg1.train.binarioProgrammatoPartenzaDescrizione;
  const binDep1Changed = leg1.train.binarioEffettivoPartenzaDescrizione && leg1.train.binarioProgrammatoPartenzaDescrizione &&
                         leg1.train.binarioEffettivoPartenzaDescrizione !== leg1.train.binarioProgrammatoPartenzaDescrizione;
  const binDep1Html = binDep1 ? `
    <div class="d-flex align-items-center gap-1 mt-1">
      <small class="text-muted">Bin.</small>
      <span class="badge ${binDep1Changed ? 'bg-warning text-dark' : 'bg-primary'} platform-num">${esc(binDep1)}</span>
      ${binDep1Changed ? `<small class="text-muted fst-italic">var.</small>` : ''}
    </div>` : '';

  // Binario arrivo leg2 (da /arrivi)
  const binArr2 = leg2.train.binarioEffettivoArrivoDescrizione || leg2.train.binarioProgrammatoArrivoDescrizione;
  const binArr2Changed = leg2.train.binarioEffettivoArrivoDescrizione && leg2.train.binarioProgrammatoArrivoDescrizione &&
                         leg2.train.binarioEffettivoArrivoDescrizione !== leg2.train.binarioProgrammatoArrivoDescrizione;
  const binArr2Html = binArr2 ? `
    <div class="d-flex align-items-center gap-1 mt-1">
      <small class="text-muted">Bin.</small>
      <span class="badge ${binArr2Changed ? 'bg-warning text-dark' : 'bg-danger'} platform-num">${esc(binArr2)}</span>
      ${binArr2Changed ? `<small class="text-muted fst-italic">var.</small>` : ''}
    </div>` : '';

  return `
  <div class="card border-0 shadow-sm mb-3 solution-card connection-card"
       data-dep-ts="${leg1.depTime || ''}"
       data-train-label="${esc(trainLabel)}"
       data-train-num="${esc(String(leg1.train.numeroTreno || ''))}"
       data-train-date="${esc(String(leg1.train.dataPartenzaTreno || ''))}"
       data-cod-origine="${esc(leg1.train.codOrigine || '')}"
       data-train2-num="${esc(String(leg2.train.numeroTreno || ''))}"
       data-train2-date="${esc(String(leg2.train.dataPartenzaTreno || ''))}"
       data-cod-origine2="${esc(leg2.train.codOrigine || '')}"
       data-transfer-station="${esc(transfer.stationName)}"
       data-route-from="${esc(routeFrom.name)}"
       data-route-to="${esc(routeTo.name)}">
    <div class="card-body p-3">
      <div class="d-flex align-items-center gap-2 mb-3 flex-wrap">
        <span class="badge bg-info text-white"><i class="bi bi-arrow-left-right me-1"></i>1 coincidenza</span>
        <span class="badge bg-light text-secondary border ms-auto">${esc(durStr)}</span>
      </div>
      <div class="d-flex gap-3">
        <div class="d-flex flex-column align-items-center flex-shrink-0" style="padding-top:4px">
          <div class="sol-dot"></div>
          <div class="sol-line flex-grow-1 my-1"></div>
          <div class="sol-dot" style="background:#6c757d;width:10px;height:10px"></div>
          <div class="sol-line flex-grow-1 my-1"></div>
          <div class="sol-dot" style="background:#dc3545"></div>
        </div>
        <div class="flex-grow-1">
          <!-- partenza -->
          <div class="d-flex justify-content-between align-items-start mb-1">
            <div>
              <div class="fw-bold">${esc(routeFrom.name)}</div>
              <div class="d-flex align-items-center gap-1 mt-1 flex-wrap">
                <span class="badge ${bg1} ${tx1}">${esc(cat1)}</span>
                <span class="text-muted small">${esc(num1)}</span>
              </div>
              ${binDep1Html}
            </div>
            <div class="fw-bold text-primary ms-3" style="font-size:1.4rem;line-height:1">${depTime}</div>
          </div>
          <hr class="my-2">
          <!-- coincidenza -->
          <div class="d-flex justify-content-between align-items-start mb-1">
            <div>
              <div class="fw-semibold text-secondary">${esc(transfer.stationName)}</div>
              <div class="d-flex gap-2 align-items-center mt-1 flex-wrap">
                <small class="text-muted">Arr. ${transArr} → Dep. ${transDep}</small>
                <span class="badge bg-light text-secondary border" style="font-size:.7rem">att. ${transfer.waitMin} min</span>
              </div>
              <div class="d-flex align-items-center gap-1 mt-1 flex-wrap">
                <span class="badge ${bg2} ${tx2}">${esc(cat2)}</span>
                <span class="text-muted small">${esc(num2)}</span>
                ${(() => {
                  if (!transfer.binEff) return '';
                  const changed = transfer.binProg && transfer.binEff !== transfer.binProg;
                  return `<span class="badge ${changed ? 'bg-warning text-dark' : 'bg-primary'} platform-num">Bin. ${esc(transfer.binEff)}</span>${changed ? `<small class="text-muted fst-italic">var. da ${esc(transfer.binProg)}</small>` : ''}`;
                })()}
              </div>
            </div>
          </div>
          <hr class="my-2">
          <!-- arrivo -->
          <div class="d-flex justify-content-between align-items-start">
            <div>
              <div class="fw-bold">${esc(routeTo.name)}</div>
              ${binArr2Html}
            </div>
            <div class="fw-bold text-danger ms-3" style="font-size:1.4rem;line-height:1">${arrTime}</div>
          </div>
        </div>
      </div>
      <div class="countdown-panel d-none border-top mt-2 pt-2 pb-1 text-center">
        <small class="text-muted text-uppercase" style="font-size:.7rem;letter-spacing:.05em">Partenza tra</small>
        <div class="countdown-value fw-bold fs-3 text-success">--:--</div>
        <div class="d-flex gap-2 justify-content-center mt-1">
          <button class="btn btn-sm btn-success cd-notif-btn">
            <i class="bi bi-bell me-1"></i>Attiva allarme
          </button>
          <button class="btn btn-sm btn-outline-primary cd-tratta-btn">
            <i class="bi bi-map me-1"></i>Vedi tratta
          </button>
        </div>
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

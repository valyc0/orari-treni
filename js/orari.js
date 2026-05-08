'use strict';

/* ═══════════════════════════════════════════════
   ORARI – pagina orari partenze/arrivi stazione
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

/* ── HTML fragments ── */

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
        <i class="bi bi-star${isFav ? '-fill' : ''}"></i>
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
        <button class="nav-link w-100 rounded-0 py-3 ${activeTab === 'partenze' ? 'active' : 'border-0'}" data-tab="partenze">
          <i class="bi bi-arrow-up-right-circle${activeTab === 'partenze' ? '-fill' : ''} me-1"></i>Partenze
        </button>
      </li>
      <li class="nav-item flex-fill text-center">
        <button class="nav-link w-100 rounded-0 py-3 ${activeTab === 'arrivi' ? 'active' : 'border-0'}" data-tab="arrivi">
          <i class="bi bi-arrow-down-left-circle${activeTab === 'arrivi' ? '-fill' : ''} me-1"></i>Arrivi
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
        <input class="form-check-input" type="checkbox" id="autoRefreshToggle" role="switch" ${autoRefresh ? 'checked' : ''}>
      </div>
    </div>
  </div>`;
}

/* ── fetch & render ── */

async function fetchAndRenderTrains(silent = false) {
  const listEl = document.getElementById('trainsList');
  if (!listEl || !station) return;
  if (!silent) listEl.innerHTML = renderLoading();

  const ico    = document.getElementById('refreshIco');
  const btnRef = document.getElementById('btnRefresh');
  if (ico)    ico.classList.add('spin');
  if (btnRef) btnRef.disabled = true;

  try {
    const d      = chosenDate || new Date();
    const trains = activeTab === 'partenze'
      ? await getDepartures(station.id, d)
      : await getArrivals(station.id, d);

    _shownTrainsKeys = new Set();
    const tsKey   = activeTab === 'partenze' ? 'orarioPartenza' : 'orarioArrivo';
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

    const nowStr = formatTime(new Date());
    const lbl = document.getElementById('lastUpdateLabel');
    if (lbl) lbl.textContent = 'Aggiornato: ' + nowStr;
    const lu = document.getElementById('lastUpdate');
    if (lu)  lu.textContent  = 'Aggiornato: ' + nowStr;
  } catch {
    listEl.innerHTML = renderEmptyState('wifi-off', 'Errore di caricamento', 'Verifica la connessione e riprova');
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

    const tsKey     = activeTab === 'partenze' ? 'orarioPartenza' : 'orarioArrivo';
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

/* ── card rendering ── */

function renderTrainsList(trains) {
  if (!trains || !trains.length) {
    return renderEmptyState('calendar-x', 'Nessun treno trovato', 'Prova a cambiare orario o data');
  }
  return `<div class="px-3 pt-3 pb-2">${trains.map(renderTrainCard).join('')}</div>`;
}

function renderTrainCard(t) {
  const isDep = activeTab === 'partenze';

  const timeMs  = isDep ? t.orarioPartenza : t.orarioArrivo;
  const timeStr = timeMs
    ? formatTime(new Date(timeMs))
    : (isDep ? t.compOrarioPartenza : t.compOrarioArrivo) || '--:--';
  const timeLabel = isDep ? 'Partenza' : 'Arrivo';
  const dest      = isDep ? (t.destinazione || '—') : (t.origine || '—');

  const platEff    = isDep ? t.binarioEffettivoPartenzaDescrizione : t.binarioEffettivoArrivoDescrizione;
  const platProg   = isDep ? t.binarioProgrammatoPartenzaDescrizione : t.binarioProgrammatoArrivoDescrizione;
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
        <span class="badge ${platChanged ? 'bg-warning text-dark' : 'bg-primary'} platform-num">${esc(platShow)}</span>
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
          <span class="text-muted small fw-semibold">${esc((t.compNumeroTreno || String(t.numeroTreno || '')).trim())}</span>
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

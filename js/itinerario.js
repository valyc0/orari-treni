'use strict';

/* ═══════════════════════════════════════════════
   ITINERARIO – pagina ricerca treni da A a B
═══════════════════════════════════════════════ */

function initItinerario() {
  if (_itinerarioInited) return;
  _itinerarioInited = true;

  // Imposta data e ora al momento attuale
  const now = new Date();
  const p   = n => String(n).padStart(2, '0');
  document.getElementById('routeDate').value = toLocalIso(now).slice(0, 10);
  document.getElementById('routeTime').value = `${p(now.getHours())}:${p(now.getMinutes())}`;

  setupTimeChips('routeDate', 'routeTime', '.route-time-btn', searchRoute, '.route-date-btn');

  // Autocomplete Da / A
  setupRouteAc(
    document.getElementById('routeFrom'),
    document.getElementById('acFromList'),
    document.getElementById('acFrom'),
    document.getElementById('clearFrom'),
    s => { routeFrom = s; }
  );
  setupRouteAc(
    document.getElementById('routeTo'),
    document.getElementById('acToList'),
    document.getElementById('acTo'),
    document.getElementById('clearTo'),
    s => { routeTo = s; }
  );

  // Scambia partenza e arrivo
  document.getElementById('btnSwap').addEventListener('click', () => {
    const tmpSt  = routeFrom; routeFrom = routeTo; routeTo = tmpSt;
    const fromEl = document.getElementById('routeFrom');
    const toEl   = document.getElementById('routeTo');
    const tmpVal = fromEl.value; fromEl.value = toEl.value; toEl.value = tmpVal;
  });

  document.getElementById('btnSearchRoute').addEventListener('click', searchRoute);
  document.getElementById('btnSaveRoute').addEventListener('click', toggleRouteFavorite);

  setupDateBtns('routeDate', 'routeTime', '.route-date-btn', searchRoute, '.route-time-btn');
}

/** Configura l'autocomplete per un campo stazione nell'itinerario. */
function setupRouteAc(input, listEl, dropEl, clearBtn, onSelect) {
  let timer = null;

  function closeRouteDropdown() {
    dropEl.classList.remove('show');
    listEl.innerHTML = '';
  }

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
        listEl.innerHTML = list.slice(0, 8).map(renderAcItem).join('');
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
    if (!e.target.closest(`#${input.closest('.route-input-wrap').id}`)) closeRouteDropdown();
  });
}

/* ── Ricerca principale ── */

async function searchRoute() {
  if (!routeFrom || !routeTo) {
    showToast('Inserisci stazione di partenza e arrivo');
    return;
  }
  if (_countdownInterval) { clearInterval(_countdownInterval); _countdownInterval = null; }

  // Aggiorna icona bottone salva
  const routeKey = `${routeFrom.id}→${routeTo.id}`;
  const isSaved  = favorites.some(f => f.type === 'route' && f.routeKey === routeKey);
  const btnS = document.getElementById('btnSaveRoute');
  if (btnS) btnS.innerHTML = `<i class="bi bi-star${isSaved ? '-fill' : ''}"></i>`;

  const dateStr = document.getElementById('routeDate').value;
  const timeStr = document.getElementById('routeTime').value;
  const date0   = dateStr ? new Date(`${dateStr}T${timeStr || '00:00'}`) : new Date();

  const resEl = document.getElementById('routeResults');
  resEl.innerHTML = `
    <div class="d-flex flex-column align-items-center justify-content-center py-5 text-muted">
      <div class="spinner-border text-primary" role="status" style="width:2.5rem;height:2.5rem"></div>
      <small class="mt-3">Ricerca treni…</small>
    </div>`;

  try {
    const windows     = buildTimeWindows(date0);
    const arrWindows  = buildArrivalWindows(date0);

    const [depResults, arrResults] = await Promise.all([
      Promise.all(windows.map(ts    => getDepartures(routeFrom.id, null, ts).catch(() => []))),
      Promise.all(arrWindows.map(ts => getArrivals(routeTo.id, null, ts).catch(() => []))),
    ]);

    // Deduplica partenze per chiave completa
    const depMap = new Map();
    depResults.flat().forEach(t => {
      if (!t.numeroTreno) return;
      const key = String(t.numeroTreno) + '|' + (t.dataPartenzaTreno ?? '');
      if (!depMap.has(key)) depMap.set(key, t);
    });
    // Arrivi: mappa per solo numeroTreno (dataPartenzaTreno può differire tra /partenze e /arrivi)
    const arrByNum = new Map();
    arrResults.flat().forEach(t => {
      if (!t.numeroTreno) return;
      if (!arrByNum.has(String(t.numeroTreno))) arrByNum.set(String(t.numeroTreno), t);
    });

    // Incrocia: treno valido parte da A e arriva a B con orarioPartenza < orarioArrivo
    const matches = [];
    depMap.forEach(dep => {
      const arr  = arrByNum.get(String(dep.numeroTreno));
      if (!arr) return;
      const tDep = dep.orarioPartenza || dep.orarioPartenzaZero;
      const tArr = arr.orarioArrivo   || arr.orarioArrivoZero;
      if (tDep && tArr && tDep < tArr) matches.push({ dep, arr });
    });
    matches.sort((a, b) =>
      (a.dep.orarioPartenza || a.dep.orarioPartenzaZero) -
      (b.dep.orarioPartenza || b.dep.orarioPartenzaZero)
    );

    if (!matches.length) {
      // Nessun treno diretto: prova con coincidenza
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
        // Fallback AI: nessuna coincidenza trovata, chiediamo all'AI le stazioni intermedie
        resEl.innerHTML = `
          <div class="d-flex flex-column align-items-center justify-content-center py-4 text-muted">
            <div class="spinner-border spinner-border-sm text-secondary mb-2" role="status"></div>
            <small><i class="bi bi-robot me-1"></i>Nessuna coincidenza trovata — chiedo all'AI…</small>
          </div>`;
        try {
          connections = await searchRouteAIGuided(date0);
        } catch (err) { console.error('searchRouteAIGuided error:', err); }
      }

      if (!connections.length) {
        resEl.innerHTML = renderEmptyState('map', 'Nessun treno trovato', 'Prova a cambiare data o orario');
        return;
      }

      const has2hop  = connections.some(c => c.type === '2hop');
      const coinLabel = has2hop ? '2 coincidenze <span class="badge bg-secondary ms-1">AI</span>'
                                : 'coincidenza';
      resEl.innerHTML = `
        <div class="px-3 py-2">
          <small class="text-muted fw-semibold">
            ${esc(routeFrom.name)} → ${esc(routeTo.name)}
            &nbsp;•&nbsp; ${connections.length} soluzione${connections.length === 1 ? '' : 'i'} con ${coinLabel}
          </small>
        </div>
        <div class="px-3 pb-3">${connections.map(c => c.type === '2hop' ? renderConnection2Card(c) : renderConnectionCard(c)).join('')}</div>`;
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
  } catch {
    resEl.innerHTML = renderEmptyState('wifi-off', 'Errore di caricamento', 'Verifica la connessione e riprova');
    showToast('Impossibile caricare i treni');
  }
}

/* ── Carica più treni (precedenti / successivi) ── */

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

    const windows    = buildTimeWindows(baseDate);
    const arrWindows = buildArrivalWindows(baseDate);

    const [depResults, arrResults] = await Promise.all([
      Promise.all(windows.map(ts    => getDepartures(routeFrom.id, null, ts).catch(() => []))),
      Promise.all(arrWindows.map(ts => getArrivals(routeTo.id, null, ts).catch(() => []))),
    ]);

    const depMap = new Map();
    depResults.flat().forEach(t => {
      if (!t.numeroTreno) return;
      const key = String(t.numeroTreno) + '|' + (t.dataPartenzaTreno ?? '');
      if (!depMap.has(key)) depMap.set(key, t);
    });
    const arrByNum = new Map();
    arrResults.flat().forEach(t => {
      if (!t.numeroTreno) return;
      if (!arrByNum.has(String(t.numeroTreno))) arrByNum.set(String(t.numeroTreno), t);
    });

    const newMatches = [];
    depMap.forEach((dep, key) => {
      if (_shownRouteKeys.has(key)) return;
      const arr  = arrByNum.get(String(dep.numeroTreno));
      if (!arr) return;
      const tDep = dep.orarioPartenza || dep.orarioPartenzaZero;
      const tArr = arr.orarioArrivo   || arr.orarioArrivoZero;
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
      btnEl.disabled = false; btnEl.innerHTML = origHTML;
      btnEl.onclick = () => loadMoreRoute('prev', newFirstTs);
    } else {
      listEl.insertAdjacentHTML('beforeend', html);
      const newLastTs = newMatches[newMatches.length - 1].dep.orarioPartenza || newMatches[newMatches.length - 1].dep.orarioPartenzaZero;
      btnEl.disabled = false; btnEl.innerHTML = origHTML;
      btnEl.onclick = () => loadMoreRoute('next', newLastTs);
    }
    attachRouteCardCountdowns(listEl);
  } catch {
    btnEl.disabled = false;
    btnEl.innerHTML = origHTML;
    showToast('Errore nel caricamento');
  }
}

/* ── Card treno diretto ── */

function renderRouteCard({ dep, arr }) {
  const cat      = (dep.categoriaDescrizione || dep.categoria || '').trim().toUpperCase() || 'REG';
  const [bg, tx] = getCatColors(cat);
  const numLabel = (dep.compNumeroTreno || String(dep.numeroTreno || '')).trim();

  const tDep    = dep.orarioPartenza || dep.orarioPartenzaZero;
  const tArr    = arr.orarioArrivo   || arr.orarioArrivoZero;
  const depTime = tDep ? formatTime(new Date(tDep)) : '--:--';
  const arrTime = tArr ? formatTime(new Date(tArr)) : '--:--';

  let durStr = '';
  if (tDep && tArr) {
    const mins = Math.round((tArr - tDep) / 60000);
    if (mins > 0) durStr = mins < 60 ? `${mins} min` : `${Math.floor(mins / 60)}h ${mins % 60}m`;
  }

  const ritardo = dep.ritardo || 0;
  let delayBadge = '';
  if      (ritardo > 5) delayBadge = `<span class="badge bg-danger ms-1">+${ritardo}'</span>`;
  else if (ritardo > 0) delayBadge = `<span class="badge bg-warning text-dark ms-1">+${ritardo}'</span>`;

  // Binario partenza
  const binDep        = dep.binarioEffettivoPartenzaDescrizione || dep.binarioProgrammatoPartenzaDescrizione;
  const binDepChanged = dep.binarioEffettivoPartenzaDescrizione && dep.binarioProgrammatoPartenzaDescrizione &&
                        dep.binarioEffettivoPartenzaDescrizione !== dep.binarioProgrammatoPartenzaDescrizione;
  const binDepHtml = binDep ? `
    <div class="d-flex align-items-center gap-1 mt-1">
      <small class="text-muted">Bin.</small>
      <span class="badge ${binDepChanged ? 'bg-warning text-dark' : 'bg-primary'} platform-num">${esc(binDep)}</span>
      ${binDepChanged ? `<small class="text-muted fst-italic">var.</small>` : ''}
    </div>` : '';

  // Binario arrivo
  const binArr        = arr.binarioEffettivoArrivoDescrizione || arr.binarioProgrammatoArrivoDescrizione;
  const binArrChanged = arr.binarioEffettivoArrivoDescrizione && arr.binarioProgrammatoArrivoDescrizione &&
                        arr.binarioEffettivoArrivoDescrizione !== arr.binarioProgrammatoArrivoDescrizione;
  const binArrHtml = binArr ? `
    <div class="d-flex align-items-center gap-1 mt-1">
      <small class="text-muted">Bin.</small>
      <span class="badge ${binArrChanged ? 'bg-warning text-dark' : 'bg-danger'} platform-num">${esc(binArr)}</span>
      ${binArrChanged ? `<small class="text-muted fst-italic">var.</small>` : ''}
    </div>` : '';

  const fromLabel  = dep.origine || '';
  const toLabel    = arr.destinazione || dep.destinazione || '';
  const trainLabel = `${cat} ${numLabel} → ${routeTo.name}`.trim();
  const codOrigine = dep.codOrigine || '';
  const trainNum   = dep.numeroTreno || '';
  const trainDate  = dep.dataPartenzaTreno || '';
  const isPast     = tDep && tDep < Date.now();

  return `
  <div class="card border-0 shadow-sm mb-3 solution-card${isPast ? ' opacity-50' : ''}"
       style="${isPast ? 'filter:grayscale(.75)' : ''}"
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
            <div class="text-end ms-3 flex-shrink-0">
              <div class="fw-bold text-primary" style="font-size:1.4rem;line-height:1">${depTime}</div>
              ${isPast ? `<small class="text-muted fst-italic" style="font-size:.72rem">Partito</small>` : ''}
            </div>
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

/* ── Countdown e notifiche sulle card ── */

function attachRouteCardCountdowns(container) {
  if (_countdownInterval) clearInterval(_countdownInterval);
  _countdownInterval = setInterval(() => {
    document.querySelectorAll('.solution-card.cd-open').forEach(updateCountdownCard);
  }, 1000);

  container.querySelectorAll('.solution-card:not([data-cd-ready])').forEach(card => {
    card.dataset.cdReady = '1';
    card.style.cursor    = 'pointer';

    const notifBtn = card.querySelector('.cd-notif-btn');
    if (notifBtn) {
      notifBtn.addEventListener('click', async e => {
        e.stopPropagation();
        const isActive = card.dataset.notifDisabled !== '1';
        if (isActive) {
          card.dataset.notifDisabled = '1';
        } else {
          await requestNotifPermission();
          card.dataset.notifDisabled = '';
        }
        updateNotifBtn(card);
      });
    }

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
        delete c.dataset.prevSec;
      });
      if (!isOpen) {
        card.dataset.notifDisabled = '1'; // allarme disattivo di default all'apertura
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
  const el    = card.querySelector('.countdown-value');
  if (!el || isNaN(depTs)) return;

  const diff = depTs - Date.now();
  if (diff <= 0) {
    el.textContent = 'Partito';
    el.className   = 'countdown-value fw-bold text-danger';
    return;
  }

  const totalSec = Math.floor(diff / 1000);

  // Notifica + vibrazione al superamento delle soglie configurate
  const prevSec = parseInt(card.dataset.prevSec || '99999', 10);
  if (card.dataset.notifDisabled !== '1') {
    const trainLabel = card.dataset.trainLabel || 'Treno';
    const enabledThresholds = notifThresholds
      .filter(t => t.enabled && t.min > 0)
      .sort((a, b) => b.min - a.min);
    for (let i = 0; i < enabledThresholds.length; i++) {
      const sec      = enabledThresholds[i].min * 60;
      const minLabel = enabledThresholds[i].min;
      if (prevSec >= sec && totalSec < sec) {
        const vib  = getVibrationPattern(i);
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
  el.className   = 'countdown-value fw-bold fs-3 ' +
    (totalSec < 300 ? 'text-danger' : totalSec < 900 ? 'text-warning' : 'text-success');
}

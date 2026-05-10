'use strict';

/* ═══════════════════════════════════════════════
   TRATTA – modal andamento treno con auto-refresh
═══════════════════════════════════════════════ */

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
  const trainNum    = card.dataset.trainNum;
  const trainDate   = card.dataset.trainDate;
  const codOrigine  = card.dataset.codOrigine;
  const fromName    = card.dataset.routeFrom || '';
  const toName      = card.dataset.routeTo   || '';
  const depTs       = parseInt(card.dataset.depTs, 10) || 0;
  // Dati secondo treno (coincidenza)
  const trainNum2   = card.dataset.train2Num   || '';
  const trainDate2  = card.dataset.train2Date  || '';
  const codOrigine2 = card.dataset.codOrigine2 || '';
  const transferSt  = card.dataset.transferStation  || '';
  // Dati terzo treno (2 coincidenze AI)
  const trainNum3   = card.dataset.train3Num   || '';
  const trainDate3  = card.dataset.train3Date  || '';
  const codOrigine3 = card.dataset.codOrigine3 || '';
  const transferSt2 = card.dataset.transfer2Station || '';

  const body = document.getElementById('trattaModalBody');
  if (!trainNum) {
    body.innerHTML = `<p class="text-center text-muted py-4">Dati treno non disponibili</p>`;
    return;
  }

  // Spinner solo al primo caricamento, poi aggiornamento silenzioso
  const isFirstLoad = !body.querySelector('.d-flex:not(.spinner-border)') && !body.querySelector('.px-3');
  if (isFirstLoad) {
    body.innerHTML = `
      <div class="d-flex flex-column align-items-center justify-content-center py-5 text-muted">
        <div class="spinner-border text-primary" role="status"></div>
        <small class="mt-3">Caricamento tratta…</small>
      </div>`;
  }

  try {
    if (trainNum2 && codOrigine2 && trainDate2 && trainNum3 && codOrigine3 && trainDate3) {
      // 2 coincidenze (AI): carica tutti e 3 i treni in parallelo
      const [data1, data2, data3] = await Promise.all([
        apiJson(`/andamentoTreno/${encodeURIComponent(codOrigine)}/${encodeURIComponent(trainNum)}/${encodeURIComponent(trainDate)}`),
        apiJson(`/andamentoTreno/${encodeURIComponent(codOrigine2)}/${encodeURIComponent(trainNum2)}/${encodeURIComponent(trainDate2)}`),
        apiJson(`/andamentoTreno/${encodeURIComponent(codOrigine3)}/${encodeURIComponent(trainNum3)}/${encodeURIComponent(trainDate3)}`),
      ]);
      body.innerHTML = renderFermateWith2Connections(data1, data2, data3, fromName, transferSt, transferSt2, toName, depTs);
    } else if (trainNum2 && codOrigine2 && trainDate2) {
      // 1 coincidenza: carica entrambi i treni in parallelo
      const [data1, data2] = await Promise.all([
        apiJson(`/andamentoTreno/${encodeURIComponent(codOrigine)}/${encodeURIComponent(trainNum)}/${encodeURIComponent(trainDate)}`),
        apiJson(`/andamentoTreno/${encodeURIComponent(codOrigine2)}/${encodeURIComponent(trainNum2)}/${encodeURIComponent(trainDate2)}`),
      ]);
      body.innerHTML = renderFermateWithConnection(data1, data2, fromName, transferSt, toName, depTs);
    } else {
      const data = await apiJson(
        `/andamentoTreno/${encodeURIComponent(codOrigine)}/${encodeURIComponent(trainNum)}/${encodeURIComponent(trainDate)}`
      );
      body.innerHTML = renderFermate(data, fromName, toName, depTs);
    }
  } catch {
    body.innerHTML = `
      <div class="text-center text-muted py-4">
        <i class="bi bi-wifi-off" style="font-size:2.5rem;opacity:.25"></i>
        <p class="mt-2 small">Impossibile caricare la tratta</p>
      </div>`;
  }
}

/* ── renderFermate (treno diretto) ── */

function renderFermate(data, fromName, toName, depTs) {
  if (!data) return `<p class="text-center text-muted py-4">Nessuna fermata disponibile</p>`;
  const fermate = data.fermate || [];
  if (!fermate.length) return `<p class="text-center text-muted py-4">Nessuna fermata disponibile</p>`;

  const ritardo    = data.ritardo || 0;
  const ultimaStaz = data.stazioneUltimoRilevamento || '';
  const ultimaOra  = data.oraUltimoRilevamento
    ? formatTime(new Date(data.oraUltimoRilevamento)) : '';

  // Trova l'ultima fermata già passata tramite dato reale dell'API
  let lastPassedIdx = -1;
  fermate.forEach((f, i) => {
    if (f.actualFermataType === 1 || f.actualFermataType === 2 ||
        f.effettiva || f.arrivoReale || f.partenzaReale) {
      lastPassedIdx = i;
    }
  });
  // Fallback euristico: orario programmato + ritardo < ora attuale
  const now     = Date.now();
  const delayMs = (ritardo || 0) * 60000;
  fermate.forEach((f, i) => {
    if (i <= lastPassedIdx) return;
    const oraProg = f.programmata || f.arrivo_teorico || f.partenza_teorica;
    if (oraProg && (oraProg + delayMs) < now) lastPassedIdx = i;
  });

  const norm     = s => (s || '').trim().toLowerCase();
  const fromNorm = norm(fromName);
  const toNorm   = norm(toName);
  const fromIdx  = fermate.findIndex(f => norm(f.stazione).includes(fromNorm) || fromNorm.includes(norm(f.stazione)));
  const toIdx    = fermate.findIndex(f => norm(f.stazione).includes(toNorm)   || toNorm.includes(norm(f.stazione)));

  // Se la fermata di partenza itinerario è già passata, aggiorna lastPassedIdx
  if (fromIdx >= 0 && depTs > 0 && (depTs + delayMs) < now) {
    lastPassedIdx = Math.max(lastPassedIdx, fromIdx);
  }

  let html = '';

  // Banner direzione (capolinea inizio → capolinea fine)
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

    const oraProg    = f.arrivo_teorico || f.programmata;
    const oraReal    = f.effettiva || f.arrivoReale || f.partenzaReale;
    const oraStr     = oraProg ? formatTime(new Date(oraProg)) : '--:--';
    const oraRealStr = oraReal && oraReal !== oraProg ? formatTime(new Date(oraReal)) : null;

    const fRitardo = f.ritardo || 0;
    let ritBadge = '';
    if (isCurrent || isPassed) {
      if      (fRitardo > 5) ritBadge = `<span class="badge bg-danger ms-1">+${fRitardo}'</span>`;
      else if (fRitardo > 0) ritBadge = `<span class="badge bg-warning text-dark ms-1">+${fRitardo}'</span>`;
    }

    let dotColor, lineColor, dotSize;
    if (isFrom)       { dotColor = '#1a56db'; lineColor = '#1a56db'; dotSize = 14; }
    else if (isTo)    { dotColor = '#dc3545'; lineColor = isPassed ? '#6c757d' : '#ced4da'; dotSize = 14; }
    else if (inRoute) { dotColor = isPassed ? '#6c757d' : '#1a56db'; lineColor = isPassed ? '#6c757d' : '#1a56db'; dotSize = 8; }
    else              { dotColor = isPassed ? '#6c757d' : '#ced4da'; lineColor = isPassed ? '#6c757d' : '#ced4da'; dotSize = 8; }
    if (isCurrent) { dotColor = '#1a56db'; dotSize = 14; }

    let nameCls, timeStyle;
    if      (isFrom)   { nameCls = 'fw-bold text-primary'; timeStyle = 'color:#1a56db;font-weight:700'; }
    else if (isTo)     { nameCls = 'fw-bold text-danger';  timeStyle = 'color:#dc3545;font-weight:700'; }
    else if (inRoute)  { nameCls = isPassed ? 'text-muted' : 'fw-semibold'; timeStyle = ''; }
    else               { nameCls = 'text-muted'; timeStyle = 'color:#9ca3af'; }
    if (isCurrent) nameCls += ' text-primary';

    let rowBg = '';
    if      (isFrom)   rowBg = 'background:rgba(26,86,219,.06);border-radius:6px;padding:2px 4px;';
    else if (isTo)     rowBg = 'background:rgba(220,53,69,.06);border-radius:6px;padding:2px 4px;';
    else if (inRoute)  rowBg = 'background:rgba(26,86,219,.03);border-radius:4px;padding:1px 4px;';

    const isLast     = i === fermate.length - 1;
    const dotOutline = isCurrent ? ';outline:3px solid rgba(26,86,219,.3)' : '';

    html += `
      <div class="d-flex gap-2 align-items-stretch" style="min-height:${isLast ? 'auto' : '48px'}">
        <div class="d-flex flex-column align-items-center flex-shrink-0" style="width:18px;padding-top:4px">
          <div style="width:${dotSize}px;height:${dotSize}px;border-radius:50%;background:${dotColor};flex-shrink:0${dotOutline}"></div>
          ${!isLast ? `<div style="width:3px;flex:1;background:${lineColor};border-radius:2px;margin-top:3px"></div>` : ''}
        </div>
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

/* ── renderFermateWithConnection (treno con coincidenza) ── */

function renderFermateWithConnection(data1, data2, fromName, transferName, toName, depTs) {
  if (!data1 || !data2) return `<p class="text-center text-muted py-4">Nessuna fermata disponibile</p>`;
  const cat1 = (data1.categoria || '').trim().toUpperCase() || 'REG';
  const cat2 = (data2.categoria || '').trim().toUpperCase() || 'REG';
  const [bg1, tx1] = getCatColors(cat1);
  const [bg2, tx2] = getCatColors(cat2);
  const num1 = data1.numeroTreno || '';
  const num2 = data2.numeroTreno || '';

  const norm      = s => (s || '').trim().toLowerCase();
  const fermate1  = data1.fermate || [];
  const fromNorm  = norm(fromName);
  const transNorm = norm(transferName);

  const fromIdx1  = fermate1.findIndex(f => norm(f.stazione).includes(fromNorm)  || fromNorm.includes(norm(f.stazione)));
  const transIdx1 = fermate1.findIndex(f => norm(f.stazione).includes(transNorm) || transNorm.includes(norm(f.stazione)));
  const slice1    = fermate1.slice(
    fromIdx1  >= 0 ? fromIdx1  : 0,
    transIdx1 >= 0 ? transIdx1 + 1 : fermate1.length
  );

  const fermate2  = data2.fermate || [];
  const toNorm    = norm(toName);
  const transIdx2 = fermate2.findIndex(f => norm(f.stazione).includes(transNorm) || transNorm.includes(norm(f.stazione)));
  const toIdx2    = fermate2.findIndex(f => norm(f.stazione).includes(toNorm)    || toNorm.includes(norm(f.stazione)));
  const slice2    = fermate2.slice(
    transIdx2 >= 0 ? transIdx2 : 0,
    toIdx2    >= 0 ? toIdx2 + 1 : fermate2.length
  );

  const ritardo1 = data1.ritardo || 0;
  const ritardo2 = data2.ritardo || 0;
  const now      = Date.now();
  const delayMs1 = ritardo1 * 60000;
  const delayMs2 = ritardo2 * 60000;

  function calcLastPassed(fermate, delayMs) {
    let idx = -1;
    fermate.forEach((f, i) => {
      if (f.actualFermataType === 1 || f.actualFermataType === 2 ||
          f.effettiva || f.arrivoReale || f.partenzaReale) idx = i;
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

  function renderLegStops(fermate, lastPassedIdx, startName, endName, isLastLeg, delayMs) {
    const ritardo = Math.round(delayMs / 60000);
    let html = '';
    fermate.forEach((f, i) => {
      const isPassed  = i < lastPassedIdx;
      const isCurrent = i === lastPassedIdx;
      const normSt    = norm(f.stazione);
      const normStart = norm(startName);
      const normEnd   = norm(endName);
      const isFrom    = normSt.includes(normStart) || normStart.includes(normSt);
      const isTo      = normSt.includes(normEnd)   || normEnd.includes(normSt);

      const oraProg    = f.arrivo_teorico || f.programmata;
      const oraReal    = f.effettiva || f.arrivoReale || f.partenzaReale;
      const oraStr     = oraProg ? formatTime(new Date(oraProg)) : '--:--';
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
      else                { dotColor = isPassed ? '#6c757d' : '#1a56db'; dotSize = 8; }
      if (isCurrent) { dotColor = '#1a56db'; dotSize = 14; }

      const lineColor  = isPassed ? '#6c757d' : '#1a56db';
      const dotOutline = isCurrent ? ';outline:3px solid rgba(26,86,219,.3)' : '';
      let nameCls = isPassed
        ? 'text-muted'
        : (isFrom || isTo ? `fw-bold ${isFrom ? 'text-primary' : 'text-danger'}` : 'fw-semibold');
      if (isCurrent) nameCls = 'fw-bold text-primary';

      let rowBg = '';
      if      (isFrom) rowBg = 'background:rgba(26,86,219,.06);border-radius:6px;padding:2px 4px;';
      else if (isTo)   rowBg = 'background:rgba(220,53,69,.06);border-radius:6px;padding:2px 4px;';

      const showLine = !(i === fermate.length - 1 && isLastLeg);
      html += `
        <div class="d-flex gap-2 align-items-stretch" style="min-height:${showLine ? '48px' : 'auto'}">
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
              const binEff  = isFrom
                ? (f.binarioEffettivoPartenzaDescrizione || f.binarioProgrammatoPartenzaDescrizione)
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
  html += `
  <div class="px-3 pt-2 pb-1 border-bottom" style="background:rgba(26,86,219,.04)">
    <div class="d-flex align-items-center gap-2">
      <span class="badge ${bg1} ${tx1}">${esc(cat1)}</span>
      <span class="fw-semibold small">${esc(String(num1))}</span>
      ${ritardo1 > 0
        ? `<span class="badge bg-${ritardo1 > 5 ? 'danger' : 'warning'} ${ritardo1 > 5 ? '' : 'text-dark'} ms-auto">+${ritardo1} min</span>`
        : '<span class="badge bg-success ms-auto">Puntuale</span>'}
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
  html += `
  <div class="px-3 pt-1 pb-1 border-bottom" style="background:rgba(26,86,219,.04)">
    <div class="d-flex align-items-center gap-2">
      <span class="badge ${bg2} ${tx2}">${esc(cat2)}</span>
      <span class="fw-semibold small">${esc(String(num2))}</span>
      ${ritardo2 > 0
        ? `<span class="badge bg-${ritardo2 > 5 ? 'danger' : 'warning'} ${ritardo2 > 5 ? '' : 'text-dark'} ms-auto">+${ritardo2} min</span>`
        : '<span class="badge bg-success ms-auto">Puntuale</span>'}
    </div>
  </div>`;
  html += `<div class="px-3 pt-2 pb-3">${renderLegStops(slice2, lastPassed2, transferName, toName, true, delayMs2)}</div>`;

  return html;
}

/* ── renderFermateWith2Connections (AI – 3 treni, 2 coincidenze) ── */

function renderFermateWith2Connections(data1, data2, data3, fromName, transfer1Name, transfer2Name, toName, depTs) {
  if (!data1 || !data2 || !data3) return `<p class="text-center text-muted py-4">Nessuna fermata disponibile</p>`;

  const cat1 = (data1.categoria || '').trim().toUpperCase() || 'REG';
  const cat2 = (data2.categoria || '').trim().toUpperCase() || 'REG';
  const cat3 = (data3.categoria || '').trim().toUpperCase() || 'REG';
  const [bg1, tx1] = getCatColors(cat1);
  const [bg2, tx2] = getCatColors(cat2);
  const [bg3, tx3] = getCatColors(cat3);
  const num1 = data1.numeroTreno || '';
  const num2 = data2.numeroTreno || '';
  const num3 = data3.numeroTreno || '';

  const norm     = s => (s || '').trim().toLowerCase();
  const fermate1 = data1.fermate || [];
  const fermate2 = data2.fermate || [];
  const fermate3 = data3.fermate || [];

  const ritardo1 = data1.ritardo || 0;
  const ritardo2 = data2.ritardo || 0;
  const ritardo3 = data3.ritardo || 0;
  const delayMs1 = ritardo1 * 60000;
  const delayMs2 = ritardo2 * 60000;
  const delayMs3 = ritardo3 * 60000;

  function findIdx(fermate, n) {
    return fermate.findIndex(f => norm(f.stazione).includes(n) || n.includes(norm(f.stazione)));
  }

  const fromNorm = norm(fromName);
  const t1Norm   = norm(transfer1Name);
  const t2Norm   = norm(transfer2Name);
  const toNorm   = norm(toName);

  const slice1 = fermate1.slice(
    Math.max(0, findIdx(fermate1, fromNorm)),
    findIdx(fermate1, t1Norm) >= 0 ? findIdx(fermate1, t1Norm) + 1 : fermate1.length
  );
  const t2Start = findIdx(fermate2, t1Norm);
  const t2End   = findIdx(fermate2, t2Norm);
  const slice2 = fermate2.slice(
    t2Start >= 0 ? t2Start : 0,
    t2End   >= 0 ? t2End + 1 : fermate2.length
  );
  const t3Start = findIdx(fermate3, t2Norm);
  const t3End   = findIdx(fermate3, toNorm);
  const slice3 = fermate3.slice(
    t3Start >= 0 ? t3Start : 0,
    t3End   >= 0 ? t3End + 1 : fermate3.length
  );

  if (!slice1.length && !slice2.length && !slice3.length) {
    return `<p class="text-center text-muted py-4">Fermate non ancora disponibili (treni non ancora partiti)</p>`;
  }

  const now = Date.now();
  function calcLP(fermate, delayMs) {
    let idx = -1;
    fermate.forEach((f, i) => {
      if (f.actualFermataType === 1 || f.actualFermataType === 2 ||
          f.effettiva || f.arrivoReale || f.partenzaReale) idx = i;
    });
    fermate.forEach((f, i) => {
      if (i <= idx) return;
      const p = f.programmata || f.arrivo_teorico || f.partenza_teorica;
      if (p && (p + delayMs) < now) idx = i;
    });
    return idx;
  }
  const lp1 = calcLP(slice1, delayMs1);
  const lp2 = calcLP(slice2, delayMs2);
  const lp3 = calcLP(slice3, delayMs3);

  function legStops(fermate, lpIdx, startName, endName, isLast, delayMs) {
    const ritardo = Math.round(delayMs / 60000);
    let html = '';
    fermate.forEach((f, i) => {
      const isPassed  = i < lpIdx;
      const isCurrent = i === lpIdx;
      const normSt    = norm(f.stazione);
      const isFrom    = normSt.includes(norm(startName)) || norm(startName).includes(normSt);
      const isTo      = normSt.includes(norm(endName))   || norm(endName).includes(normSt);
      const oraProg    = f.arrivo_teorico || f.programmata;
      const oraReal    = f.effettiva || f.arrivoReale || f.partenzaReale;
      const oraStr     = oraProg ? formatTime(new Date(oraProg)) : '--:--';
      const oraRealStr = oraReal && oraReal !== oraProg ? formatTime(new Date(oraReal)) : null;
      const fRit = f.ritardo || ritardo || 0;
      let ritBadge = '';
      if ((isCurrent || isPassed) && fRit > 0)
        ritBadge = `<span class="badge bg-${fRit > 5 ? 'danger' : 'warning text-dark'} ms-1">+${fRit}'</span>`;
      let dotColor = isPassed ? '#6c757d' : '#1a56db', dotSize = 8;
      if (isFrom || isTo) { dotColor = isFrom ? '#1a56db' : '#dc3545'; dotSize = 14; }
      if (isCurrent)      { dotColor = '#1a56db'; dotSize = 14; }
      const lineColor  = isPassed ? '#6c757d' : '#1a56db';
      const dotOutline = isCurrent ? ';outline:3px solid rgba(26,86,219,.3)' : '';
      let nameCls = isPassed ? 'text-muted' : (isFrom || isTo ? `fw-bold ${isFrom ? 'text-primary' : 'text-danger'}` : 'fw-semibold');
      if (isCurrent) nameCls = 'fw-bold text-primary';
      let rowBg = '';
      if      (isFrom) rowBg = 'background:rgba(26,86,219,.06);border-radius:6px;padding:2px 4px;';
      else if (isTo)   rowBg = 'background:rgba(220,53,69,.06);border-radius:6px;padding:2px 4px;';
      const showLine = !(i === fermate.length - 1 && isLast);
      const binEff  = isFrom ? (f.binarioEffettivoPartenzaDescrizione || f.binarioProgrammatoPartenzaDescrizione)
                             : (f.binarioEffettivoArrivoDescrizione   || f.binarioProgrammatoArrivoDescrizione);
      const binProg = isFrom ? f.binarioProgrammatoPartenzaDescrizione : f.binarioProgrammatoArrivoDescrizione;
      const binChanged = binEff && binProg && binEff !== binProg;
      const binHtml = (isFrom || isTo || isCurrent) && binEff ? `
        <div class="d-flex align-items-center gap-1 mt-1">
          <small class="text-muted">Bin.</small>
          <span class="badge ${binChanged ? 'bg-warning text-dark' : (isFrom ? 'bg-primary' : 'bg-danger')} platform-num">${esc(binEff)}</span>
          ${binChanged ? `<small class="text-muted fst-italic">var. da ${esc(binProg)}</small>` : ''}
        </div>` : '';
      html += `
        <div class="d-flex gap-2 align-items-stretch" style="min-height:${showLine ? '48px' : 'auto'}">
          <div class="d-flex flex-column align-items-center flex-shrink-0" style="width:18px;padding-top:4px">
            <div style="width:${dotSize}px;height:${dotSize}px;border-radius:50%;background:${dotColor};flex-shrink:0${dotOutline}"></div>
            ${showLine ? `<div style="width:3px;flex:1;background:${lineColor};border-radius:2px;margin-top:3px"></div>` : ''}
          </div>
          <div class="flex-grow-1 pb-2" style="${rowBg}">
            <div class="d-flex justify-content-between align-items-start">
              <span class="${nameCls}" style="font-size:.9rem">${esc(f.stazione || '')}</span>
              <span class="ms-2 flex-shrink-0" style="font-size:.9rem">${oraStr}${oraRealStr ? ` <span class="text-muted" style="font-size:.75rem">(${oraRealStr})</span>` : ''}</span>
            </div>
            ${binHtml}${ritBadge}
            ${isCurrent ? `<div class="text-primary" style="font-size:.72rem"><i class="bi bi-train-front-fill me-1"></i>Qui ora</div>` : ''}
          </div>
        </div>`;
    });
    return html;
  }

  function trainHeader(bg, tx, cat, num, rit) {
    return `
    <div class="px-3 pt-2 pb-1 border-bottom" style="background:rgba(26,86,219,.04)">
      <div class="d-flex align-items-center gap-2">
        <span class="badge ${bg} ${tx}">${esc(cat)}</span>
        <span class="fw-semibold small">${esc(String(num))}</span>
        ${rit > 0 ? `<span class="badge bg-${rit > 5 ? 'danger' : 'warning'} ${rit > 5 ? '' : 'text-dark'} ms-auto">+${rit} min</span>`
                  : '<span class="badge bg-success ms-auto">Puntuale</span>'}
      </div>
    </div>`;
  }

  function cambioDiv(stazione, cat, num) {
    return `
    <div class="mx-3 my-2 rounded-3 border border-warning d-flex align-items-center gap-2 px-3 py-2" style="background:#fffbeb">
      <i class="bi bi-arrow-repeat text-warning fs-5"></i>
      <div>
        <div class="fw-bold small">Cambio a ${esc(stazione)}</div>
        <div class="text-muted" style="font-size:.75rem">Prosegui con ${esc(cat)} ${esc(String(num))}</div>
      </div>
    </div>`;
  }

  let html = '';
  html += trainHeader(bg1, tx1, cat1, num1, ritardo1);
  html += `<div class="px-3 pt-2">${legStops(slice1, lp1, fromName, transfer1Name, false, delayMs1)}</div>`;
  html += cambioDiv(transfer1Name, cat2, num2);
  html += trainHeader(bg2, tx2, cat2, num2, ritardo2);
  html += `<div class="px-3 pt-2">${legStops(slice2, lp2, transfer1Name, transfer2Name, false, delayMs2)}</div>`;
  html += cambioDiv(transfer2Name, cat3, num3);
  html += trainHeader(bg3, tx3, cat3, num3, ritardo3);
  html += `<div class="px-3 pt-2 pb-3">${legStops(slice3, lp3, transfer2Name, toName, true, delayMs3)}</div>`;
  return html;
}

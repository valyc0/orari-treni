'use strict';

/* ═══════════════════════════════════════════════
   COINCIDENZE – ricerca itinerario con cambio treno
═══════════════════════════════════════════════ */

/**
 * Cerca soluzioni con una coincidenza tra routeFrom e routeTo
 * analizzando le fermate intermedie dei treni in partenza/arrivo.
 * @returns {Array} Array di oggetti { key, leg1, transfer, leg2, totalMin }
 */
async function searchRouteWithConnections(date0) {
  const windows    = buildTimeWindows(date0);
  const arrWindows = buildArrivalWindows(date0);

  const [depResults, arrResults] = await Promise.all([
    Promise.all(windows.map(ts    => getDepartures(routeFrom.id, null, ts).catch(() => []))),
    Promise.all(arrWindows.map(ts => getArrivals(routeTo.id, null, ts).catch(() => []))),
  ]);

  // Deduplica partenze e arrivi per numeroTreno
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

  // Carica andamentoTreno per tutti i treni in parallelo
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
    )),
  ]);

  // Mappa stopId → possibili arrivi da routeFrom per costruire i trasferimenti
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

  // Ordina per orario di partenza e deduplica per coppia di treni
  connections.sort((a, b) => a.leg1.depTime - b.leg1.depTime);
  const seen = new Set();
  const direct = connections.filter(c => {
    if (seen.has(c.key)) return false;
    seen.add(c.key);
    return true;
  });

  // Se andamentoTreno non ha restituito fermate (treni futuri non ancora
  // partiti), usa il fallback basato su destinazione/origine degli endpoint
  // /partenze e /arrivi senza bisogno di andamentoTreno.
  if (direct.length > 0) return direct;
  const allFermateEmpty = [...depDetails, ...arrDetails].every(d => d.fermate.length === 0);
  if (!allFermateEmpty) return direct;
  return searchRouteHubFallback(date0, depMap, arrMap);
}

/**
 * Fallback per treni non ancora partiti: individua hub di cambio
 * confrontando "destinazione" delle partenze da A con "origine" degli
 * arrivi a B, poi verifica gli orari interrogando /partenze e /arrivi
 * sull'hub stesso.
 */
async function searchRouteHubFallback(date0, depMap, arrMap) {
  const MIN_TRANSFER_MS = 10 * 60 * 1000;

  // Mappa hub-name → { depTrains: [...], arrTrains: [...], codOrigine }
  const hubsFromDep = new Map();
  depMap.forEach(t => {
    const dest = t.destinazione;
    if (!dest) return;
    if (!hubsFromDep.has(dest)) hubsFromDep.set(dest, []);
    hubsFromDep.get(dest).push(t);
  });

  const matchedHubs = new Map();
  arrMap.forEach(t => {
    const orig = t.origine;
    if (!orig || !hubsFromDep.has(orig) || !t.codOrigine) return;
    if (!matchedHubs.has(orig)) {
      matchedHubs.set(orig, {
        depTrains:  hubsFromDep.get(orig),
        arrTrains:  [],
        codOrigine: t.codOrigine,
      });
    }
    matchedHubs.get(orig).arrTrains.push(t);
  });

  if (!matchedHubs.size) return [];

  const windows    = buildTimeWindows(date0);
  const arrWindows = buildArrivalWindows(date0);
  const connections = [];

  for (const [hubName, { depTrains, arrTrains, codOrigine }] of matchedHubs) {
    // Partenze dall'hub (per trovare l'orario di partenza dei treni leg2)
    const hubDepsRaw = await Promise.all(
      windows.map(ts => getDepartures(codOrigine, null, ts).catch(() => []))
    );
    // Arrivi all'hub (per trovare l'orario di arrivo dei treni leg1)
    const hubArrsRaw = await Promise.all(
      arrWindows.map(ts => getArrivals(codOrigine, null, ts).catch(() => []))
    );

    const hubDepByNum = new Map();
    hubDepsRaw.flat().forEach(t => {
      if (!t.numeroTreno) return;
      const k = String(t.numeroTreno);
      if (!hubDepByNum.has(k)) hubDepByNum.set(k, t);
    });
    const hubArrByNum = new Map();
    hubArrsRaw.flat().forEach(t => {
      if (!t.numeroTreno) return;
      const k = String(t.numeroTreno);
      if (!hubArrByNum.has(k)) hubArrByNum.set(k, t);
    });

    for (const leg1Train of depTrains) {
      const hubArrTrain = hubArrByNum.get(String(leg1Train.numeroTreno));
      const arrAtHub = hubArrTrain?.orarioArrivo || hubArrTrain?.orarioArrivoZero;
      if (!arrAtHub) continue;

      for (const leg2Train of arrTrains) {
        const hubDepTrain = hubDepByNum.get(String(leg2Train.numeroTreno));
        const depFromHub = hubDepTrain?.orarioPartenza || hubDepTrain?.orarioPartenzaZero;
        if (!depFromHub) continue;

        const depFromA = leg1Train.orarioPartenza || leg1Train.orarioPartenzaZero;
        const arrAtB   = leg2Train.orarioArrivo   || leg2Train.orarioArrivoZero;
        if (!depFromA || !arrAtB) continue;
        if (arrAtHub + MIN_TRANSFER_MS > depFromHub) continue;
        if (depFromA >= arrAtHub) continue;
        if (depFromHub >= arrAtB) continue;

        const binEff  = hubDepTrain.binarioEffettivoPartenzaDescrizione  || hubDepTrain.binarioProgrammatoPartenzaDescrizione  || null;
        const binProg = hubDepTrain.binarioProgrammatoPartenzaDescrizione || null;

        connections.push({
          key:      `${leg1Train.numeroTreno}→${leg2Train.numeroTreno}`,
          leg1:     { train: leg1Train, depTime: depFromA },
          transfer: {
            stationId:   codOrigine,
            stationName: hubName,
            arrTime:     arrAtHub,
            depTime:     depFromHub,
            waitMin:     Math.round((depFromHub - arrAtHub) / 60000),
            binEff,
            binProg,
          },
          leg2:     { train: leg2Train, arrTime: arrAtB },
          totalMin: Math.round((arrAtB - depFromA) / 60000),
        });
      }
    }
  }

  connections.sort((a, b) => a.leg1.depTime - b.leg1.depTime);
  const seen2 = new Set();
  return connections.filter(c => {
    if (seen2.has(c.key)) return false;
    seen2.add(c.key);
    return true;
  });
}

/** Renderizza la card di una soluzione con coincidenza. */
function renderConnectionCard(c) {
  const { leg1, transfer, leg2, totalMin } = c;
  const cat1 = (leg1.train.categoriaDescrizione || leg1.train.categoria || '').trim().toUpperCase() || 'REG';
  const cat2 = (leg2.train.categoriaDescrizione || leg2.train.categoria || '').trim().toUpperCase() || 'REG';
  const [bg1, tx1] = getCatColors(cat1);
  const [bg2, tx2] = getCatColors(cat2);
  const num1 = (leg1.train.compNumeroTreno || String(leg1.train.numeroTreno || '')).trim();
  const num2 = (leg2.train.compNumeroTreno || String(leg2.train.numeroTreno || '')).trim();

  const depTime   = formatTime(new Date(leg1.depTime));
  const arrTime   = formatTime(new Date(leg2.arrTime));
  const transArr  = formatTime(new Date(transfer.arrTime));
  const transDep  = formatTime(new Date(transfer.depTime));
  const durStr    = totalMin < 60 ? `${totalMin} min` : `${Math.floor(totalMin / 60)}h ${totalMin % 60}m`;
  const trainLabel = `${cat1} ${num1} + ${cat2} ${num2} → ${routeTo.name}`.trim();
  const isPast     = leg1.depTime && leg1.depTime < Date.now();

  // Binario partenza leg1 (da /partenze)
  const binDep1        = leg1.train.binarioEffettivoPartenzaDescrizione || leg1.train.binarioProgrammatoPartenzaDescrizione;
  const binDep1Changed = leg1.train.binarioEffettivoPartenzaDescrizione && leg1.train.binarioProgrammatoPartenzaDescrizione &&
                         leg1.train.binarioEffettivoPartenzaDescrizione !== leg1.train.binarioProgrammatoPartenzaDescrizione;
  const binDep1Html = binDep1 ? `
    <div class="d-flex align-items-center gap-1 mt-1">
      <small class="text-muted">Bin.</small>
      <span class="badge ${binDep1Changed ? 'bg-warning text-dark' : 'bg-primary'} platform-num">${esc(binDep1)}</span>
      ${binDep1Changed ? `<small class="text-muted fst-italic">var.</small>` : ''}
    </div>` : '';

  // Binario arrivo leg2 (da /arrivi)
  const binArr2        = leg2.train.binarioEffettivoArrivoDescrizione || leg2.train.binarioProgrammatoArrivoDescrizione;
  const binArr2Changed = leg2.train.binarioEffettivoArrivoDescrizione && leg2.train.binarioProgrammatoArrivoDescrizione &&
                         leg2.train.binarioEffettivoArrivoDescrizione !== leg2.train.binarioProgrammatoArrivoDescrizione;
  const binArr2Html = binArr2 ? `
    <div class="d-flex align-items-center gap-1 mt-1">
      <small class="text-muted">Bin.</small>
      <span class="badge ${binArr2Changed ? 'bg-warning text-dark' : 'bg-danger'} platform-num">${esc(binArr2)}</span>
      ${binArr2Changed ? `<small class="text-muted fst-italic">var.</small>` : ''}
    </div>` : '';

  return `
  <div class="card border-0 shadow-sm mb-3 solution-card connection-card${isPast ? ' opacity-50' : ''}"
       style="${isPast ? 'filter:grayscale(.75)' : ''}"
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
            <div class="text-end ms-3 flex-shrink-0">
              <div class="fw-bold text-primary" style="font-size:1.4rem;line-height:1">${depTime}</div>
              ${isPast ? `<small class="text-muted fst-italic" style="font-size:.72rem">Partito</small>` : ''}
            </div>
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

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

  // Ordina per orario di partenza, poi per durata totale (migliore prima)
  connections.sort((a, b) => a.leg1.depTime - b.leg1.depTime || a.totalMin - b.totalMin);
  const seen = new Set();
  const direct = connections.filter(c => {
    if (seen.has(c.key)) return false;
    seen.add(c.key);
    // Deduplicazione per leg1: stesso treno di partenza → tieni solo la prima soluzione
    const leg1Key = String(c.leg1.train.numeroTreno);
    if (seen.has('leg1:' + leg1Key)) return false;
    seen.add('leg1:' + leg1Key);
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

  connections.sort((a, b) => a.leg1.depTime - b.leg1.depTime || a.totalMin - b.totalMin);
  const seen2 = new Set();
  return connections.filter(c => {
    if (seen2.has(c.key)) return false;
    seen2.add(c.key);
    // Deduplicazione per leg1: stesso treno di partenza → tieni solo la prima soluzione
    const leg1Key = String(c.leg1.train.numeroTreno);
    if (seen2.has('leg1:' + leg1Key)) return false;
    seen2.add('leg1:' + leg1Key);
    return true;
  });
}

/* ═══════════════════════════════════════════════
   RICERCA GUIDATA DALL'AI (fallback 2 coincidenze)
═══════════════════════════════════════════════ */

/** Carica puter.js al volo la prima volta che serve. */
async function loadPuter() {
  if (typeof puter !== 'undefined') return true;
  return new Promise(resolve => {
    const s = document.createElement('script');
    s.src     = 'https://js.puter.com/v2/';
    s.onload  = () => resolve(true);
    s.onerror = () => resolve(false);
    document.head.appendChild(s);
  });
}

/**
 * Chiede all'AI (via puter.js) le stazioni di coincidenza per la tratta corrente.
 * @param {Date} date0 orario di partenza desiderato (per contestualizzare il prompt)
 * @returns {string[]} array di nomi stazione
 */
async function getAIHubs(date0) {
  const ok = await loadPuter();
  if (!ok) { console.warn('[AI] puter.js non caricato'); return []; }
  try {
    const timeStr = date0
      ? date0.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })
      : '';
    const dateStr = date0
      ? date0.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' })
      : '';
    const prompt =
      `Sei un esperto di ferrovie italiane con conoscenza approfondita della rete ` +
      `Trenitalia/RFI, incluse le linee suburbane FL di Roma.\n\n` +
      `Devo viaggiare in treno da "${routeFrom.name}" a "${routeTo.name}"` +
      (dateStr && timeStr ? ` il ${dateStr} con partenza intorno alle ${timeStr}` : '') + `.\n\n` +
      `Analizza il percorso e dimmi TUTTE le stazioni dove bisogna cambiare treno fisicamente, ` +
      `nell'ordine corretto. Tieni conto che:\n` +
      `- Le linee suburbane FL1-FL8 di Roma hanno stazioni terminali specifiche ` +
      `(es. FL1 termina a Roma Ostiense, non a Roma Termini)\n` +
      `- Se serve un trasferimento tra stazioni diverse (es. Roma Ostiense → Roma Termini), ` +
      `elenca ENTRAMBE come stazioni di cambio separate\n` +
      `- Includi anche stazioni intermedie minori se il cambio fisico avviene lì\n\n` +
      `Rispondi SOLO con i nomi esatti delle stazioni ferroviarie italiane, ` +
      `nell'ordine corretto del percorso, separati da virgola. ` +
      `Non includere "${routeFrom.name}" né "${routeTo.name}". ` +
      `Nessun altro testo, solo i nomi delle stazioni.`;
    const raw  = await puter.ai.chat(prompt, { model: 'gpt-4o-mini' });
    const text = typeof raw === 'string' ? raw
               : (raw?.message?.content || raw?.content || '');
    console.log('[AI] risposta grezza:', text);
    const names = text
      .split(/[,\n]+/)
      .map(s => s.trim().replace(/^[-•*\d.\s"']+|["'.\s]+$/g, ''))
      .filter(s => s.length > 1);
    console.log('[AI] hub parsati:', names);
    return names;
  } catch (err) {
    console.error('[AI] errore getAIHubs:', err);
    return [];
  }
}

/**
 * Trova treni diretti da fromId a toId con partenza >= afterTs.
 * @returns {Array<{dep, arr, depTime, arrTime}>} ordinato per orario di partenza
 */
async function findDirectLeg(fromId, toId, afterTs) {
  const date0      = new Date(afterTs);
  const windows    = buildTimeWindows(date0);
  const arrWindows = buildArrivalWindows(date0);

  const [depResults, arrResults] = await Promise.all([
    Promise.all(windows.map(ts    => getDepartures(fromId, null, ts).catch(() => []))),
    Promise.all(arrWindows.map(ts => getArrivals(toId,   null, ts).catch(() => []))),
  ]);

  const depMap = new Map();
  depResults.flat().forEach(t => {
    if (!t.numeroTreno) return;
    const k = String(t.numeroTreno);
    if (!depMap.has(k)) depMap.set(k, t);
  });
  const arrByNum = new Map();
  arrResults.flat().forEach(t => {
    if (!t.numeroTreno) return;
    const k = String(t.numeroTreno);
    if (!arrByNum.has(k)) arrByNum.set(k, t);
  });

  const matches = [];
  depMap.forEach(dep => {
    const arr  = arrByNum.get(String(dep.numeroTreno));
    if (!arr) return;
    const tDep = dep.orarioPartenza || dep.orarioPartenzaZero;
    const tArr = arr.orarioArrivo   || arr.orarioArrivoZero;
    if (tDep && tArr && tDep >= afterTs && tDep < tArr)
      matches.push({ dep, arr, depTime: tDep, arrTime: tArr });
  });
  matches.sort((a, b) => a.depTime - b.depTime);
  console.log(`[AI] findDirectLeg ${fromId}→${toId}: ${matches.length} treni trovati`);
  return matches;
}

/**
 * Dato un set di partenze dalla stazione di partenza, ricava i terminali
 * unici (campo `destinazione`) e li risolve in stazioni ViaggaTreno.
 */
async function getTerminalHubsFromDeps(date0) {
  const windows = buildTimeWindows(date0);
  const depResults = await Promise.all(
    windows.map(ts => getDepartures(routeFrom.id, null, ts).catch(() => []))
  );
  const destNames = [...new Set(
    depResults.flat()
      .map(t => t.destinazione)
      .filter(Boolean)
  )];
  console.log('[AI] terminali di partenza trovati:', destNames);
  const stations = [];
  for (const name of destNames.slice(0, 4)) {
    const r = await searchStations(name).catch(() => []);
    if (r.length) stations.push(r[0]);
  }
  return stations;
}

/**
 * Recupera tutte le coppie dep/arr tra due stazioni in una finestra di 5 ore,
 * partendo da date0Ts. Più ampio di findDirectLeg, per uso nei leg intermedi.
 * @returns {Array<{dep, arr, depTime, arrTime}>} ordinato per orario di partenza
 */
async function fetchLeg(fromId, toId, date0Ts) {
  const date0 = new Date(date0Ts);
  const windows = [0, 60, 120, 180, 240, 300].map(d =>
    viTimestamp(new Date(date0.getTime() + d * 60000))
  );
  const [depRes, arrRes] = await Promise.all([
    Promise.all(windows.map(ts => getDepartures(fromId, null, ts).catch(() => []))),
    Promise.all(windows.map(ts => getArrivals(toId,   null, ts).catch(() => []))),
  ]);
  const depMap = new Map(), arrMap = new Map();
  depRes.flat().forEach(t => { const k = String(t.numeroTreno || ''); if (k && !depMap.has(k)) depMap.set(k, t); });
  arrRes.flat().forEach(t => { const k = String(t.numeroTreno || ''); if (k && !arrMap.has(k)) arrMap.set(k, t); });
  const out = [];
  depMap.forEach((dep, k) => {
    const arr  = arrMap.get(k);
    if (!arr) return;
    const tDep = dep.orarioPartenza || dep.orarioPartenzaZero;
    const tArr = arr.orarioArrivo   || arr.orarioArrivoZero;
    if (tDep && tArr && tDep >= date0Ts && tDep < tArr)
      out.push({ dep, arr, depTime: tDep, arrTime: tArr });
  });
  out.sort((a, b) => a.depTime - b.depTime);
  console.log(`[AI] fetchLeg ${fromId}→${toId}: ${out.length} treni`);
  return out;
}

/**
 * Costruisce le connessioni per una catena a 2 hub (3 leg, 2 trasferimenti)
 * usando l'approccio "partenza più tarda": per ogni treno finale (leg3) cerca
 * il leg2 e leg1 con partenza il più tarda possibile → minimizza le attese.
 */
async function buildChain4(chain, date0, MIN_TRANSFER_MS) {
  const start = date0.getTime();
  // Fetch tutti e 3 i leg in parallelo partendo da date0 con finestre ampie
  const [leg1s, leg2s, leg3s] = await Promise.all([
    fetchLeg(chain[0].id, chain[1].id, start),
    fetchLeg(chain[1].id, chain[2].id, start),
    fetchLeg(chain[2].id, chain[3].id, start),
  ]);
  console.log(`[AI] buildChain4 leg1:${leg1s.length} leg2:${leg2s.length} leg3:${leg3s.length}`);

  const connections = [];
  const seen = new Set();

  // Itera sul treno finale; per ognuno trova il leg2 e leg1 più tardi compatibili
  for (const leg3 of leg3s) {
    // leg2 deve arrivare a chain[2] almeno MIN_TRANSFER_MS prima di leg3
    const validLeg2 = leg2s.filter(l2 => l2.arrTime + MIN_TRANSFER_MS <= leg3.depTime);
    if (!validLeg2.length) continue;
    const bestLeg2 = validLeg2[validLeg2.length - 1]; // più tardo = meno attesa a hub2

    // leg1 deve arrivare a chain[1] almeno MIN_TRANSFER_MS prima di bestLeg2
    const validLeg1 = leg1s.filter(l1 => l1.arrTime + MIN_TRANSFER_MS <= bestLeg2.depTime);
    if (!validLeg1.length) continue;
    const bestLeg1 = validLeg1[validLeg1.length - 1]; // più tardo = meno attesa a hub1

    const key = `${bestLeg1.dep.numeroTreno}→${bestLeg2.dep.numeroTreno}→${leg3.dep.numeroTreno}`;
    if (seen.has(key)) continue;
    seen.add(key);

    connections.push({
      type:      '2hop',
      key,
      leg1:      { train: bestLeg1.dep, depTime: bestLeg1.depTime },
      transfer1: {
        stationId:   chain[1].id,
        stationName: chain[1].name,
        arrTime:     bestLeg1.arrTime,
        depTime:     bestLeg2.depTime,
        waitMin:     Math.round((bestLeg2.depTime - bestLeg1.arrTime) / 60000),
        arrObj:      bestLeg1.arr,  // oggetto arrivo a hub1 → per binario arrivo
      },
      leg2:      { train: bestLeg2.dep },
      transfer2: {
        stationId:   chain[2].id,
        stationName: chain[2].name,
        arrTime:     bestLeg2.arrTime,
        depTime:     leg3.depTime,
        waitMin:     Math.round((leg3.depTime - bestLeg2.arrTime) / 60000),
        arrObj:      bestLeg2.arr,  // oggetto arrivo a hub2 → per binario arrivo
      },
      leg3:      { train: leg3.arr, arrTime: leg3.arrTime },
      totalMin:  Math.round((leg3.arrTime - bestLeg1.depTime) / 60000),
    });
  }
  return connections;
}

/**
 * Ricerca guidata dall'AI: ottiene le stazioni di coincidenza dall'AI,
 * risolve gli ID ViaggaTreno e cerca treni per ogni tratta.
 * Se il primo leg non trova treni (hub non raggiungibile direttamente),
 * auto-espande la catena aggiungendo i terminali della stazione di partenza.
 * @returns {Array} array di oggetti connessione
 */
async function searchRouteAIGuided(date0) {
  const hubNames = await getAIHubs(date0);
  if (!hubNames.length) { console.warn('[AI] nessun hub dall\'AI'); return []; }

  // Risolvi i nomi in ID stazione ViaggaTreno
  const hubStations = [];
  for (const name of hubNames) {
    const results = await searchStations(name).catch(() => []);
    if (results.length) {
      console.log(`[AI] hub "${name}" → ${results[0].id} (${results[0].name})`);
      hubStations.push(results[0]);
    } else {
      console.warn(`[AI] nessuna stazione trovata per "${name}"`);
    }
  }
  if (!hubStations.length) return [];

  const MIN_TRANSFER_MS = 8 * 60 * 1000;
  let connections = [];

  if (hubStations.length === 1) {
    // 1 hub: fetch entrambi i leg in parallelo con finestre ampie
    const chain3 = [routeFrom, hubStations[0], routeTo];
    const [leg1s, leg2s] = await Promise.all([
      fetchLeg(chain3[0].id, chain3[1].id, date0.getTime()),
      fetchLeg(chain3[1].id, chain3[2].id, date0.getTime()),
    ]);

    if (leg1s.length > 0) {
      // "Partenza più tarda": per ogni leg2 finale, trova il leg1 più tardo compatibile
      for (const leg2 of leg2s) {
        const validLeg1 = leg1s.filter(l1 => l1.arrTime + MIN_TRANSFER_MS <= leg2.depTime);
        if (!validLeg1.length) continue;
        const bestLeg1 = validLeg1[validLeg1.length - 1];
        connections.push({
          key:      `${bestLeg1.dep.numeroTreno}→${leg2.dep.numeroTreno}`,
          leg1:     { train: bestLeg1.dep, depTime: bestLeg1.depTime },
          transfer: {
            stationId:   chain3[1].id,
            stationName: chain3[1].name,
            arrTime:     bestLeg1.arrTime,
            depTime:     leg2.depTime,
            waitMin:     Math.round((leg2.depTime - bestLeg1.arrTime) / 60000),
            binEff: null, binProg: null,
          },
          leg2:     { train: leg2.arr, arrTime: leg2.arrTime },
          totalMin: Math.round((leg2.arrTime - bestLeg1.depTime) / 60000),
        });
      }
    } else {
      // leg1 fallito: l'hub AI non è raggiungibile direttamente da routeFrom.
      // Auto-espansione: prependo i terminali delle partenze da routeFrom.
      console.log('[AI] leg1 vuoto → auto-espansione con terminali di partenza');
      const terminals = await getTerminalHubsFromDeps(date0);
      for (const terminal of terminals) {
        if (terminal.id === hubStations[0].id) continue; // già lo stesso
        const chain4 = [routeFrom, terminal, hubStations[0], routeTo];
        console.log(`[AI] provo catena: ${chain4.map(s => s.name).join(' → ')}`);
        const res = await buildChain4(chain4, date0, MIN_TRANSFER_MS);
        connections.push(...res);
        if (connections.length) break; // basta la prima catena che funziona
      }
    }
  } else if (hubStations.length >= 2) {
    // 2 hub espliciti dall'AI
    const chain4 = [routeFrom, hubStations[0], hubStations[1], routeTo];
    console.log(`[AI] catena 2-hub: ${chain4.map(s => s.name).join(' → ')}`);
    connections = await buildChain4(chain4, date0, MIN_TRANSFER_MS);
  }

  connections.sort((a, b) => a.leg1.depTime - b.leg1.depTime || a.totalMin - b.totalMin);
  const seen = new Set();
  return connections.filter(c => {
    if (seen.has(c.key)) return false;
    seen.add(c.key);
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
       data-train-date="${esc(String(leg1.train.dataPartenzaTreno || (leg1.depTime ? new Date(new Date(leg1.depTime).setHours(0,0,0,0)).getTime() : '')))}"
       data-cod-origine="${esc(leg1.train.codOrigine || '')}"
       data-train2-num="${esc(String(leg2.train.numeroTreno || ''))}"
       data-train2-date="${esc(String(leg2.train.dataPartenzaTreno || (transfer.depTime ? new Date(new Date(transfer.depTime).setHours(0,0,0,0)).getTime() : '')))}"
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

/** Renderizza la card di una soluzione con 2 coincidenze (3 treni, guidata dall'AI). */
function renderConnection2Card(c) {
  const { leg1, transfer1, leg2, transfer2, leg3, totalMin } = c;

  const cat1 = (leg1.train.categoriaDescrizione || leg1.train.categoria || '').trim().toUpperCase() || 'REG';
  const cat2 = (leg2.train.categoriaDescrizione || leg2.train.categoria || '').trim().toUpperCase() || 'REG';
  const cat3 = (leg3.train.categoriaDescrizione || leg3.train.categoria || '').trim().toUpperCase() || 'REG';
  const [bg1, tx1] = getCatColors(cat1);
  const [bg2, tx2] = getCatColors(cat2);
  const [bg3, tx3] = getCatColors(cat3);
  const num1 = (leg1.train.compNumeroTreno || String(leg1.train.numeroTreno || '')).trim();
  const num2 = (leg2.train.compNumeroTreno || String(leg2.train.numeroTreno || '')).trim();
  const num3 = (leg3.train.compNumeroTreno || String(leg3.train.numeroTreno || '')).trim();

  const depTime   = formatTime(new Date(leg1.depTime));
  const arrTime   = formatTime(new Date(leg3.arrTime));
  const t1Arr     = formatTime(new Date(transfer1.arrTime));
  const t1Dep     = formatTime(new Date(transfer1.depTime));
  const t2Arr     = formatTime(new Date(transfer2.arrTime));
  const t2Dep     = formatTime(new Date(transfer2.depTime));
  const durStr    = totalMin < 60 ? `${totalMin} min` : `${Math.floor(totalMin / 60)}h ${totalMin % 60}m`;
  const trainLabel = `${cat1} ${num1} + ${cat2} ${num2} + ${cat3} ${num3} → ${routeTo.name}`.trim();
  const isPast    = leg1.depTime && leg1.depTime < Date.now();

  // ── Binari ──
  function binBadge(t, type) {
    const eff  = type === 'dep' ? t?.binarioEffettivoPartenzaDescrizione  : t?.binarioEffettivoArrivoDescrizione;
    const prog = type === 'dep' ? t?.binarioProgrammatoPartenzaDescrizione : t?.binarioProgrammatoArrivoDescrizione;
    const val  = eff || prog;
    if (!val) return '';
    const changed = eff && prog && eff !== prog;
    const color   = changed ? 'bg-warning text-dark' : (type === 'dep' ? 'bg-primary' : 'bg-danger');
    return `<div class="d-flex align-items-center gap-1 mt-1">
      <small class="text-muted">Bin.</small>
      <span class="badge ${color} platform-num">${esc(val)}</span>
      ${changed ? `<small class="text-muted fst-italic">var.</small>` : ''}
    </div>`;
  }
  const binDep1     = binBadge(leg1.train,        'dep'); // partenza da origin
  const binArrHub1  = binBadge(transfer1.arrObj,  'arr'); // arrivo a hub1
  const binDepHub1  = binBadge(leg2.train,        'dep'); // partenza da hub1
  const binArrHub2  = binBadge(transfer2.arrObj,  'arr'); // arrivo a hub2
  const binArr3     = binBadge(leg3.train,        'arr'); // arrivo a destination

  return `
  <div class="card border-0 shadow-sm mb-3 solution-card connection-card${isPast ? ' opacity-50' : ''}"
       style="${isPast ? 'filter:grayscale(.75)' : ''}"
       data-dep-ts="${leg1.depTime || ''}"
       data-train-label="${esc(trainLabel)}"
       data-train-num="${esc(String(leg1.train.numeroTreno || ''))}"
       data-train-date="${esc(String(leg1.train.dataPartenzaTreno || (leg1.depTime ? new Date(new Date(leg1.depTime).setHours(0,0,0,0)).getTime() : '')))}"
       data-cod-origine="${esc(leg1.train.codOrigine || '')}"
       data-train2-num="${esc(String(leg2.train.numeroTreno || ''))}"
       data-train2-date="${esc(String(leg2.train.dataPartenzaTreno || (transfer1.depTime ? new Date(new Date(transfer1.depTime).setHours(0,0,0,0)).getTime() : '')))}"
       data-cod-origine2="${esc(leg2.train.codOrigine || '')}"
       data-train3-num="${esc(String(leg3.train.numeroTreno || ''))}"
       data-train3-date="${esc(String(leg3.train.dataPartenzaTreno || (transfer2.depTime ? new Date(new Date(transfer2.depTime).setHours(0,0,0,0)).getTime() : '')))}"
       data-cod-origine3="${esc(leg3.train.codOrigine || '')}"
       data-transfer-station="${esc(transfer1.stationName)}"
       data-transfer2-station="${esc(transfer2.stationName)}"
       data-route-from="${esc(routeFrom.name)}"
       data-route-to="${esc(routeTo.name)}">
    <div class="card-body p-3">
      <div class="d-flex align-items-center gap-2 mb-3 flex-wrap">
        <span class="badge bg-warning text-dark"><i class="bi bi-arrow-left-right me-1"></i>2 coincidenze</span>
        <span class="badge bg-secondary text-white"><i class="bi bi-robot me-1"></i>AI</span>
        <span class="badge bg-light text-secondary border ms-auto">${esc(durStr)}</span>
      </div>
      <div class="d-flex gap-3">
        <div class="d-flex flex-column align-items-center flex-shrink-0" style="padding-top:4px">
          <div class="sol-dot"></div>
          <div class="sol-line flex-grow-1 my-1"></div>
          <div class="sol-dot" style="background:#6c757d;width:10px;height:10px"></div>
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
              ${binDep1}
            </div>
            <div class="text-end ms-3 flex-shrink-0">
              <div class="fw-bold text-primary" style="font-size:1.4rem;line-height:1">${depTime}</div>
              ${isPast ? `<small class="text-muted fst-italic" style="font-size:.72rem">Partito</small>` : ''}
            </div>
          </div>
          <hr class="my-2">
          <!-- prima coincidenza -->
          <div class="d-flex justify-content-between align-items-start mb-1">
            <div>
              <div class="fw-semibold text-secondary">${esc(transfer1.stationName)}</div>
              <div class="d-flex gap-2 align-items-center mt-1 flex-wrap">
                <small class="text-muted">Arr. ${t1Arr} → Dep. ${t1Dep}</small>
                <span class="badge bg-light text-secondary border" style="font-size:.7rem">att. ${transfer1.waitMin} min</span>
              </div>
              ${binArrHub1}${binDepHub1}
              <div class="d-flex align-items-center gap-1 mt-1 flex-wrap">
                <span class="badge ${bg2} ${tx2}">${esc(cat2)}</span>
                <span class="text-muted small">${esc(num2)}</span>
              </div>
            </div>
          </div>
          <hr class="my-2">
          <!-- seconda coincidenza -->
          <div class="d-flex justify-content-between align-items-start mb-1">
            <div>
              <div class="fw-semibold text-secondary">${esc(transfer2.stationName)}</div>
              <div class="d-flex gap-2 align-items-center mt-1 flex-wrap">
                <small class="text-muted">Arr. ${t2Arr} → Dep. ${t2Dep}</small>
                <span class="badge bg-light text-secondary border" style="font-size:.7rem">att. ${transfer2.waitMin} min</span>
              </div>
              ${binArrHub2}
              <div class="d-flex align-items-center gap-1 mt-1 flex-wrap">
                <span class="badge ${bg3} ${tx3}">${esc(cat3)}</span>
                <span class="text-muted small">${esc(num3)}</span>
              </div>
            </div>
          </div>
          <hr class="my-2">
          <!-- arrivo -->
          <div class="d-flex justify-content-between align-items-start">
            <div>
              <div class="fw-bold">${esc(routeTo.name)}</div>
              ${binArr3}
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
            <i class="bi bi-map me-1"></i>Vedi tratta (leg 1)
          </button>
        </div>
      </div>
    </div>
  </div>`;
}

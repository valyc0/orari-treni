'use strict';

/* ═══════════════════════════════════════════════
   API – proxy con auto-fallback + chiamate ViaggaTreno
═══════════════════════════════════════════════ */

/**
 * Genera il timestamp nel formato atteso da ViaggaTreno
 * (es. "Thu May 08 2025 14:30:00 GMT+0200").
 */
function viTimestamp(date) {
  const d    = date || new Date();
  const off  = d.getTimezoneOffset();
  const sign = off <= 0 ? '+' : '-';
  const abs  = Math.abs(off);
  const offStr = String(Math.floor(abs / 60)).padStart(2, '0') + String(abs % 60).padStart(2, '0');
  return `${DAYS[d.getDay()]} ${MONTHS[d.getMonth()]} ${String(d.getDate()).padStart(2,'0')} ` +
         `${d.getFullYear()} ${String(d.getHours()).padStart(2,'0')}:` +
         `${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')} GMT${sign}${offStr}`;
}

/**
 * Costruisce 3 finestre temporali consecutive (+0h, +1h, +2h) a partire
 * da date0, pronte per essere passate alle API partenze/arrivi.
 * Fattorizza il pattern ripetuto in searchRoute, loadMoreRoute e
 * searchRouteWithConnections.
 */
function buildTimeWindows(date0) {
  return [0, 60, 120].map(deltaMin => {
    const d = new Date(date0.getTime() + deltaMin * 60000);
    return viTimestamp(d);
  });
}

/**
 * Finestre temporali per gli ARRIVI a destinazione.
 * Copre un range più ampio (+0…+300 min) perché il viaggio può
 * durare diverse ore e il treno compare in /arrivi solo nell'ora
 * in cui effettivamente arriva.
 */
function buildArrivalWindows(date0) {
  return [0, 60, 120, 180, 240, 300].map(deltaMin => {
    const d = new Date(date0.getTime() + deltaMin * 60000);
    return viTimestamp(d);
  });
}

/**
 * Esegue una fetch tramite il pool di proxy CORS con auto-fallback.
 * Ricorda l'ultimo proxy funzionante per le chiamate successive.
 * Le richieste sono limitate a MAX_CONCURRENT per evitare rate-limiting.
 */
const _sem = { max: 5, n: 0, q: [] };
function _semAcquire() {
  if (_sem.n < _sem.max) { _sem.n++; return Promise.resolve(); }
  return new Promise(res => _sem.q.push(res));
}
function _semRelease() {
  _sem.n--;
  if (_sem.q.length > 0) { _sem.n++; _sem.q.shift()(); }
}

async function proxyFetch(path) {
  await _semAcquire();
  try {
    const targetUrl = VT_BASE + path;
    const start = _proxyOk !== null ? _proxyOk : 0;
    for (let i = 0; i < PROXY_POOL.length; i++) {
      const idx = (start + i) % PROXY_POOL.length;
      try {
        const resp = await fetch(PROXY_POOL[idx](targetUrl), {
          cache: 'no-store',
          signal: AbortSignal.timeout(10000),
        });
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        const text = await resp.text();
        // Scarta risposte HTML (homepage del proxy che non ha funzionato)
        if (text.trimStart().startsWith('<')) throw new Error('HTML response');
        _proxyOk = idx;
        return text;
      } catch { /* prova il prossimo */ }
    }
    throw new Error('Tutti i proxy falliti');
  } finally {
    _semRelease();
  }
}

async function apiText(path) { return proxyFetch(path); }
async function apiJson(path) { return JSON.parse(await proxyFetch(path)); }

/** Cerca stazioni per nome (autocomplete).
 *  Usa prima la cache locale (ricerca "like" istantanea),
 *  con fallback all'API se la cache non è ancora disponibile.
 */
async function searchStations(q) {
  const local = searchStationsLocal(q);
  if (local !== null) return local.slice(0, 20);

  // Fallback API (prefix match, usato solo finché la cache si sta caricando)
  const text = await apiText('/autocompletaStazione/' + encodeURIComponent(q));
  if (!text || !text.trim()) return [];
  return text.trim().split('\n')
    .map(line => { const p = line.split('|'); return { name: p[0].trim(), id: (p[1] || '').trim() }; })
    .filter(s => s.id);
}

async function getDepartures(stId, date, rawTs) {
  const ts = rawTs || viTimestamp(date);
  return apiJson('/partenze/' + stId + '/' + encodeURIComponent(ts));
}

async function getArrivals(stId, date, rawTs) {
  const ts = rawTs || viTimestamp(date);
  return apiJson('/arrivi/' + stId + '/' + encodeURIComponent(ts));
}

async function getTrainDetails(codOrigine, numeroTreno, dataPartenzaTreno) {
  return apiJson(`/andamentoTreno/${codOrigine}/${numeroTreno}/${dataPartenzaTreno}`);
}

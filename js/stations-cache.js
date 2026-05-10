'use strict';

/* ═══════════════════════════════════════════════
   STATIONS CACHE – precaricamento e ricerca locale
   delle stazioni ferroviarie italiane.

   Al primo avvio scarica tutte le stazioni in
   background (26 chiamate parallele per lettera).
   Il risultato viene salvato in localStorage e
   riutilizzato nelle sessioni successive.
   Dopo 24 ore la cache viene aggiornata silenziosamente.
═══════════════════════════════════════════════ */

const STATIONS_CACHE_KEY = 'treni_stations_v1';
const STATIONS_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 ore

let _stationsCache = []; // Array di { name, id }

/** Legge la cache da localStorage (sincrono). */
function _loadCacheFromStorage() {
  try {
    const raw = localStorage.getItem(STATIONS_CACHE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch { return null; }
}

/** Scrive la cache su localStorage. */
function _saveCacheToStorage(stations) {
  try {
    localStorage.setItem(STATIONS_CACHE_KEY, JSON.stringify({
      stations,
      ts: Date.now(),
    }));
  } catch {}
}

/**
 * Ricerca locale con matching "like" (contiene), case-insensitive.
 * Restituisce null quando la cache non è ancora disponibile
 * (così il chiamante può fare il fallback all'API).
 */
function searchStationsLocal(q) {
  if (!_stationsCache.length) return null;
  const needle = q.toLowerCase().trim();
  if (!needle) return [];

  const results = _stationsCache.filter(s =>
    s.name.toLowerCase().includes(needle)
  );

  // Ordina: prima chi inizia col termine, poi chi lo contiene altrove
  results.sort((a, b) => {
    const al = a.name.toLowerCase();
    const bl = b.name.toLowerCase();
    const aStart = al.startsWith(needle) ? 0 : 1;
    const bStart = bl.startsWith(needle) ? 0 : 1;
    if (aStart !== bStart) return aStart - bStart;
    return al.localeCompare(bl, 'it');
  });

  return results;
}

/** Scarica tutte le stazioni aggiornando la cache progressivamente
 *  lettera per lettera, così i risultati diventano disponibili
 *  il prima possibile (non si aspetta il completamento di tutte le 26 lettere).
 */
async function _refreshStationsCache() {
  const letters = 'abcdefghijklmnopqrstuvwxyz'.split('');
  const seen    = new Set(_stationsCache.map(s => s.id));
  let   working = [..._stationsCache];

  await Promise.all(
    letters.map(l =>
      apiText('/autocompletaStazione/' + encodeURIComponent(l))
        .catch(() => '')
        .then(text => {
          if (!text?.trim()) return;
          const newOnes = [];
          text.trim().split('\n').forEach(line => {
            const p    = line.split('|');
            const name = (p[0] || '').trim();
            const id   = (p[1] || '').trim();
            if (id && name && !seen.has(id)) {
              seen.add(id);
              newOnes.push({ name, id });
            }
          });
          if (newOnes.length) {
            working = working.concat(newOnes);
            _stationsCache = working; // aggiorna in tempo reale
          }
        })
    )
  );

  if (working.length > 100) {
    _saveCacheToStorage(working);
  }
}

/**
 * Inizializza la cache stazioni all'avvio:
 * – se presente in localStorage la usa subito;
 * – aggiorna in background se scaduta (> 24h);
 * – se assente scarica tutto in background.
 */
async function initStationsCache() {
  const cached = _loadCacheFromStorage();

  if (cached?.stations?.length) {
    _stationsCache = cached.stations;
    // Refresh silenzioso se la cache è scaduta
    if (!cached.ts || (Date.now() - cached.ts) > STATIONS_CACHE_TTL) {
      setTimeout(_refreshStationsCache, 3000);
    }
  } else {
    // Prima visita: avvia il download subito (nessun delay artificiale)
    // così le prime lettere (a,b,c,d,e) sono disponibili in pochi secondi.
    _refreshStationsCache();
  }
}

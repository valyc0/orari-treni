'use client';
import { useState, useRef } from 'react';
import type { Train, Station, ConnectionSolution, Connection2Solution, DirectMatch } from '@/lib/types';
import { viTimestamp, buildTimeWindows, buildArrivalWindows } from '@/lib/viTimestamp';

async function apiPartenze(id: string, ts: string): Promise<Train[]> {
  try {
    const res = await fetch(`/api/partenze?id=${encodeURIComponent(id)}&ts=${encodeURIComponent(ts)}`);
    return await res.json();
  } catch { return []; }
}

async function apiArrivi(id: string, ts: string): Promise<Train[]> {
  try {
    const res = await fetch(`/api/arrivi?id=${encodeURIComponent(id)}&ts=${encodeURIComponent(ts)}`);
    return await res.json();
  } catch { return []; }
}

async function apiTreno(cod: string, num: string | number, date: string | number) {
  try {
    const res = await fetch(`/api/treno?cod=${encodeURIComponent(cod)}&num=${encodeURIComponent(String(num))}&date=${encodeURIComponent(String(date))}`);
    return await res.json();
  } catch { return null; }
}

async function apiStazioni(q: string): Promise<Station[]> {
  try {
    const res = await fetch(`/api/stazioni?q=${encodeURIComponent(q)}`);
    return await res.json();
  } catch { return []; }
}

export type SearchResult = DirectMatch | ConnectionSolution | Connection2Solution;

export function useRouteSearch() {
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const shownKeys = useRef(new Set<string>());

  async function searchDirect(date0: Date, from: Station, to: Station): Promise<DirectMatch[]> {
    const windows    = buildTimeWindows(date0);
    const arrWindows = buildArrivalWindows(date0);

    const [depResults, arrResults] = await Promise.all([
      Promise.all(windows.map(ts => apiPartenze(from.id, ts))),
      Promise.all(arrWindows.map(ts => apiArrivi(to.id, ts))),
    ]);

    const depMap = new Map<string, Train>();
    depResults.flat().forEach(t => {
      if (!t.numeroTreno) return;
      const key = String(t.numeroTreno) + '|' + (t.dataPartenzaTreno ?? '');
      if (!depMap.has(key)) depMap.set(key, t);
    });
    const arrByNum = new Map<string, Train>();
    arrResults.flat().forEach(t => {
      if (!t.numeroTreno) return;
      if (!arrByNum.has(String(t.numeroTreno))) arrByNum.set(String(t.numeroTreno), t);
    });

    const matches: DirectMatch[] = [];
    depMap.forEach(dep => {
      const arr = arrByNum.get(String(dep.numeroTreno));
      if (!arr) return;
      const tDep = dep.orarioPartenza || dep.orarioPartenzaZero;
      const tArr = arr.orarioArrivo   || arr.orarioArrivoZero;
      if (tDep && tArr && tDep < tArr) matches.push({ dep, arr });
    });
    matches.sort((a, b) =>
      (a.dep.orarioPartenza || a.dep.orarioPartenzaZero || 0) -
      (b.dep.orarioPartenza || b.dep.orarioPartenzaZero || 0)
    );
    return matches;
  }

  async function searchWithConnections(date0: Date, from: Station, to: Station): Promise<ConnectionSolution[]> {
    const windows    = buildTimeWindows(date0);
    const arrWindows = buildArrivalWindows(date0);

    const [depResults, arrResults] = await Promise.all([
      Promise.all(windows.map(ts    => apiPartenze(from.id, ts))),
      Promise.all(arrWindows.map(ts => apiArrivi(to.id, ts))),
    ]);

    const depMap = new Map<string, Train>();
    depResults.flat().forEach(t => {
      if (!t.numeroTreno || !t.codOrigine || !t.dataPartenzaTreno) return;
      const key = String(t.numeroTreno);
      if (!depMap.has(key)) depMap.set(key, t);
    });
    const arrMap = new Map<string, Train>();
    arrResults.flat().forEach(t => {
      if (!t.numeroTreno || !t.codOrigine || !t.dataPartenzaTreno) return;
      const key = String(t.numeroTreno);
      if (!arrMap.has(key)) arrMap.set(key, t);
    });

    if (!depMap.size || !arrMap.size) return [];

    const [depDetails, arrDetails] = await Promise.all([
      Promise.all([...depMap.values()].map(t =>
        apiTreno(t.codOrigine, t.numeroTreno, t.dataPartenzaTreno)
          .then((d: { fermate?: unknown[] } | null) => ({ train: t, fermate: (d?.fermate || []) as Record<string, unknown>[] }))
          .catch(() => ({ train: t, fermate: [] as Record<string, unknown>[] }))
      )),
      Promise.all([...arrMap.values()].map(t =>
        apiTreno(t.codOrigine, t.numeroTreno, t.dataPartenzaTreno)
          .then((d: { fermate?: unknown[] } | null) => ({ train: t, fermate: (d?.fermate || []) as Record<string, unknown>[] }))
          .catch(() => ({ train: t, fermate: [] as Record<string, unknown>[] }))
      )),
    ]);

    const transferFromMap = new Map<string, Array<{ train: Train; fermata: Record<string, unknown>; arrTime: number }>>();
    for (const { train, fermate } of depDetails) {
      const fromIdx = fermate.findIndex((f) => f.id === from.id);
      if (fromIdx < 0) continue;
      for (let i = fromIdx + 1; i < fermate.length; i++) {
        const f = fermate[i];
        if (!f.id) continue;
        const arrTime = (f.effettivaArrivo || f.programmataArrivo || f.arrivo_teorico || f.programmata) as number;
        if (!arrTime) continue;
        if (!transferFromMap.has(f.id as string)) transferFromMap.set(f.id as string, []);
        transferFromMap.get(f.id as string)!.push({ train, fermata: f, arrTime });
      }
    }

    const MIN_TRANSFER_MS = 5 * 60 * 1000;
    const connections: ConnectionSolution[] = [];

    for (const { train: arrTrain, fermate } of arrDetails) {
      const toIdx = fermate.findIndex((f) => f.id === to.id);
      if (toIdx <= 0) continue;
      for (let i = 0; i < toIdx; i++) {
        const f = fermate[i];
        if (!f.id || !transferFromMap.has(f.id as string)) continue;
        const depTime = (f.effettivaPartenza || f.programmataPartenza || f.partenza_teorica || f.programmata) as number;
        if (!depTime) continue;

        const candidates = transferFromMap.get(f.id as string)!.filter(c => c.arrTime + MIN_TRANSFER_MS <= depTime);
        for (const cand of candidates) {
          const depFromA = cand.train.orarioPartenza || cand.train.orarioPartenzaZero;
          const arrAtB   = arrTrain.orarioArrivo  || arrTrain.orarioArrivoZero;
          if (!depFromA || !arrAtB) continue;
          const key = `${cand.train.numeroTreno}→${arrTrain.numeroTreno}`;
          connections.push({
            key,
            leg1:     { train: cand.train, depTime: depFromA },
            transfer: {
              stationId:   f.id as string,
              stationName: (f.stazione || cand.fermata.stazione) as string,
              arrTime:     cand.arrTime,
              depTime:     depTime,
              waitMin:     Math.round((depTime - cand.arrTime) / 60000),
              binEff:  (f.binarioEffettivoPartenzaDescrizione || f.binarioProgrammatoPartenzaDescrizione || null) as string|null,
              binProg: (f.binarioProgrammatoPartenzaDescrizione || null) as string|null,
            },
            leg2: { train: arrTrain, arrTime: arrAtB },
            totalMin: Math.round((arrAtB - depFromA) / 60000),
          });
        }
      }
    }

    connections.sort((a, b) => a.leg1.depTime - b.leg1.depTime || a.totalMin - b.totalMin);
    const seen = new Set<string>();
    const direct = connections.filter(c => {
      if (seen.has(c.key)) return false;
      seen.add(c.key);
      const leg1Key = String(c.leg1.train.numeroTreno);
      if (seen.has('leg1:' + leg1Key)) return false;
      seen.add('leg1:' + leg1Key);
      return true;
    });

    if (direct.length > 0) return direct;
    const allFermateEmpty = [...depDetails, ...arrDetails].every(d => d.fermate.length === 0);
    if (!allFermateEmpty) return direct;
    return searchHubFallback(date0, depMap, arrMap, from, to);
  }

  async function searchHubFallback(date0: Date, depMap: Map<string, Train>, arrMap: Map<string, Train>, from: Station, to: Station): Promise<ConnectionSolution[]> {
    const MIN_TRANSFER_MS = 10 * 60 * 1000;

    const hubsFromDep = new Map<string, Train[]>();
    depMap.forEach(t => {
      const dest = t.destinazione;
      if (!dest) return;
      if (!hubsFromDep.has(dest)) hubsFromDep.set(dest, []);
      hubsFromDep.get(dest)!.push(t);
    });

    const matchedHubs = new Map<string, { depTrains: Train[]; arrTrains: Train[]; codOrigine: string }>();
    arrMap.forEach(t => {
      const orig = t.origine;
      if (!orig || !hubsFromDep.has(orig) || !t.codOrigine) return;
      if (!matchedHubs.has(orig)) {
        matchedHubs.set(orig, { depTrains: hubsFromDep.get(orig)!, arrTrains: [], codOrigine: t.codOrigine });
      }
      matchedHubs.get(orig)!.arrTrains.push(t);
    });

    if (!matchedHubs.size) return [];

    const windows    = buildTimeWindows(date0);
    const arrWindows = buildArrivalWindows(date0);
    const connections: ConnectionSolution[] = [];

    for (const [hubName, { depTrains, arrTrains, codOrigine }] of matchedHubs) {
      const [hubDepsRaw, hubArrsRaw] = await Promise.all([
        Promise.all(windows.map(ts    => apiPartenze(codOrigine, ts))),
        Promise.all(arrWindows.map(ts => apiArrivi(codOrigine, ts))),
      ]);

      const hubDepByNum = new Map<string, Train>();
      hubDepsRaw.flat().forEach(t => { if (!t.numeroTreno) return; const k = String(t.numeroTreno); if (!hubDepByNum.has(k)) hubDepByNum.set(k, t); });
      const hubArrByNum = new Map<string, Train>();
      hubArrsRaw.flat().forEach(t => { if (!t.numeroTreno) return; const k = String(t.numeroTreno); if (!hubArrByNum.has(k)) hubArrByNum.set(k, t); });

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
            transfer: { stationId: codOrigine, stationName: hubName, arrTime: arrAtHub, depTime: depFromHub, waitMin: Math.round((depFromHub - arrAtHub) / 60000), binEff, binProg },
            leg2:     { train: leg2Train, arrTime: arrAtB },
            totalMin: Math.round((arrAtB - depFromA) / 60000),
          });
        }
      }
    }

    connections.sort((a, b) => a.leg1.depTime - b.leg1.depTime || a.totalMin - b.totalMin);
    const seen2 = new Set<string>();
    return connections.filter(c => {
      if (seen2.has(c.key)) return false;
      seen2.add(c.key);
      const leg1Key = String(c.leg1.train.numeroTreno);
      if (seen2.has('leg1:' + leg1Key)) return false;
      seen2.add('leg1:' + leg1Key);
      return true;
    });
  }

  async function fetchLeg(fromId: string, toId: string, date0Ts: number): Promise<Array<{ dep: Train; arr: Train; depTime: number; arrTime: number }>> {
    const date0 = new Date(date0Ts);
    const windows = [0, 60, 120, 180, 240, 300].map(d => viTimestamp(new Date(date0.getTime() + d * 60000)));
    const [depRes, arrRes] = await Promise.all([
      Promise.all(windows.map(ts => apiPartenze(fromId, ts))),
      Promise.all(windows.map(ts => apiArrivi(toId, ts))),
    ]);
    const depMap = new Map<string, Train>(), arrMap = new Map<string, Train>();
    depRes.flat().forEach(t => { const k = String(t.numeroTreno || ''); if (k && !depMap.has(k)) depMap.set(k, t); });
    arrRes.flat().forEach(t => { const k = String(t.numeroTreno || ''); if (k && !arrMap.has(k)) arrMap.set(k, t); });
    const out: Array<{ dep: Train; arr: Train; depTime: number; arrTime: number }> = [];
    depMap.forEach((dep, k) => {
      const arr = arrMap.get(k);
      if (!arr) return;
      const tDep = dep.orarioPartenza || dep.orarioPartenzaZero;
      const tArr = arr.orarioArrivo   || arr.orarioArrivoZero;
      if (tDep && tArr && tDep >= date0Ts && tDep < tArr)
        out.push({ dep, arr, depTime: tDep, arrTime: tArr });
    });
    out.sort((a, b) => a.depTime - b.depTime);
    return out;
  }

  async function buildChain4(chain: Station[], date0: Date, MIN_TRANSFER_MS: number): Promise<Connection2Solution[]> {
    const start = date0.getTime();
    const [leg1s, leg2s, leg3s] = await Promise.all([
      fetchLeg(chain[0].id, chain[1].id, start),
      fetchLeg(chain[1].id, chain[2].id, start),
      fetchLeg(chain[2].id, chain[3].id, start),
    ]);

    const connections: Connection2Solution[] = [];
    const seen = new Set<string>();

    for (const leg3 of leg3s) {
      const validLeg2 = leg2s.filter(l2 => l2.arrTime + MIN_TRANSFER_MS <= leg3.depTime);
      if (!validLeg2.length) continue;
      const bestLeg2 = validLeg2[validLeg2.length - 1];

      const validLeg1 = leg1s.filter(l1 => l1.arrTime + MIN_TRANSFER_MS <= bestLeg2.depTime);
      if (!validLeg1.length) continue;
      const bestLeg1 = validLeg1[validLeg1.length - 1];

      const key = `${bestLeg1.dep.numeroTreno}→${bestLeg2.dep.numeroTreno}→${leg3.dep.numeroTreno}`;
      if (seen.has(key)) continue;
      seen.add(key);

      connections.push({
        type:      '2hop',
        key,
        leg1:      { train: bestLeg1.dep, depTime: bestLeg1.depTime },
        transfer1: { stationId: chain[1].id, stationName: chain[1].name, arrTime: bestLeg1.arrTime, depTime: bestLeg2.depTime, waitMin: Math.round((bestLeg2.depTime - bestLeg1.arrTime) / 60000), arrObj: bestLeg1.arr },
        leg2:      { train: bestLeg2.dep },
        transfer2: { stationId: chain[2].id, stationName: chain[2].name, arrTime: bestLeg2.arrTime, depTime: leg3.depTime, waitMin: Math.round((leg3.depTime - bestLeg2.arrTime) / 60000), arrObj: bestLeg2.arr },
        leg3:      { train: leg3.arr, arrTime: leg3.arrTime },
        totalMin:  Math.round((leg3.arrTime - bestLeg1.depTime) / 60000),
      });
    }
    return connections;
  }

  async function loadPuter(): Promise<boolean> {
    if (typeof (window as unknown as Record<string, unknown>)['puter'] !== 'undefined') return true;
    return new Promise(resolve => {
      const s = document.createElement('script');
      s.src     = 'https://js.puter.com/v2/';
      s.onload  = () => resolve(true);
      s.onerror = () => resolve(false);
      document.head.appendChild(s);
    });
  }

  async function getAIHubs(date0: Date, from: Station, to: Station): Promise<string[]> {
    const ok = await loadPuter();
    if (!ok) return [];
    try {
      const puter = (window as unknown as Record<string, unknown>)['puter'] as { ai: { chat: (prompt: string, opts: unknown) => Promise<unknown> } };
      const timeStr = date0.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
      const dateStr = date0.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' });
      const prompt =
        `Sei un esperto di ferrovie italiane con conoscenza approfondita della rete Trenitalia/RFI, incluse le linee suburbane FL di Roma.\n\n` +
        `Devo viaggiare in treno da "${from.name}" a "${to.name}" il ${dateStr} con partenza intorno alle ${timeStr}.\n\n` +
        `Analizza il percorso e dimmi TUTTE le stazioni dove bisogna cambiare treno fisicamente, nell'ordine corretto.\n` +
        `Rispondi SOLO con i nomi esatti delle stazioni ferroviarie italiane, nell'ordine corretto del percorso, separati da virgola. ` +
        `Non includere "${from.name}" né "${to.name}". Nessun altro testo.`;
      const raw  = await puter.ai.chat(prompt, { model: 'gpt-4o-mini' });
      const text = typeof raw === 'string' ? raw : ((raw as Record<string, unknown>)?.message as Record<string, unknown>)?.content as string || (raw as Record<string, unknown>)?.content as string || '';
      return text.split(/[,\n]+/).map(s => s.trim().replace(/^[-•*\d.\s"']+|["'.\s]+$/g, '')).filter(s => s.length > 1);
    } catch { return []; }
  }

  async function searchAIGuided(date0: Date, from: Station, to: Station): Promise<Array<ConnectionSolution | Connection2Solution>> {
    const hubNames = await getAIHubs(date0, from, to);
    if (!hubNames.length) return [];

    const hubStations: Station[] = [];
    for (const name of hubNames) {
      const results = await apiStazioni(name);
      if (results.length) hubStations.push(results[0]);
    }
    if (!hubStations.length) return [];

    const MIN_TRANSFER_MS = 8 * 60 * 1000;
    let connections: Array<ConnectionSolution | Connection2Solution> = [];

    if (hubStations.length === 1) {
      const chain3: Station[] = [from, hubStations[0], to];
      const [leg1s, leg2s] = await Promise.all([
        fetchLeg(chain3[0].id, chain3[1].id, date0.getTime()),
        fetchLeg(chain3[1].id, chain3[2].id, date0.getTime()),
      ]);

      if (leg1s.length > 0) {
        for (const leg2 of leg2s) {
          const validLeg1 = leg1s.filter(l1 => l1.arrTime + MIN_TRANSFER_MS <= leg2.depTime);
          if (!validLeg1.length) continue;
          const bestLeg1 = validLeg1[validLeg1.length - 1];
          connections.push({
            key:      `${bestLeg1.dep.numeroTreno}→${leg2.dep.numeroTreno}`,
            leg1:     { train: bestLeg1.dep, depTime: bestLeg1.depTime },
            transfer: { stationId: chain3[1].id, stationName: chain3[1].name, arrTime: bestLeg1.arrTime, depTime: leg2.depTime, waitMin: Math.round((leg2.depTime - bestLeg1.arrTime) / 60000), binEff: null, binProg: null },
            leg2:     { train: leg2.arr, arrTime: leg2.arrTime },
            totalMin: Math.round((leg2.arrTime - bestLeg1.depTime) / 60000),
          } as ConnectionSolution);
        }
      } else {
        // Auto-expand: find terminals from departures
        const windows = buildTimeWindows(date0);
        const depResults = await Promise.all(windows.map(ts => apiPartenze(from.id, ts)));
        const destNames = [...new Set(depResults.flat().map(t => t.destinazione).filter(Boolean))];
        for (const name of destNames.slice(0, 4) as string[]) {
          const r = await apiStazioni(name);
          if (!r.length || r[0].id === hubStations[0].id) continue;
          const chain4: Station[] = [from, r[0], hubStations[0], to];
          const res = await buildChain4(chain4, date0, MIN_TRANSFER_MS);
          connections.push(...res);
          if (connections.length) break;
        }
      }
    } else if (hubStations.length >= 2) {
      const chain4: Station[] = [from, hubStations[0], hubStations[1], to];
      connections = await buildChain4(chain4, date0, MIN_TRANSFER_MS);
    }

    connections.sort((a, b) => a.leg1.depTime - b.leg1.depTime || a.totalMin - b.totalMin);
    const seen = new Set<string>();
    return connections.filter(c => { if (seen.has(c.key)) return false; seen.add(c.key); return true; });
  }

  async function search(from: Station, to: Station, date0: Date) {
    setLoading(true);
    setError(null);
    setResults([]);

    try {
      const directMatches = await searchDirect(date0, from, to);
      if (directMatches.length > 0) {
        shownKeys.current = new Set(directMatches.map(m => m.dep.numeroTreno + '|' + m.dep.dataPartenzaTreno));
        setResults(directMatches);
        setLoading(false);
        return;
      }

      // No direct trains - try connections
      let connections: Array<ConnectionSolution | Connection2Solution> = await searchWithConnections(date0, from, to);

      if (!connections.length) {
        connections = await searchAIGuided(date0, from, to);
      }

      if (connections.length > 0) {
        setResults(connections);
      } else {
        setError('Nessun treno trovato');
      }
    } catch {
      setError('Errore di caricamento');
    } finally {
      setLoading(false);
    }
  }

  async function loadMore(direction: 'prev' | 'next', anchorTs: number, from: Station, to: Station) {
    const baseDate = direction === 'prev' ? new Date(anchorTs - 3 * 60 * 60 * 1000) : new Date(anchorTs);
    const windows    = buildTimeWindows(baseDate);
    const arrWindows = buildArrivalWindows(baseDate);

    const [depResults, arrResults] = await Promise.all([
      Promise.all(windows.map(ts    => apiPartenze(from.id, ts))),
      Promise.all(arrWindows.map(ts => apiArrivi(to.id, ts))),
    ]);

    const depMap = new Map<string, Train>();
    depResults.flat().forEach(t => {
      if (!t.numeroTreno) return;
      const key = String(t.numeroTreno) + '|' + (t.dataPartenzaTreno ?? '');
      if (!depMap.has(key)) depMap.set(key, t);
    });
    const arrByNum = new Map<string, Train>();
    arrResults.flat().forEach(t => {
      if (!t.numeroTreno) return;
      if (!arrByNum.has(String(t.numeroTreno))) arrByNum.set(String(t.numeroTreno), t);
    });

    const newMatches: DirectMatch[] = [];
    depMap.forEach((dep, key) => {
      if (shownKeys.current.has(key)) return;
      const arr = arrByNum.get(String(dep.numeroTreno));
      if (!arr) return;
      const tDep = dep.orarioPartenza || dep.orarioPartenzaZero;
      const tArr = arr.orarioArrivo   || arr.orarioArrivoZero;
      if (!tDep || !tArr || tDep >= tArr) return;
      if (direction === 'prev' && tDep >= anchorTs) return;
      if (direction === 'next' && tDep <= anchorTs) return;
      newMatches.push({ dep, arr });
    });

    newMatches.sort((a, b) =>
      (a.dep.orarioPartenza || a.dep.orarioPartenzaZero || 0) -
      (b.dep.orarioPartenza || b.dep.orarioPartenzaZero || 0)
    );
    newMatches.forEach(m => shownKeys.current.add(m.dep.numeroTreno + '|' + m.dep.dataPartenzaTreno));

    if (direction === 'prev') {
      setResults(prev => [...newMatches, ...prev]);
    } else {
      setResults(prev => [...prev, ...newMatches]);
    }
    return newMatches.length;
  }

  return { search, loadMore, results, loading, error };
}

'use client';
/* eslint-disable @typescript-eslint/no-explicit-any */

import { useState, useRef } from 'react';
import type { Station, Train, ConnectionSolution, Connection2Solution, DirectMatch } from '@/lib/types';
import { buildTimeWindows, buildArrivalWindows } from '@/lib/viTimestamp';
import {
  getDepartures, getArrivals, getTrainDetails, searchStationsAPI,
  fetchLeg, buildChain4, getAIHubs,
} from '@/lib/routeHelpers';

export type ResultState =
  | { kind: 'idle' }
  | { kind: 'loading'; message: string }
  | { kind: 'error'; message: string }
  | { kind: 'empty' }
  | { kind: 'direct'; matches: DirectMatch[]; firstTs: number; lastTs: number; fromName: string; toName: string }
  | { kind: 'connections'; connections: (ConnectionSolution | Connection2Solution)[]; fromName: string; toName: string };

export function useItinerarioSearch(showToast: (msg: string) => void) {
  const [result, setResult]             = useState<ResultState>({ kind: 'idle' });
  const [prevBtnState, setPrevBtnState] = useState<'idle' | 'loading' | 'done'>('idle');
  const [nextBtnState, setNextBtnState] = useState<'idle' | 'loading' | 'done'>('idle');

  const firstTsRef     = useRef(0);
  const lastTsRef      = useRef(0);
  const shownRouteKeys = useRef(new Set<string>());
  const currentFromRef = useRef<Station | null>(null);
  const currentToRef   = useRef<Station | null>(null);

  function resetNavState() {
    shownRouteKeys.current = new Set();
    setPrevBtnState('idle');
    setNextBtnState('idle');
  }

  // ─── searchRouteWithConnections ──────────────────────────────────────────

  async function searchRouteWithConnections(date0: Date, from: Station, to: Station): Promise<ConnectionSolution[]> {
    const windows    = buildTimeWindows(date0);
    const arrWindows = buildArrivalWindows(date0);

    const [depResults, arrResults] = await Promise.all([
      Promise.all(windows.map(ts    => getDepartures(from.id, ts))),
      Promise.all(arrWindows.map(ts => getArrivals(to.id, ts))),
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
        getTrainDetails(t.codOrigine, t.numeroTreno, t.dataPartenzaTreno)
          .then((d: any) => ({ train: t, fermate: d?.fermate || [] as any[] }))
          .catch(() => ({ train: t, fermate: [] as any[] }))
      )),
      Promise.all([...arrMap.values()].map(t =>
        getTrainDetails(t.codOrigine, t.numeroTreno, t.dataPartenzaTreno)
          .then((d: any) => ({ train: t, fermate: d?.fermate || [] as any[] }))
          .catch(() => ({ train: t, fermate: [] as any[] }))
      )),
    ]);

    const transferFromMap = new Map<string, { train: Train; fermata: any; arrTime: number }[]>();
    for (const { train, fermate } of depDetails) {
      const fromIdx = (fermate as any[]).findIndex((f: any) => f.id === from.id);
      if (fromIdx < 0) continue;
      for (let i = fromIdx + 1; i < fermate.length; i++) {
        const f = (fermate as any[])[i];
        if (!f.id) continue;
        const arrTime = f.effettivaArrivo || f.programmataArrivo || f.arrivo_teorico || f.programmata;
        if (!arrTime) continue;
        if (!transferFromMap.has(f.id)) transferFromMap.set(f.id, []);
        transferFromMap.get(f.id)!.push({ train, fermata: f, arrTime });
      }
    }

    const MIN_TRANSFER_MS = 5 * 60 * 1000;
    const connections: ConnectionSolution[] = [];

    for (const { train: arrTrain, fermate } of arrDetails) {
      const toIdx = (fermate as any[]).findIndex((f: any) => f.id === to.id);
      if (toIdx <= 0) continue;
      for (let i = 0; i < toIdx; i++) {
        const f = (fermate as any[])[i];
        if (!f.id || !transferFromMap.has(f.id)) continue;
        const depTime = f.effettivaPartenza || f.programmataPartenza || f.partenza_teorica || f.programmata;
        if (!depTime) continue;

        const candidates = transferFromMap.get(f.id)!.filter(c => c.arrTime + MIN_TRANSFER_MS <= depTime);
        for (const cand of candidates) {
          const depFromA = cand.train.orarioPartenza || cand.train.orarioPartenzaZero;
          const arrAtB   = arrTrain.orarioArrivo || arrTrain.orarioArrivoZero;
          if (!depFromA || !arrAtB) continue;
          const key = `${cand.train.numeroTreno}→${arrTrain.numeroTreno}`;
          connections.push({
            key,
            leg1: { train: cand.train, depTime: depFromA },
            transfer: {
              stationId: f.id, stationName: f.stazione || cand.fermata.stazione,
              arrTime: cand.arrTime, depTime,
              waitMin: Math.round((depTime - cand.arrTime) / 60000),
              binEff:  f.binarioEffettivoPartenzaDescrizione || f.binarioProgrammatoPartenzaDescrizione || null,
              binProg: f.binarioProgrammatoPartenzaDescrizione || null,
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
      const leg1Key = 'leg1:' + String(c.leg1.train.numeroTreno);
      if (seen.has(leg1Key)) return false;
      seen.add(leg1Key);
      return true;
    });

    if (direct.length > 0) return direct;
    const allFermateEmpty = [...depDetails, ...arrDetails].every(d => d.fermate.length === 0);
    if (!allFermateEmpty) return direct;
    return searchRouteHubFallback(date0, depMap, arrMap, from, to);
  }

  // ─── searchRouteHubFallback ──────────────────────────────────────────────

  async function searchRouteHubFallback(
    date0: Date,
    depMap: Map<string, Train>,
    arrMap: Map<string, Train>,
    from: Station,
    to: Station
  ): Promise<ConnectionSolution[]> {
    const MIN_TRANSFER_MS = 10 * 60 * 1000;
    const windows    = buildTimeWindows(date0);
    const arrWindows = buildArrivalWindows(date0);

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

    const connections: ConnectionSolution[] = [];

    for (const [hubName, { depTrains, arrTrains, codOrigine }] of matchedHubs) {
      const hubDepsRaw = await Promise.all(windows.map(ts    => getDepartures(codOrigine, ts)));
      const hubArrsRaw = await Promise.all(arrWindows.map(ts => getArrivals(codOrigine, ts)));

      const hubDepByNum = new Map<string, Train>();
      hubDepsRaw.flat().forEach(t => {
        if (!t.numeroTreno) return;
        const k = String(t.numeroTreno);
        if (!hubDepByNum.has(k)) hubDepByNum.set(k, t);
      });
      const hubArrByNum = new Map<string, Train>();
      hubArrsRaw.flat().forEach(t => {
        if (!t.numeroTreno) return;
        const k = String(t.numeroTreno);
        if (!hubArrByNum.has(k)) hubArrByNum.set(k, t);
      });

      for (const leg1Train of depTrains) {
        const hubArrTrain = hubArrByNum.get(String(leg1Train.numeroTreno));
        const arrAtHub    = hubArrTrain?.orarioArrivo || hubArrTrain?.orarioArrivoZero;
        if (!arrAtHub) continue;

        for (const leg2Train of arrTrains) {
          const hubDepTrain = hubDepByNum.get(String(leg2Train.numeroTreno));
          const depFromHub  = hubDepTrain?.orarioPartenza || hubDepTrain?.orarioPartenzaZero;
          if (!depFromHub) continue;

          const depFromA = leg1Train.orarioPartenza || leg1Train.orarioPartenzaZero;
          const arrAtB   = leg2Train.orarioArrivo  || leg2Train.orarioArrivoZero;
          if (!depFromA || !arrAtB) continue;
          if (arrAtHub + MIN_TRANSFER_MS > depFromHub) continue;
          if (depFromA >= arrAtHub || depFromHub >= arrAtB) continue;

          connections.push({
            key: `${leg1Train.numeroTreno}→${leg2Train.numeroTreno}`,
            leg1: { train: leg1Train, depTime: depFromA },
            transfer: {
              stationId: codOrigine, stationName: hubName,
              arrTime: arrAtHub, depTime: depFromHub,
              waitMin: Math.round((depFromHub - arrAtHub) / 60000),
              binEff:  hubDepTrain!.binarioEffettivoPartenzaDescrizione || hubDepTrain!.binarioProgrammatoPartenzaDescrizione || null,
              binProg: hubDepTrain!.binarioProgrammatoPartenzaDescrizione || null,
            },
            leg2: { train: leg2Train, arrTime: arrAtB },
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
      const leg1Key = 'leg1:' + String(c.leg1.train.numeroTreno);
      if (seen2.has(leg1Key)) return false;
      seen2.add(leg1Key);
      return true;
    });
  }

  // ─── searchRouteAIGuided ─────────────────────────────────────────────────

  async function searchRouteAIGuided(date0: Date, from: Station, to: Station): Promise<(ConnectionSolution | Connection2Solution)[]> {
    const hubNames = await getAIHubs(date0, from.name, to.name);
    if (!hubNames.length) { console.warn("[AI] nessun hub dall'AI"); return []; }

    const resolved = await Promise.all(
      hubNames.map(name => searchStationsAPI(name).then(r => r[0] ?? null).catch(() => null))
    );
    const hubStations = resolved.filter((s): s is Station =>
      s !== null && s.id !== from.id && s.id !== to.id
    );
    hubNames.forEach((name, i) => {
      if (resolved[i]) console.log(`[AI] hub "${name}" → ${resolved[i]!.id} (${resolved[i]!.name})`);
      else             console.warn(`[AI] nessuna stazione trovata per "${name}"`);
    });
    if (!hubStations.length) return [];

    const MIN_TRANSFER_MS = 8 * 60 * 1000;
    const dedup = (conns: (ConnectionSolution | Connection2Solution)[]) => {
      conns.sort((a, b) => a.leg1.depTime - b.leg1.depTime || a.totalMin - b.totalMin);
      const seen = new Set<string>();
      return conns.filter(c => { if (seen.has(c.key)) return false; seen.add(c.key); return true; });
    };

    for (const hub of hubStations) {
      console.log(`[AI] provo 1-hub: ${from.name} → ${hub.name} → ${to.name}`);
      const leg1s = await fetchLeg(from.id, hub.id, date0.getTime());
      if (!leg1s.length) { console.log(`[AI]   nessun treno ${from.name}→${hub.name}`); continue; }
      const minHubArr = leg1s[0].arrTime;
      const leg2s = await fetchLeg(hub.id, to.id, minHubArr - MIN_TRANSFER_MS);
      const conns: ConnectionSolution[] = [];
      const fmt = (ts: number) => new Date(ts).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
      let bestMatch = 0;
      for (const leg2 of leg2s) {
        const valid1 = leg1s.filter(l1 => l1.arrTime + MIN_TRANSFER_MS <= leg2.depTime);
        if (!valid1.length) {
          const gaps = leg1s.map(l1 => `arr=${fmt(l1.arrTime)} gap=${Math.round((leg2.depTime - l1.arrTime) / 60000)}min`);
          if (leg2s.indexOf(leg2) === 0) console.log(`[AI]   leg2 dep=${fmt(leg2.depTime)}: ${gaps.join(' | ')}`);
          continue;
        }
        bestMatch++;
        const best1 = valid1[valid1.length - 1];
        conns.push({
          key: `${best1.dep.numeroTreno}→${leg2.dep.numeroTreno}`,
          leg1: { train: best1.dep, depTime: best1.depTime },
          transfer: {
            stationId: hub.id, stationName: hub.name,
            arrTime: best1.arrTime, depTime: leg2.depTime,
            waitMin: Math.round((leg2.depTime - best1.arrTime) / 60000),
            binEff: null, binProg: null,
          },
          leg2: { train: leg2.arr, arrTime: leg2.arrTime },
          totalMin: Math.round((leg2.arrTime - best1.depTime) / 60000),
        } as ConnectionSolution);
      }
      console.log(`[AI]   hub ${hub.name}: ${conns.length} coincidenze (${bestMatch}/${leg2s.length} leg2 valide)`);
      if (conns.length) {
        console.log(`[AI] trovate ${conns.length} coincidenze con hub ${hub.name}`);
        return dedup(conns);
      }
    }

    for (let i = 0; i < hubStations.length - 1; i++) {
      for (let j = i + 1; j < hubStations.length; j++) {
        const chain4 = [from, hubStations[i], hubStations[j], to];
        console.log(`[AI] provo 2-hub: ${chain4.map(s => s.name).join(' → ')}`);
        const conns = await buildChain4(chain4, date0, MIN_TRANSFER_MS);
        if (conns.length) {
          console.log(`[AI] trovate ${conns.length} coincidenze con hubs ${hubStations[i].name}/${hubStations[j].name}`);
          return dedup(conns);
        }
      }
    }
    return [];
  }

  // ─── doSearchRouteWithVia ─────────────────────────────────────────────────

  async function doSearchRouteWithVia(from: Station, via: Station[], to: Station, date0: Date) {
    const MIN_TRANSFER_MS = 8 * 60 * 1000;
    const chain = [from, ...via, to];
    setResult({ kind: 'loading', message: `Ricerca con cambio in ${via.map(s => s.name).join(' → ')}…` });
    resetNavState();
    currentFromRef.current = from;
    currentToRef.current   = to;

    try {
      let connections: (ConnectionSolution | Connection2Solution)[] = [];

      if (via.length === 1) {
        const leg1s = await fetchLeg(chain[0].id, chain[1].id, date0.getTime());
        const minViaArr = leg1s.length ? leg1s[0].arrTime : date0.getTime();
        const leg2s = await fetchLeg(chain[1].id, chain[2].id, minViaArr - MIN_TRANSFER_MS);
        for (const leg2 of leg2s) {
          const valid1 = leg1s.filter(l1 => l1.arrTime + MIN_TRANSFER_MS <= leg2.depTime);
          if (!valid1.length) continue;
          const best1 = valid1[valid1.length - 1];
          connections.push({
            key: `${best1.dep.numeroTreno}\u2192${leg2.dep.numeroTreno}`,
            leg1: { train: best1.dep, depTime: best1.depTime },
            transfer: {
              stationId: chain[1].id, stationName: chain[1].name,
              arrTime: best1.arrTime, depTime: leg2.depTime,
              waitMin: Math.round((leg2.depTime - best1.arrTime) / 60000),
              binEff: null, binProg: null,
            },
            leg2: { train: leg2.arr, arrTime: leg2.arrTime },
            totalMin: Math.round((leg2.arrTime - best1.depTime) / 60000),
          } as ConnectionSolution);
        }
      } else {
        connections = await buildChain4([from, via[0], via[1], to], date0, MIN_TRANSFER_MS);
      }

      connections.sort((a, b) => a.leg1.depTime - b.leg1.depTime || a.totalMin - b.totalMin);
      const seen = new Set<string>();
      connections = connections.filter(c => { if (seen.has(c.key)) return false; seen.add(c.key); return true; });

      if (connections.length) {
        setResult({ kind: 'connections', connections, fromName: from.name, toName: to.name });
        return;
      }
    } catch { /* fallback below */ }

    await doSearchRoute(from, to, date0);
  }

  // ─── doSearchRoute ────────────────────────────────────────────────────────

  async function doSearchRoute(from: Station, to: Station, date0: Date) {
    setResult({ kind: 'loading', message: 'Ricerca treni…' });
    resetNavState();
    currentFromRef.current = from;
    currentToRef.current   = to;

    try {
      const windows    = buildTimeWindows(date0);
      const arrWindows = buildArrivalWindows(date0);

      const [depResults, arrResults] = await Promise.all([
        Promise.all(windows.map(ts    => getDepartures(from.id, ts))),
        Promise.all(arrWindows.map(ts => getArrivals(to.id, ts))),
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
        const tArr = arr.orarioArrivo  || arr.orarioArrivoZero;
        if (tDep && tArr && tDep < tArr) matches.push({ dep, arr });
      });
      matches.sort((a, b) =>
        (a.dep.orarioPartenza || a.dep.orarioPartenzaZero || 0) -
        (b.dep.orarioPartenza || b.dep.orarioPartenzaZero || 0)
      );

      if (!matches.length) {
        setResult({ kind: 'loading', message: 'Nessun treno diretto — cerco coincidenze…' });
        let conns: (ConnectionSolution | Connection2Solution)[] = [];
        try { conns = await searchRouteWithConnections(date0, from, to); } catch (err) { console.error('searchRouteWithConnections error:', err); }

        if (!conns.length) {
          setResult({ kind: 'loading', message: "Nessuna coincidenza trovata — chiedo all'AI…" });
          try { conns = await searchRouteAIGuided(date0, from, to); } catch (err) { console.error('searchRouteAIGuided error:', err); }
        }

        if (!conns.length) { setResult({ kind: 'empty' }); return; }
        setResult({ kind: 'connections', connections: conns, fromName: from.name, toName: to.name });
        return;
      }

      shownRouteKeys.current = new Set(
        matches.map(m => String(m.dep.numeroTreno) + '|' + (m.dep.dataPartenzaTreno ?? ''))
      );
      const fTs = matches[0].dep.orarioPartenza || matches[0].dep.orarioPartenzaZero || 0;
      const lTs = matches[matches.length - 1].dep.orarioPartenza || matches[matches.length - 1].dep.orarioPartenzaZero || 0;
      firstTsRef.current = fTs;
      lastTsRef.current  = lTs;
      setResult({ kind: 'direct', matches, firstTs: fTs, lastTs: lTs, fromName: from.name, toName: to.name });
    } catch {
      setResult({ kind: 'error', message: 'Errore di caricamento' });
      showToast('Impossibile caricare i treni');
    }
  }

  // ─── loadMoreRoute ────────────────────────────────────────────────────────

  async function loadMoreRoute(direction: 'prev' | 'next') {
    const routeFrom = currentFromRef.current;
    const routeTo   = currentToRef.current;
    if (!routeFrom || !routeTo) return;

    const anchorTs    = direction === 'prev' ? firstTsRef.current : lastTsRef.current;
    const setBtnState = direction === 'prev' ? setPrevBtnState : setNextBtnState;
    setBtnState('loading');

    try {
      const baseDate   = direction === 'prev' ? new Date(anchorTs - 3 * 60 * 60 * 1000) : new Date(anchorTs);
      const windows    = buildTimeWindows(baseDate);
      const arrWindows = buildArrivalWindows(baseDate);

      const [depResults, arrResults] = await Promise.all([
        Promise.all(windows.map(ts    => getDepartures(routeFrom.id, ts))),
        Promise.all(arrWindows.map(ts => getArrivals(routeTo.id, ts))),
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
        if (shownRouteKeys.current.has(key)) return;
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
        (a.dep.orarioPartenza || a.dep.orarioPartenzaZero || 0) -
        (b.dep.orarioPartenza || b.dep.orarioPartenzaZero || 0)
      );
      newMatches.forEach(m =>
        shownRouteKeys.current.add(String(m.dep.numeroTreno) + '|' + (m.dep.dataPartenzaTreno ?? ''))
      );

      if (!newMatches.length) { setBtnState('done'); return; }

      setBtnState('idle');
      const newAnchorTs = direction === 'prev'
        ? (newMatches[0].dep.orarioPartenza || newMatches[0].dep.orarioPartenzaZero || 0)
        : (newMatches[newMatches.length - 1].dep.orarioPartenza || newMatches[newMatches.length - 1].dep.orarioPartenzaZero || 0);
      if (direction === 'prev') firstTsRef.current = newAnchorTs;
      else lastTsRef.current = newAnchorTs;

      setResult(prev => {
        if (prev.kind !== 'direct') return prev;
        const updated = direction === 'prev'
          ? [...newMatches, ...prev.matches]
          : [...prev.matches, ...newMatches];
        return {
          ...prev,
          matches: updated,
          firstTs: direction === 'prev' ? newAnchorTs : prev.firstTs,
          lastTs:  direction === 'next' ? newAnchorTs : prev.lastTs,
        };
      });
    } catch {
      setBtnState('idle');
      showToast('Errore nel caricamento');
    }
  }

  return { result, prevBtnState, nextBtnState, doSearchRoute, doSearchRouteWithVia, loadMoreRoute };
}

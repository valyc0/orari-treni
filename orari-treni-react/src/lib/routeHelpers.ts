'use client';
/* eslint-disable @typescript-eslint/no-explicit-any */

import type { Station, Train, Connection2Solution } from '@/lib/types';
import { viTimestamp, buildTimeWindows } from '@/lib/viTimestamp';

// ─── puter.js lazy loader ────────────────────────────────────────────────────

declare const puter: any;
let puterLoading = false;

export async function loadPuter(): Promise<boolean> {
  if (typeof puter !== 'undefined') return true;
  if (puterLoading) return false;
  puterLoading = true;
  return new Promise(resolve => {
    const s = document.createElement('script');
    s.src = 'https://js.puter.com/v2/';
    s.onload = () => resolve(true);
    s.onerror = () => { puterLoading = false; resolve(false); };
    document.head.appendChild(s);
  });
}

// ─── API helpers ─────────────────────────────────────────────────────────────

export async function getDepartures(id: string, ts: string): Promise<Train[]> {
  try {
    const r = await fetch(`/api/partenze?id=${encodeURIComponent(id)}&ts=${encodeURIComponent(ts)}`);
    if (!r.ok) return [];
    return r.json();
  } catch { return []; }
}

export async function getArrivals(id: string, ts: string): Promise<Train[]> {
  try {
    const r = await fetch(`/api/arrivi?id=${encodeURIComponent(id)}&ts=${encodeURIComponent(ts)}`);
    if (!r.ok) return [];
    return r.json();
  } catch { return []; }
}

export async function getTrainDetails(cod: string, num: string | number, date: string | number): Promise<any> {
  try {
    const r = await fetch(
      `/api/treno?cod=${encodeURIComponent(cod)}&num=${encodeURIComponent(num)}&date=${encodeURIComponent(date)}`
    );
    if (!r.ok) return null;
    return r.json();
  } catch { return null; }
}

export async function searchStationsAPI(q: string): Promise<Station[]> {
  try {
    const r = await fetch(`/api/stazioni?q=${encodeURIComponent(q)}`);
    if (!r.ok) return [];
    return r.json();
  } catch { return []; }
}

// ─── fetchLeg ────────────────────────────────────────────────────────────────

export async function fetchLeg(fromId: string, toId: string, date0Ts: number) {
  const windows = [0, 60, 120, 180, 240, 300].map(d =>
    viTimestamp(new Date(date0Ts + d * 60000))
  );
  const [depRes, arrRes] = await Promise.all([
    Promise.all(windows.map(ts => getDepartures(fromId, ts))),
    Promise.all(windows.map(ts => getArrivals(toId, ts))),
  ]);
  const depMap = new Map<string, Train>();
  const arrMap = new Map<string, Train>();
  depRes.flat().forEach(t => {
    const k = String(t.numeroTreno || '');
    if (k && !depMap.has(k)) depMap.set(k, t);
  });
  arrRes.flat().forEach(t => {
    const k = String(t.numeroTreno || '');
    if (k && !arrMap.has(k)) arrMap.set(k, t);
  });
  const out: { dep: Train; arr: Train; depTime: number; arrTime: number }[] = [];
  depMap.forEach((dep, k) => {
    const arr = arrMap.get(k);
    if (!arr) return;
    if (!arr.codOrigine && dep.codOrigine) arr.codOrigine = dep.codOrigine;
    if (!arr.dataPartenzaTreno && dep.dataPartenzaTreno) arr.dataPartenzaTreno = dep.dataPartenzaTreno;
    const tDep = dep.orarioPartenza || dep.orarioPartenzaZero;
    const tArr = arr.orarioArrivo  || arr.orarioArrivoZero;
    if (tDep && tArr && tDep >= date0Ts && tDep < tArr)
      out.push({ dep, arr, depTime: tDep, arrTime: tArr });
  });
  out.sort((a, b) => a.depTime - b.depTime);
  console.log(`[AI] fetchLeg ${fromId}→${toId}: ${out.length} treni`);
  if (out.length > 0) {
    const fmt = (ts: number) => new Date(ts).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
    console.log(`[AI]   dep:${fmt(out[0].depTime)} arr:${fmt(out[0].arrTime)} (primo), dep:${fmt(out[out.length-1].depTime)} arr:${fmt(out[out.length-1].arrTime)} (ultimo)`);
  } else {
    let matched = 0, noArr = 0, badTime = 0;
    depMap.forEach((dep, k) => {
      const arr = arrMap.get(k);
      if (!arr) { noArr++; return; }
      matched++;
      const tDep = dep.orarioPartenza || dep.orarioPartenzaZero;
      const tArr = arr.orarioArrivo  || arr.orarioArrivoZero;
      if (!tDep || !tArr || tDep < date0Ts || tDep >= tArr) badTime++;
    });
    console.log(`[AI]   diagnosi: depMap=${depMap.size} arrMap=${arrMap.size} matched=${matched} noArr=${noArr} badTime=${badTime}`);
  }
  return out;
}

// ─── buildChain4 ─────────────────────────────────────────────────────────────

export async function buildChain4(
  chain: Station[],
  date0: Date,
  MIN_TRANSFER_MS: number
): Promise<Connection2Solution[]> {
  const start = date0.getTime();
  const leg1s = await fetchLeg(chain[0].id, chain[1].id, start);
  if (!leg1s.length) { console.log('[AI] buildChain4: nessun treno leg1'); return []; }
  const hub1ArrTs = leg1s[0].arrTime - MIN_TRANSFER_MS;
  const leg2s = await fetchLeg(chain[1].id, chain[2].id, hub1ArrTs);
  if (!leg2s.length) { console.log('[AI] buildChain4: nessun treno leg2'); return []; }
  const hub2ArrTs = leg2s[0].arrTime - MIN_TRANSFER_MS;
  const leg3s = await fetchLeg(chain[2].id, chain[3].id, hub2ArrTs);
  console.log(`[AI] buildChain4 leg1:${leg1s.length} leg2:${leg2s.length} leg3:${leg3s.length}`);

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
      type: '2hop',
      key,
      leg1: { train: bestLeg1.dep, depTime: bestLeg1.depTime },
      transfer1: {
        stationId: chain[1].id, stationName: chain[1].name,
        arrTime: bestLeg1.arrTime, depTime: bestLeg2.depTime,
        waitMin: Math.round((bestLeg2.depTime - bestLeg1.arrTime) / 60000),
        arrObj: bestLeg1.arr,
      },
      leg2: { train: bestLeg2.dep },
      transfer2: {
        stationId: chain[2].id, stationName: chain[2].name,
        arrTime: bestLeg2.arrTime, depTime: leg3.depTime,
        waitMin: Math.round((leg3.depTime - bestLeg2.arrTime) / 60000),
        arrObj: bestLeg2.arr,
      },
      leg3: { train: leg3.arr, arrTime: leg3.arrTime },
      totalMin: Math.round((leg3.arrTime - bestLeg1.depTime) / 60000),
    });
  }
  return connections;
}

// ─── getTerminalHubsFromDeps ─────────────────────────────────────────────────

export async function getTerminalHubsFromDeps(date0: Date, fromId: string): Promise<Station[]> {
  const windows = buildTimeWindows(date0);
  const depResults = await Promise.all(windows.map(ts => getDepartures(fromId, ts)));
  const destNames = [...new Set(depResults.flat().map(t => t.destinazione).filter(Boolean) as string[])];
  console.log('[AI] terminali di partenza trovati:', destNames);
  const stations: Station[] = [];
  for (const name of destNames.slice(0, 4)) {
    const r = await searchStationsAPI(name).catch(() => [] as Station[]);
    if (r.length) stations.push(r[0]);
  }
  return stations;
}

// ─── getAIHubs ───────────────────────────────────────────────────────────────

export async function getAIHubs(date0: Date, fromName: string, toName: string): Promise<string[]> {
  const ok = await loadPuter();
  if (!ok) { console.warn('[AI] puter.js non caricato'); return []; }
  try {
    const tStr = date0.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
    const dStr = date0.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' });
    const prompt =
      `Sei un esperto di ferrovie italiane con conoscenza approfondita della rete ` +
      `Trenitalia/RFI, incluse le linee suburbane FL di Roma.\n\n` +
      `Devo viaggiare in treno da "${fromName}" a "${toName}"` +
      ` il ${dStr} con partenza intorno alle ${tStr}.\n\n` +
      `Analizza il percorso e dimmi TUTTE le stazioni dove bisogna cambiare treno fisicamente, ` +
      `nell'ordine corretto. Tieni conto che:\n` +
      `- Le linee suburbane FL1-FL8 di Roma hanno stazioni terminali specifiche ` +
      `(es. FL1 termina a Roma Ostiense, non a Roma Termini)\n` +
      `- Se serve un trasferimento tra stazioni diverse (es. Roma Ostiense → Roma Termini), ` +
      `elenca ENTRAMBE come stazioni di cambio separate\n` +
      `- Includi anche stazioni intermedie minori se il cambio fisico avviene lì\n\n` +
      `Rispondi SOLO con i nomi esatti delle stazioni ferroviarie italiane, ` +
      `nell'ordine corretto del percorso, separati da virgola. ` +
      `Non includere "${fromName}" né "${toName}". ` +
      `Nessun altro testo, solo i nomi delle stazioni.`;
    const raw = await puter.ai.chat(prompt, { model: 'gpt-4o-mini' });
    const text = typeof raw === 'string' ? raw : (raw?.message?.content || raw?.content || '');
    console.log('[AI] risposta grezza:', text);
    const names: string[] = text
      .split(/[,\n]+/)
      .map((s: string) => s.trim().replace(/^[-•*\d.\s"']+|["'.\s]+$/g, ''))
      .filter((s: string) => s.length > 1);
    console.log('[AI] hub parsati:', names);
    return names;
  } catch (err) {
    console.error('[AI] errore getAIHubs:', err);
    return [];
  }
}

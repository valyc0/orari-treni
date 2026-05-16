'use client';
import { useEffect, useRef, useState } from 'react';
import type { TrattaCardData, TrainDetails } from '@/lib/types';
import { formatTime } from '@/lib/utils';
import { getCatColors } from '@/lib/catColors';

interface Props {
  data: TrattaCardData | null;
  open: boolean;
  onClose: () => void;
  showToast: (msg: string) => void;
}

const REFRESH_S = 30;

function esc(s: unknown): string {
  if (s == null) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

async function loadTrainDetails(cod: string, num: string, date: string): Promise<TrainDetails | null> {
  const url = `/api/treno?cod=${encodeURIComponent(cod)}&num=${encodeURIComponent(num)}&date=${encodeURIComponent(date)}`;
  console.log('[TrattaModal] loadTrainDetails url:', url);
  try {
    const res = await fetch(url);
    console.log('[TrattaModal] loadTrainDetails status:', res.status);
    const json = await res.json();
    console.log('[TrattaModal] loadTrainDetails result:', json);
    if (json) return json;
    // Treni notturni: dataPartenzaTreno è mezzanotte del giorno precedente alla stazione d'origine
    const dateNum = Number(date);
    if (!dateNum) return null;
    const prevDate = String(dateNum - 86400000);
    const url2 = `/api/treno?cod=${encodeURIComponent(cod)}&num=${encodeURIComponent(num)}&date=${encodeURIComponent(prevDate)}`;
    console.log('[TrattaModal] loadTrainDetails retry prev day:', url2);
    const res2 = await fetch(url2);
    const json2 = await res2.json();
    console.log('[TrattaModal] loadTrainDetails retry result:', json2);
    return json2;
  } catch (e) { console.error('[TrattaModal] loadTrainDetails error:', e); return null; }
}

function renderFermate(data: TrainDetails, fromName: string, toName: string, depTs: number): string {
  if (!data) return '<p class="text-center text-muted py-4">Nessuna fermata disponibile</p>';
  const fermate = data.fermate || [];
  if (!fermate.length) return '<p class="text-center text-muted py-4">Nessuna fermata disponibile</p>';

  const ritardo    = data.ritardo || 0;
  const ultimaStaz = data.stazioneUltimoRilevamento || '';
  const ultimaOra  = data.oraUltimoRilevamento ? formatTime(new Date(data.oraUltimoRilevamento)) : '';

  let lastPassedIdx = -1;
  fermate.forEach((f, i) => {
    if (f.actualFermataType === 1 || f.actualFermataType === 2 || f.effettiva || f.arrivoReale || f.partenzaReale) lastPassedIdx = i;
  });
  const now = Date.now();
  const delayMs = (ritardo || 0) * 60000;
  fermate.forEach((f, i) => {
    if (i <= lastPassedIdx) return;
    const oraProg = f.programmata || f.arrivo_teorico || f.partenza_teorica;
    if (oraProg && (oraProg + delayMs) < now) lastPassedIdx = i;
  });

  const norm     = (s: string) => (s || '').trim().toLowerCase();
  const fromNorm = norm(fromName);
  const toNorm   = norm(toName);
  const fromIdx  = fermate.findIndex(f => norm(f.stazione).includes(fromNorm) || fromNorm.includes(norm(f.stazione)));
  const toIdx    = fermate.findIndex(f => norm(f.stazione).includes(toNorm)   || toNorm.includes(norm(f.stazione)));

  if (fromIdx >= 0 && depTs > 0 && (depTs + delayMs) < now) {
    lastPassedIdx = Math.max(lastPassedIdx, fromIdx);
  }

  let html = '';

  if (fermate.length >= 2) {
    const capoInizio = fermate[0];
    const capoFine   = fermate[fermate.length - 1];
    const oraInizio  = capoInizio.partenza_teorica || capoInizio.programmata;
    const oraFine    = capoFine.arrivo_teorico || capoFine.programmata;
    html += `<div class="px-3 py-2 border-bottom" style="background:rgba(26,86,219,.04)">
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
    html += `<div class="px-3 py-2 border-bottom d-flex align-items-center gap-2 flex-wrap">
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

    let dotColor: string, lineColor: string, dotSize: number;
    if (isFrom)       { dotColor = '#1a56db'; lineColor = '#1a56db'; dotSize = 14; }
    else if (isTo)    { dotColor = '#dc3545'; lineColor = isPassed ? '#6c757d' : '#ced4da'; dotSize = 14; }
    else if (inRoute) { dotColor = isPassed ? '#6c757d' : '#1a56db'; lineColor = isPassed ? '#6c757d' : '#1a56db'; dotSize = 8; }
    else              { dotColor = isPassed ? '#6c757d' : '#ced4da'; lineColor = isPassed ? '#6c757d' : '#ced4da'; dotSize = 8; }
    if (isCurrent) { dotColor = '#1a56db'; dotSize = 14; }

    let nameCls: string, timeStyle: string;
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

    html += `<div class="d-flex gap-2 align-items-stretch" style="min-height:${isLast ? 'auto' : '48px'}">
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

const NO_DATA_LEG = `<div class="px-3 py-3 text-center text-muted small"><i class="bi bi-exclamation-circle me-1"></i>Dati non ancora disponibili</div>`;

function renderFermateWithConnection(data1: TrainDetails, data2: TrainDetails, fromName: string, transferName: string, toName: string, depTs: number): string {
  const cat1 = data1 ? (data1.categoria || '').trim().toUpperCase() || 'REG' : 'N/D';
  const cat2 = data2 ? (data2.categoria || '').trim().toUpperCase() || 'REG' : 'N/D';
  const [bg1, tx1] = getCatColors(cat1);
  const [bg2, tx2] = getCatColors(cat2);
  const num1 = data1?.numeroTreno || '';
  const num2 = data2?.numeroTreno || '';

  const norm     = (s: string) => (s || '').trim().toLowerCase();
  const fermate1 = data1?.fermate || [];
  const fromNorm  = norm(fromName);
  const transNorm = norm(transferName);

  const fromIdx1  = fermate1.findIndex(f => norm(f.stazione).includes(fromNorm)  || fromNorm.includes(norm(f.stazione)));
  const transIdx1 = fermate1.findIndex(f => norm(f.stazione).includes(transNorm) || transNorm.includes(norm(f.stazione)));
  const slice1 = fermate1.slice(fromIdx1 >= 0 ? fromIdx1 : 0, transIdx1 >= 0 ? transIdx1 + 1 : fermate1.length);

  const fermate2  = data2?.fermate || [];
  const toNorm    = norm(toName);
  const transIdx2 = fermate2.findIndex(f => norm(f.stazione).includes(transNorm) || transNorm.includes(norm(f.stazione)));
  const toIdx2    = fermate2.findIndex(f => norm(f.stazione).includes(toNorm)    || toNorm.includes(norm(f.stazione)));
  const slice2 = fermate2.slice(transIdx2 >= 0 ? transIdx2 : 0, toIdx2 >= 0 ? toIdx2 + 1 : fermate2.length);

  const ritardo1 = data1?.ritardo || 0;
  const ritardo2 = data2?.ritardo || 0;
  const now = Date.now();
  const delayMs1 = ritardo1 * 60000;
  const delayMs2 = ritardo2 * 60000;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function calcLastPassed(fermate: any[], delayMs: number) {
    let idx = -1;
    fermate.forEach((f, i) => {
      if (f.actualFermataType === 1 || f.actualFermataType === 2 || f.effettiva || f.arrivoReale || f.partenzaReale) idx = i;
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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function renderLegStops(fermate: any[], lastPassedIdx: number, startName: string, endName: string, isLastLeg: boolean, delayMs: number): string {
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

      let dotColor: string, dotSize: number;
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

      const binEff  = isFrom
        ? (f.binarioEffettivoPartenzaDescrizione || f.binarioProgrammatoPartenzaDescrizione)
        : (f.binarioEffettivoArrivoDescrizione   || f.binarioProgrammatoArrivoDescrizione);
      const binProg = isFrom ? f.binarioProgrammatoPartenzaDescrizione : f.binarioProgrammatoArrivoDescrizione;
      const changed = binEff && binProg && binEff !== binProg;
      const binHtml = (isFrom || isTo || isCurrent) && binEff ? `
        <div class="d-flex align-items-center gap-1 mt-1">
          <small class="text-muted">Bin.</small>
          <span class="badge ${changed ? 'bg-warning text-dark' : (isFrom ? 'bg-primary' : 'bg-danger')} platform-num">${esc(binEff)}</span>
          ${changed ? `<small class="text-muted fst-italic">var. da ${esc(binProg)}</small>` : ''}
        </div>` : '';

      const showLine = !(i === fermate.length - 1 && isLastLeg);
      html += `<div class="d-flex gap-2 align-items-stretch" style="min-height:${showLine ? '48px' : 'auto'}">
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

  let html = `<div class="px-3 pt-2 pb-1 border-bottom" style="background:rgba(26,86,219,.04)">
    <div class="d-flex align-items-center gap-2">
      <span class="badge ${bg1} ${tx1}">${esc(cat1)}</span>
      <span class="fw-semibold small">${esc(String(num1))}</span>
      ${ritardo1 > 0
        ? `<span class="badge bg-${ritardo1 > 5 ? 'danger' : 'warning'} ${ritardo1 > 5 ? '' : 'text-dark'} ms-auto">+${ritardo1} min</span>`
        : '<span class="badge bg-success ms-auto">Puntuale</span>'}
    </div>
  </div>`;
  html += data1 ? `<div class="px-3 pt-2">${renderLegStops(slice1, lastPassed1, fromName, transferName, false, delayMs1)}</div>` : NO_DATA_LEG;
  html += `<div class="mx-3 my-2 rounded-3 border border-warning d-flex align-items-center gap-2 px-3 py-2" style="background:#fffbeb">
    <i class="bi bi-arrow-repeat text-warning fs-5"></i>
    <div>
      <div class="fw-bold small">Cambio a ${esc(transferName)}</div>
      <div class="text-muted" style="font-size:.75rem">Prosegui con ${esc(cat2)} ${esc(String(num2))}</div>
    </div>
  </div>`;
  html += `<div class="px-3 pt-1 pb-1 border-bottom" style="background:rgba(26,86,219,.04)">
    <div class="d-flex align-items-center gap-2">
      <span class="badge ${bg2} ${tx2}">${esc(cat2)}</span>
      <span class="fw-semibold small">${esc(String(num2))}</span>
      ${ritardo2 > 0
        ? `<span class="badge bg-${ritardo2 > 5 ? 'danger' : 'warning'} ${ritardo2 > 5 ? '' : 'text-dark'} ms-auto">+${ritardo2} min</span>`
        : '<span class="badge bg-success ms-auto">Puntuale</span>'}
    </div>
  </div>`;
  html += data2 ? `<div class="px-3 pt-2 pb-3">${renderLegStops(slice2, lastPassed2, transferName, toName, true, delayMs2)}</div>` : NO_DATA_LEG;
  return html;
}

function renderFermateWith2Connections(data1: TrainDetails, data2: TrainDetails, data3: TrainDetails, fromName: string, transfer1Name: string, transfer2Name: string, toName: string): string {
  const cat1 = data1 ? (data1.categoria || '').trim().toUpperCase() || 'REG' : 'N/D';
  const cat2 = data2 ? (data2.categoria || '').trim().toUpperCase() || 'REG' : 'N/D';
  const cat3 = data3 ? (data3.categoria || '').trim().toUpperCase() || 'REG' : 'N/D';
  const [bg1, tx1] = getCatColors(cat1);
  const [bg2, tx2] = getCatColors(cat2);
  const [bg3, tx3] = getCatColors(cat3);
  const num1 = data1?.numeroTreno || '';
  const num2 = data2?.numeroTreno || '';
  const num3 = data3?.numeroTreno || '';

  const norm     = (s: string) => (s || '').trim().toLowerCase();
  const fermate1 = data1?.fermate || [];
  const fermate2 = data2?.fermate || [];
  const fermate3 = data3?.fermate || [];

  const ritardo1 = data1?.ritardo || 0;
  const ritardo2 = data2?.ritardo || 0;
  const ritardo3 = data3?.ritardo || 0;
  const delayMs1 = ritardo1 * 60000;
  const delayMs2 = ritardo2 * 60000;
  const delayMs3 = ritardo3 * 60000;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function findIdx(fermate: any[], n: string) {
    return fermate.findIndex((f: { stazione: string }) => norm(f.stazione).includes(n) || n.includes(norm(f.stazione)));
  }
  const fromNorm = norm(fromName);
  const t1Norm   = norm(transfer1Name);
  const t2Norm   = norm(transfer2Name);
  const toNorm   = norm(toName);

  const slice1 = fermate1.slice(Math.max(0, findIdx(fermate1, fromNorm)), findIdx(fermate1, t1Norm) >= 0 ? findIdx(fermate1, t1Norm) + 1 : fermate1.length);
  const t2Start = findIdx(fermate2, t1Norm);
  const t2End   = findIdx(fermate2, t2Norm);
  const slice2  = fermate2.slice(t2Start >= 0 ? t2Start : 0, t2End >= 0 ? t2End + 1 : fermate2.length);
  const t3Start = findIdx(fermate3, t2Norm);
  const t3End   = findIdx(fermate3, toNorm);
  const slice3  = fermate3.slice(t3Start >= 0 ? t3Start : 0, t3End >= 0 ? t3End + 1 : fermate3.length);

  if (!slice1.length && !slice2.length && !slice3.length) {
    return '<p class="text-center text-muted py-4">Fermate non ancora disponibili (treni non ancora partiti)</p>';
  }

  const now = Date.now();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function calcLP(fermate: any[], delayMs: number) {
    let idx = -1;
    fermate.forEach((f, i) => {
      if (f.actualFermataType === 1 || f.actualFermataType === 2 || f.effettiva || f.arrivoReale || f.partenzaReale) idx = i;
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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function legStops(fermate: any[], lpIdx: number, startName: string, endName: string, isLast: boolean, delayMs: number): string {
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
      const binEff  = isFrom ? (f.binarioEffettivoPartenzaDescrizione || f.binarioProgrammatoPartenzaDescrizione) : (f.binarioEffettivoArrivoDescrizione || f.binarioProgrammatoArrivoDescrizione);
      const binProg = isFrom ? f.binarioProgrammatoPartenzaDescrizione : f.binarioProgrammatoArrivoDescrizione;
      const binChanged = binEff && binProg && binEff !== binProg;
      const binHtml = (isFrom || isTo || isCurrent) && binEff ? `
        <div class="d-flex align-items-center gap-1 mt-1">
          <small class="text-muted">Bin.</small>
          <span class="badge ${binChanged ? 'bg-warning text-dark' : (isFrom ? 'bg-primary' : 'bg-danger')} platform-num">${esc(binEff)}</span>
          ${binChanged ? `<small class="text-muted fst-italic">var. da ${esc(binProg)}</small>` : ''}
        </div>` : '';
      html += `<div class="d-flex gap-2 align-items-stretch" style="min-height:${showLine ? '48px' : 'auto'}">
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

  function trainHeader(bg: string, tx: string, cat: string, num: number|string, rit: number): string {
    return `<div class="px-3 pt-2 pb-1 border-bottom" style="background:rgba(26,86,219,.04)">
      <div class="d-flex align-items-center gap-2">
        <span class="badge ${bg} ${tx}">${esc(cat)}</span>
        <span class="fw-semibold small">${esc(String(num))}</span>
        ${rit > 0 ? `<span class="badge bg-${rit > 5 ? 'danger' : 'warning'} ${rit > 5 ? '' : 'text-dark'} ms-auto">+${rit} min</span>`
                  : '<span class="badge bg-success ms-auto">Puntuale</span>'}
      </div>
    </div>`;
  }

  function cambioDiv(stazione: string, cat: string, num: number|string): string {
    return `<div class="mx-3 my-2 rounded-3 border border-warning d-flex align-items-center gap-2 px-3 py-2" style="background:#fffbeb">
      <i class="bi bi-arrow-repeat text-warning fs-5"></i>
      <div>
        <div class="fw-bold small">Cambio a ${esc(stazione)}</div>
        <div class="text-muted" style="font-size:.75rem">Prosegui con ${esc(cat)} ${esc(String(num))}</div>
      </div>
    </div>`;
  }

  let html = '';
  html += trainHeader(bg1, tx1, cat1, num1, ritardo1);
  html += data1 ? `<div class="px-3 pt-2">${legStops(slice1, lp1, fromName, transfer1Name, false, delayMs1)}</div>` : NO_DATA_LEG;
  html += cambioDiv(transfer1Name, cat2, num2);
  html += trainHeader(bg2, tx2, cat2, num2, ritardo2);
  html += data2 ? `<div class="px-3 pt-2">${legStops(slice2, lp2, transfer1Name, transfer2Name, false, delayMs2)}</div>` : NO_DATA_LEG;
  html += cambioDiv(transfer2Name, cat3, num3);
  html += trainHeader(bg3, tx3, cat3, num3, ritardo3);
  html += data3 ? `<div class="px-3 pt-2 pb-3">${legStops(slice3, lp3, transfer2Name, toName, true, delayMs3)}</div>` : NO_DATA_LEG;
  return html;
}

export default function TrattaModal({ data, open, onClose, showToast }: Props) {
  const [bodyHtml, setBodyHtml] = useState('');
  const [title, setTitle] = useState('Tratta');
  const [countdown, setCountdown] = useState(REFRESH_S);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  async function load(d: TrattaCardData) {
    console.log('[TrattaModal] load called with:', JSON.stringify(d));
    setTitle(d.trainLabel || 'Tratta');
    setBodyHtml(`<div class="d-flex flex-column align-items-center justify-content-center py-5 text-muted">
      <div class="spinner-border text-primary" role="status"></div>
      <small class="mt-3">Caricamento tratta…</small>
    </div>`);

    try {
      if (d.train2Num && d.codOrigine2 && d.train2Date && d.train3Num && d.codOrigine3 && d.train3Date) {
        const [d1, d2, d3] = await Promise.all([
          loadTrainDetails(d.codOrigine, d.trainNum, d.trainDate),
          loadTrainDetails(d.codOrigine2, d.train2Num, d.train2Date),
          loadTrainDetails(d.codOrigine3, d.train3Num, d.train3Date),
        ]);
        setBodyHtml(renderFermateWith2Connections(d1!, d2!, d3!, d.routeFrom, d.transferStation || '', d.transfer2Station || '', d.routeTo));
      } else if (d.train2Num && d.codOrigine2 && d.train2Date) {
        const [d1, d2] = await Promise.all([
          loadTrainDetails(d.codOrigine, d.trainNum, d.trainDate),
          loadTrainDetails(d.codOrigine2, d.train2Num, d.train2Date),
        ]);
        setBodyHtml(renderFermateWithConnection(d1!, d2!, d.routeFrom, d.transferStation || '', d.routeTo, d.depTs));
      } else {
        const d1 = await loadTrainDetails(d.codOrigine, d.trainNum, d.trainDate);
        setBodyHtml(renderFermate(d1!, d.routeFrom, d.routeTo, d.depTs));
      }
    } catch {
      setBodyHtml(`<div class="text-center text-muted py-4">
        <i class="bi bi-wifi-off" style="font-size:2.5rem;opacity:.25"></i>
        <p class="mt-2 small">Impossibile caricare la tratta</p>
      </div>`);
    }
  }

  function startAutoRefresh(d: TrattaCardData) {
    stopAutoRefresh();
    let remaining = REFRESH_S;
    setCountdown(remaining);
    countdownRef.current = setInterval(() => {
      remaining--;
      setCountdown(remaining);
      if (remaining <= 0) {
        remaining = REFRESH_S;
        setCountdown(remaining);
        load(d);
      }
    }, 1000);
  }

  function stopAutoRefresh() {
    if (countdownRef.current) { clearInterval(countdownRef.current); countdownRef.current = null; }
  }

  useEffect(() => {
    if (open && data) {
      load(data);
      startAutoRefresh(data);
    } else if (!open) {
      stopAutoRefresh();
    }
    return () => stopAutoRefresh();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, data]);

  if (!open) return null;

  return (
    <>
      <div className="modal fade show d-block" tabIndex={-1} style={{ zIndex: 1055 }} onClick={e => { if ((e.target as HTMLElement).classList.contains('modal')) onClose(); }}>
        <div className="modal-dialog modal-dialog-scrollable modal-dialog-centered">
          <div className="modal-content">
            <div className="modal-header py-2 px-3">
              <h6 className="modal-title fw-bold mb-0">{title}</h6>
              <div className="ms-auto d-flex align-items-center gap-2">
                <button className="btn btn-sm btn-outline-secondary" title="Aggiorna"
                        onClick={() => { if (data) { startAutoRefresh(data); load(data); } }}>
                  <i className="bi bi-arrow-clockwise"></i> <small>{countdown}s</small>
                </button>
                <button type="button" className="btn-close" onClick={onClose}></button>
              </div>
            </div>
            <div className="modal-body p-0" dangerouslySetInnerHTML={{ __html: bodyHtml }} />
          </div>
        </div>
      </div>
      <div className="modal-backdrop fade show" style={{ zIndex: 1054 }} onClick={onClose}></div>
    </>
  );
}

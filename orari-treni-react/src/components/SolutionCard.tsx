'use client';
import { useState, useRef } from 'react';
import type { DirectMatch, TrattaCardData, NotifThreshold } from '@/lib/types';
import { getCatColors } from '@/lib/catColors';
import { formatTime } from '@/lib/utils';
import { useCountdown, formatCountdown, getCountdownClass } from '@/hooks/useCountdown';
import { useNotifications } from '@/hooks/useNotifications';

interface Props {
  match: DirectMatch;
  routeFromName: string;
  routeToName: string;
  notifThresholds: NotifThreshold[];
  onOpenTratta: (data: TrattaCardData) => void;
}

export default function SolutionCard({ match, routeFromName, routeToName, notifThresholds, onOpenTratta }: Props) {
  const { dep, arr } = match;
  const [cdOpen, setCdOpen] = useState(false);
  const [notifActive, setNotifActive] = useState(false);
  const prevSecRef = useRef<number>(99999);
  const { requestPermission, sendNotification, getVibrationPattern } = useNotifications();

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
  const delayBadge = ritardo > 5
    ? <span className="badge bg-danger ms-1">+{ritardo}&apos;</span>
    : ritardo > 0
      ? <span className="badge bg-warning text-dark ms-1">+{ritardo}&apos;</span>
      : null;

  const binDep = dep.binarioEffettivoPartenzaDescrizione || dep.binarioProgrammatoPartenzaDescrizione;
  const binDepChanged = !!(dep.binarioEffettivoPartenzaDescrizione && dep.binarioProgrammatoPartenzaDescrizione &&
                          dep.binarioEffettivoPartenzaDescrizione !== dep.binarioProgrammatoPartenzaDescrizione);
  const binArr = arr.binarioEffettivoArrivoDescrizione || arr.binarioProgrammatoArrivoDescrizione;
  const binArrChanged = !!(arr.binarioEffettivoArrivoDescrizione && arr.binarioProgrammatoArrivoDescrizione &&
                           arr.binarioEffettivoArrivoDescrizione !== arr.binarioProgrammatoArrivoDescrizione);

  const fromLabel  = dep.origine || '';
  const toLabel    = arr.destinazione || dep.destinazione || '';
  const trainLabel = `${cat} ${numLabel} → ${routeToName}`.trim();
  const trainDate  = dep.dataPartenzaTreno || (tDep ? new Date(new Date(tDep).setHours(0, 0, 0, 0)).getTime() : 0);
  const isPast     = tDep ? tDep < Date.now() : false;

  const remaining = useCountdown(cdOpen ? (tDep || null) : null, ritardo);

  // Check notification thresholds
  if (cdOpen && remaining !== null && notifActive) {
    const totalSec = Math.floor(remaining / 1000);
    const prevSec = prevSecRef.current;
    const enabledThresholds = notifThresholds.filter(t => t.enabled && t.min > 0).sort((a, b) => b.min - a.min);
    for (let i = 0; i < enabledThresholds.length; i++) {
      const sec = enabledThresholds[i].min * 60;
      if (prevSec >= sec && totalSec < sec) {
        const vib = getVibrationPattern(i);
        if (navigator.vibrate) navigator.vibrate(vib);
        const minLabel = enabledThresholds[i].min;
        sendNotification(trainLabel, `Partenza effettiva tra meno di ${minLabel} minuti`, `treno-${minLabel}min`, vib);
        break;
      }
    }
    prevSecRef.current = totalSec;
  }

  async function handleNotifToggle(e: React.MouseEvent) {
    e.stopPropagation();
    if (!notifActive) { await requestPermission(); }
    setNotifActive(prev => !prev);
  }

  function openTratta(e: React.MouseEvent) {
    e.stopPropagation();
    onOpenTratta({
      trainLabel,
      trainNum: String(dep.numeroTreno || ''),
      trainDate: String(trainDate),
      codOrigine: dep.codOrigine || '',
      routeFrom: routeFromName,
      routeTo: routeToName,
      depTs: tDep || 0,
    });
  }

  return (
    <div className={`card border-0 shadow-sm mb-3 solution-card${isPast ? ' opacity-50' : ''}`}
         style={{ filter: isPast ? 'grayscale(.75)' : undefined, cursor: 'pointer' }}
         onClick={() => { if (!cdOpen) { setNotifActive(false); prevSecRef.current = 99999; } setCdOpen(v => !v); }}>
      <div className="card-body p-3">
        <div className="d-flex align-items-center gap-2 mb-3 flex-wrap">
          <span className={`badge ${bg} ${tx} fs-6 px-2 py-1`}>{cat}</span>
          <span className="fw-bold">{numLabel}</span>
          {delayBadge}
          {durStr && <span className="badge bg-light text-secondary border ms-auto">{durStr}</span>}
        </div>
        <div className="d-flex gap-3">
          <div className="d-flex flex-column align-items-center flex-shrink-0" style={{ paddingTop: '4px' }}>
            <div className="sol-dot"></div>
            <div className="sol-line flex-grow-1 my-1"></div>
            <div className="sol-dot" style={{ background: '#dc3545' }}></div>
          </div>
          <div className="flex-grow-1">
            <div className="d-flex justify-content-between align-items-start mb-1">
              <div>
                <div className="fw-bold">{routeFromName}</div>
                {fromLabel && <small className="text-muted">da {fromLabel}</small>}
                {binDep && (
                  <div className="d-flex align-items-center gap-1 mt-1">
                    <small className="text-muted">Bin.</small>
                    <span className={`badge ${binDepChanged ? 'bg-warning text-dark' : 'bg-primary'} platform-num`}>{binDep}</span>
                    {binDepChanged && <small className="text-muted fst-italic">var.</small>}
                  </div>
                )}
              </div>
              <div className="text-end ms-3 flex-shrink-0">
                <div className="fw-bold text-primary" style={{ fontSize: '1.4rem', lineHeight: 1 }}>{depTime}</div>
                {isPast && <small className="text-muted fst-italic" style={{ fontSize: '.72rem' }}>Partito</small>}
              </div>
            </div>
            <hr className="my-2" />
            <div className="d-flex justify-content-between align-items-start">
              <div>
                <div className="fw-bold">{routeToName}</div>
                {toLabel && <small className="text-muted">dir. {toLabel}</small>}
                {binArr && (
                  <div className="d-flex align-items-center gap-1 mt-1">
                    <small className="text-muted">Bin.</small>
                    <span className={`badge ${binArrChanged ? 'bg-warning text-dark' : 'bg-danger'} platform-num`}>{binArr}</span>
                    {binArrChanged && <small className="text-muted fst-italic">var.</small>}
                  </div>
                )}
              </div>
              <div className="fw-bold text-danger ms-3" style={{ fontSize: '1.4rem', lineHeight: 1 }}>{arrTime}</div>
            </div>
          </div>
        </div>
        {cdOpen && (
          <div className="countdown-panel border-top mt-2 pt-2 pb-1 text-center">
            <small className="text-muted text-uppercase" style={{ fontSize: '.7rem', letterSpacing: '.05em' }}>Partenza tra</small>
            {remaining !== null ? (
              <>
                <div className={getCountdownClass(remaining)}>{formatCountdown(remaining)}</div>
                {ritardo > 0 && <div className="cd-delay-note text-warning small mb-1">⚠️ Ritardo +{ritardo} min · partenza effettiva {formatTime(new Date((tDep||0) + ritardo * 60000))}</div>}
              </>
            ) : (
              <div className="countdown-value fw-bold text-danger">Partito</div>
            )}
            <div className="d-flex gap-2 justify-content-center mt-1">
              <button className={`btn btn-sm ${notifActive ? 'btn-outline-danger' : 'btn-success'}`} onClick={handleNotifToggle}>
                <i className={`bi bi-bell${notifActive ? '-slash' : ''} me-1`}></i>
                {notifActive ? 'Disattiva allarme' : 'Attiva allarme'}
              </button>
              <button className="btn btn-sm btn-outline-primary" onClick={openTratta}>
                <i className="bi bi-map me-1"></i>Vedi tratta
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

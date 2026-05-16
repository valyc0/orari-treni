'use client';
import { useState, useRef } from 'react';
import type { ConnectionSolution, TrattaCardData, NotifThreshold } from '@/lib/types';
import { getCatColors } from '@/lib/catColors';
import { formatTime } from '@/lib/utils';
import { useCountdown, formatCountdown, getCountdownClass } from '@/hooks/useCountdown';
import { useNotifications } from '@/hooks/useNotifications';

interface Props {
  conn: ConnectionSolution;
  routeFromName: string;
  routeToName: string;
  notifThresholds: NotifThreshold[];
  onOpenTratta: (data: TrattaCardData) => void;
}

export default function ConnectionCard({ conn, routeFromName, routeToName, notifThresholds, onOpenTratta }: Props) {
  const { leg1, transfer, leg2, totalMin } = conn;
  const [cdOpen, setCdOpen] = useState(false);
  const [notifActive, setNotifActive] = useState(false);
  const prevSecRef = useRef<number>(99999);
  const { requestPermission, sendNotification, getVibrationPattern } = useNotifications();

  const cat1 = (leg1.train.categoriaDescrizione || leg1.train.categoria || '').trim().toUpperCase() || 'REG';
  const cat2 = (leg2.train.categoriaDescrizione || leg2.train.categoria || '').trim().toUpperCase() || 'REG';
  const [bg1, tx1] = getCatColors(cat1);
  const [bg2, tx2] = getCatColors(cat2);
  const num1 = (leg1.train.compNumeroTreno || String(leg1.train.numeroTreno || '')).trim();
  const num2 = (leg2.train.compNumeroTreno || String(leg2.train.numeroTreno || '')).trim();

  const depTime  = formatTime(new Date(leg1.depTime));
  const arrTime  = formatTime(new Date(leg2.arrTime));
  const transArr = formatTime(new Date(transfer.arrTime));
  const transDep = formatTime(new Date(transfer.depTime));
  const durStr   = totalMin < 60 ? `${totalMin} min` : `${Math.floor(totalMin / 60)}h ${totalMin % 60}m`;
  const trainLabel = `${cat1} ${num1} + ${cat2} ${num2} → ${routeToName}`.trim();
  const isPast   = leg1.depTime < Date.now();

  const binDep1        = leg1.train.binarioEffettivoPartenzaDescrizione || leg1.train.binarioProgrammatoPartenzaDescrizione;
  const binDep1Changed = !!(leg1.train.binarioEffettivoPartenzaDescrizione && leg1.train.binarioProgrammatoPartenzaDescrizione &&
                           leg1.train.binarioEffettivoPartenzaDescrizione !== leg1.train.binarioProgrammatoPartenzaDescrizione);
  const binArr2        = leg2.train.binarioEffettivoArrivoDescrizione || leg2.train.binarioProgrammatoArrivoDescrizione;
  const binArr2Changed = !!(leg2.train.binarioEffettivoArrivoDescrizione && leg2.train.binarioProgrammatoArrivoDescrizione &&
                            leg2.train.binarioEffettivoArrivoDescrizione !== leg2.train.binarioProgrammatoArrivoDescrizione);

  const remaining = useCountdown(cdOpen ? leg1.depTime : null, leg1.train.ritardo || 0);

  if (cdOpen && remaining !== null && notifActive) {
    const totalSec = Math.floor(remaining / 1000);
    const prevSec = prevSecRef.current;
    const enabledThresholds = notifThresholds.filter(t => t.enabled && t.min > 0).sort((a, b) => b.min - a.min);
    for (let i = 0; i < enabledThresholds.length; i++) {
      const sec = enabledThresholds[i].min * 60;
      if (prevSec >= sec && totalSec < sec) {
        const vib = getVibrationPattern(i);
        if (navigator.vibrate) navigator.vibrate(vib);
        sendNotification(trainLabel, `Partenza tra meno di ${enabledThresholds[i].min} minuti`, `treno-${enabledThresholds[i].min}min`, vib);
        break;
      }
    }
    prevSecRef.current = Math.floor(remaining / 1000);
  }

  function openTratta(e: React.MouseEvent) {
    e.stopPropagation();
    onOpenTratta({
      trainLabel,
      trainNum: String(leg1.train.numeroTreno || ''),
      trainDate: String(leg1.train.dataPartenzaTreno || (leg1.depTime ? new Date(new Date(leg1.depTime).setHours(0,0,0,0)).getTime() : '')),
      codOrigine: leg1.train.codOrigine || '',
      routeFrom: routeFromName,
      routeTo: routeToName,
      depTs: leg1.depTime,
      train2Num: String(leg2.train.numeroTreno || ''),
      train2Date: String(leg2.train.dataPartenzaTreno || (transfer.depTime ? new Date(new Date(transfer.depTime).setHours(0,0,0,0)).getTime() : '')),
      codOrigine2: leg2.train.codOrigine || '',
      transferStation: transfer.stationName,
    });
  }

  return (
    <div className={`card border-0 shadow-sm mb-3 solution-card connection-card${isPast ? ' opacity-50' : ''}`}
         style={{ filter: isPast ? 'grayscale(.75)' : undefined, cursor: 'pointer' }}
         onClick={() => { if (!cdOpen) { setNotifActive(false); prevSecRef.current = 99999; } setCdOpen(v => !v); }}>
      <div className="card-body p-3">
        <div className="d-flex align-items-center gap-2 mb-3 flex-wrap">
          <span className="badge bg-info text-white"><i className="bi bi-arrow-left-right me-1"></i>1 coincidenza</span>
          <span className="badge bg-light text-secondary border ms-auto">{durStr}</span>
        </div>
        <div className="d-flex gap-3">
          <div className="d-flex flex-column align-items-center flex-shrink-0" style={{ paddingTop: '4px' }}>
            <div className="sol-dot"></div>
            <div className="sol-line flex-grow-1 my-1"></div>
            <div className="sol-dot" style={{ background: '#6c757d', width: '10px', height: '10px' }}></div>
            <div className="sol-line flex-grow-1 my-1"></div>
            <div className="sol-dot" style={{ background: '#dc3545' }}></div>
          </div>
          <div className="flex-grow-1">
            <div className="d-flex justify-content-between align-items-start mb-1">
              <div>
                <div className="fw-bold">{routeFromName}</div>
                <div className="d-flex align-items-center gap-1 mt-1 flex-wrap">
                  <span className={`badge ${bg1} ${tx1}`}>{cat1}</span>
                  <span className="text-muted small">{num1}</span>
                </div>
                {binDep1 && <div className="d-flex align-items-center gap-1 mt-1"><small className="text-muted">Bin.</small><span className={`badge ${binDep1Changed ? 'bg-warning text-dark' : 'bg-primary'} platform-num`}>{binDep1}</span></div>}
              </div>
              <div className="text-end ms-3 flex-shrink-0">
                <div className="fw-bold text-primary" style={{ fontSize: '1.4rem', lineHeight: 1 }}>{depTime}</div>
                {isPast && <small className="text-muted fst-italic" style={{ fontSize: '.72rem' }}>Partito</small>}
              </div>
            </div>
            <hr className="my-2" />
            <div className="d-flex justify-content-between align-items-start mb-1">
              <div>
                <div className="fw-semibold text-secondary">{transfer.stationName}</div>
                <div className="d-flex gap-2 align-items-center mt-1 flex-wrap">
                  <small className="text-muted">Arr. {transArr} → Dep. {transDep}</small>
                  <span className="badge bg-light text-secondary border" style={{ fontSize: '.7rem' }}>att. {transfer.waitMin} min</span>
                </div>
                <div className="d-flex align-items-center gap-1 mt-1 flex-wrap">
                  <span className={`badge ${bg2} ${tx2}`}>{cat2}</span>
                  <span className="text-muted small">{num2}</span>
                  {transfer.binEff && (
                    <>
                      <span className={`badge ${transfer.binProg && transfer.binEff !== transfer.binProg ? 'bg-warning text-dark' : 'bg-primary'} platform-num`}>Bin. {transfer.binEff}</span>
                      {transfer.binProg && transfer.binEff !== transfer.binProg && <small className="text-muted fst-italic">var. da {transfer.binProg}</small>}
                    </>
                  )}
                </div>
              </div>
            </div>
            <hr className="my-2" />
            <div className="d-flex justify-content-between align-items-start">
              <div>
                <div className="fw-bold">{routeToName}</div>
                {binArr2 && <div className="d-flex align-items-center gap-1 mt-1"><small className="text-muted">Bin.</small><span className={`badge ${binArr2Changed ? 'bg-warning text-dark' : 'bg-danger'} platform-num`}>{binArr2}</span></div>}
              </div>
              <div className="fw-bold text-danger ms-3" style={{ fontSize: '1.4rem', lineHeight: 1 }}>{arrTime}</div>
            </div>
          </div>
        </div>
        {cdOpen && (
          <div className="countdown-panel border-top mt-2 pt-2 pb-1 text-center">
            <small className="text-muted text-uppercase" style={{ fontSize: '.7rem', letterSpacing: '.05em' }}>Partenza tra</small>
            {remaining !== null ? <div className={getCountdownClass(remaining)}>{formatCountdown(remaining)}</div> : <div className="countdown-value fw-bold text-danger">Partito</div>}
            <div className="d-flex gap-2 justify-content-center mt-1">
              <button className={`btn btn-sm ${notifActive ? 'btn-outline-danger' : 'btn-success'}`} onClick={async (e) => { e.stopPropagation(); if (!notifActive) await requestPermission(); setNotifActive(v => !v); }}>
                <i className={`bi bi-bell${notifActive ? '-slash' : ''} me-1`}></i>{notifActive ? 'Disattiva' : 'Attiva allarme'}
              </button>
              <button className="btn btn-sm btn-outline-primary" onClick={openTratta}><i className="bi bi-map me-1"></i>Vedi tratta</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}


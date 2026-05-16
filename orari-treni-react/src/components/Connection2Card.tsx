'use client';
import { useState, useRef } from 'react';
import type { Connection2Solution, NotifThreshold, TrattaCardData } from '@/lib/types';
import { getCatColors } from '@/lib/catColors';
import { formatTime } from '@/lib/utils';
import { useCountdown, formatCountdown, getCountdownClass } from '@/hooks/useCountdown';
import { useNotifications } from '@/hooks/useNotifications';

interface Props {
  conn: Connection2Solution;
  routeFromName: string;
  routeToName: string;
  notifThresholds: NotifThreshold[];
  onOpenTratta: (data: TrattaCardData) => void;
}

export default function Connection2Card({ conn, routeFromName, routeToName, notifThresholds, onOpenTratta }: Props) {
  const { leg1, transfer1, leg2, transfer2, leg3, totalMin } = conn;
  const cat1 = (leg1.train.categoriaDescrizione || leg1.train.categoria || '').trim().toUpperCase() || 'REG';
  const cat2 = (leg2.train.categoriaDescrizione || leg2.train.categoria || '').trim().toUpperCase() || 'REG';
  const cat3 = (leg3.train.categoriaDescrizione || leg3.train.categoria || '').trim().toUpperCase() || 'REG';
  const [bg1, tx1] = getCatColors(cat1);
  const [bg2, tx2] = getCatColors(cat2);
  const [bg3, tx3] = getCatColors(cat3);
  const num1 = (leg1.train.compNumeroTreno || String(leg1.train.numeroTreno || '')).trim();
  const num2 = (leg2.train.compNumeroTreno || String(leg2.train.numeroTreno || '')).trim();
  const num3 = (leg3.train.compNumeroTreno || String(leg3.train.numeroTreno || '')).trim();

  const depTime = formatTime(new Date(leg1.depTime));
  const arrTime = formatTime(new Date(leg3.arrTime));
  const t1Arr   = formatTime(new Date(transfer1.arrTime));
  const t1Dep   = formatTime(new Date(transfer1.depTime));
  const t2Arr   = formatTime(new Date(transfer2.arrTime));
  const t2Dep   = formatTime(new Date(transfer2.depTime));
  const durStr  = totalMin < 60 ? `${totalMin} min` : `${Math.floor(totalMin / 60)}h ${totalMin % 60}m`;
  const isPast  = leg1.depTime < Date.now();
  const trainLabel = `${cat1} ${num1} + ${cat2} ${num2} + ${cat3} ${num3} → ${routeToName}`.trim();

  const td1 = leg1.train.dataPartenzaTreno || new Date(new Date(leg1.depTime).setHours(0, 0, 0, 0)).getTime();
  const td2 = leg2.train.dataPartenzaTreno || new Date(new Date(transfer1.depTime).setHours(0, 0, 0, 0)).getTime();
  const td3 = leg3.train.dataPartenzaTreno || new Date(new Date(transfer2.depTime).setHours(0, 0, 0, 0)).getTime();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function binBadge(t: any, type: 'dep' | 'arr') {
    const eff  = type === 'dep' ? t?.binarioEffettivoPartenzaDescrizione  : t?.binarioEffettivoArrivoDescrizione;
    const prog = type === 'dep' ? t?.binarioProgrammatoPartenzaDescrizione : t?.binarioProgrammatoArrivoDescrizione;
    const val  = eff || prog;
    if (!val) return null;
    const changed = eff && prog && eff !== prog;
    const color   = changed ? 'bg-warning text-dark' : (type === 'dep' ? 'bg-primary' : 'bg-danger');
    return (
      <div className="d-flex align-items-center gap-1 mt-1">
        <small className="text-muted">Bin.</small>
        <span className={`badge ${color} platform-num`}>{val}</span>
        {changed && <small className="text-muted fst-italic">var.</small>}
      </div>
    );
  }

  const [cdOpen, setCdOpen] = useState(false);
  const [notifActive, setNotifActive] = useState(false);
  const prevSecRef = useRef<number>(99999);
  const { requestPermission, sendNotification, getVibrationPattern } = useNotifications();
  const remaining = useCountdown(cdOpen ? leg1.depTime : null, leg1.train.ritardo || 0);

  if (cdOpen && remaining !== null && notifActive) {
    const totalSec = Math.floor(remaining / 1000);
    const prevSec = prevSecRef.current;
    const enabled = notifThresholds.filter(t => t.enabled && t.min > 0).sort((a, b) => b.min - a.min);
    for (let i = 0; i < enabled.length; i++) {
      const sec = enabled[i].min * 60;
      if (prevSec >= sec && totalSec < sec) {
        const vib = getVibrationPattern(i);
        if (navigator.vibrate) navigator.vibrate(vib);
        sendNotification(trainLabel, `Partenza tra meno di ${enabled[i].min} min`, `treno-${enabled[i].min}min`, vib);
        break;
      }
    }
    prevSecRef.current = totalSec;
  }

  return (
    <div className={`card border-0 shadow-sm mb-3 solution-card connection-card${isPast ? ' opacity-50' : ''}`}
      style={{ filter: isPast ? 'grayscale(.75)' : undefined, cursor: 'pointer' }}
      onClick={() => { if (!cdOpen) { setNotifActive(false); prevSecRef.current = 99999; } setCdOpen(p => !p); }}>
      <div className="card-body p-3">
        <div className="d-flex align-items-center gap-2 mb-3 flex-wrap">
          <span className="badge bg-warning text-dark"><i className="bi bi-arrow-left-right me-1"></i>2 coincidenze</span>
          <span className="badge bg-secondary text-white"><i className="bi bi-robot me-1"></i>AI</span>
          <span className="badge bg-light text-secondary border ms-auto">{durStr}</span>
        </div>
        <div className="d-flex gap-3">
          <div className="d-flex flex-column align-items-center flex-shrink-0" style={{ paddingTop: 4 }}>
            <div className="sol-dot"></div>
            <div className="sol-line flex-grow-1 my-1"></div>
            <div className="sol-dot" style={{ background: '#6c757d', width: 10, height: 10 }}></div>
            <div className="sol-line flex-grow-1 my-1"></div>
            <div className="sol-dot" style={{ background: '#6c757d', width: 10, height: 10 }}></div>
            <div className="sol-line flex-grow-1 my-1"></div>
            <div className="sol-dot" style={{ background: '#dc3545' }}></div>
          </div>
          <div className="flex-grow-1">
            {/* Partenza */}
            <div className="d-flex justify-content-between align-items-start mb-1">
              <div>
                <div className="fw-bold">{routeFromName}</div>
                <div className="d-flex align-items-center gap-1 mt-1 flex-wrap">
                  <span className={`badge ${bg1} ${tx1}`}>{cat1}</span>
                  <span className="text-muted small">{num1}</span>
                </div>
                {binBadge(leg1.train, 'dep')}
              </div>
              <div className="text-end ms-3 flex-shrink-0">
                <div className="fw-bold text-primary" style={{ fontSize: '1.4rem', lineHeight: 1 }}>{depTime}</div>
                {isPast && <small className="text-muted fst-italic" style={{ fontSize: '.72rem' }}>Partito</small>}
              </div>
            </div>
            <hr className="my-2" />
            {/* Prima coincidenza */}
            <div className="d-flex justify-content-between align-items-start mb-1">
              <div>
                <div className="fw-semibold text-secondary">{transfer1.stationName}</div>
                <div className="d-flex gap-2 align-items-center mt-1 flex-wrap">
                  <small className="text-muted">Arr. {t1Arr} → Dep. {t1Dep}</small>
                  <span className="badge bg-light text-secondary border" style={{ fontSize: '.7rem' }}>att. {transfer1.waitMin} min</span>
                </div>
                {binBadge(transfer1.arrObj, 'arr')}
                {binBadge(leg2.train, 'dep')}
                <div className="d-flex align-items-center gap-1 mt-1 flex-wrap">
                  <span className={`badge ${bg2} ${tx2}`}>{cat2}</span>
                  <span className="text-muted small">{num2}</span>
                </div>
              </div>
            </div>
            <hr className="my-2" />
            {/* Seconda coincidenza */}
            <div className="d-flex justify-content-between align-items-start mb-1">
              <div>
                <div className="fw-semibold text-secondary">{transfer2.stationName}</div>
                <div className="d-flex gap-2 align-items-center mt-1 flex-wrap">
                  <small className="text-muted">Arr. {t2Arr} → Dep. {t2Dep}</small>
                  <span className="badge bg-light text-secondary border" style={{ fontSize: '.7rem' }}>att. {transfer2.waitMin} min</span>
                </div>
                {binBadge(transfer2.arrObj, 'arr')}
                <div className="d-flex align-items-center gap-1 mt-1 flex-wrap">
                  <span className={`badge ${bg3} ${tx3}`}>{cat3}</span>
                  <span className="text-muted small">{num3}</span>
                </div>
              </div>
            </div>
            <hr className="my-2" />
            {/* Arrivo */}
            <div className="d-flex justify-content-between align-items-start">
              <div>
                <div className="fw-bold">{routeToName}</div>
                {binBadge(leg3.train, 'arr')}
              </div>
              <div className="fw-bold text-danger ms-3" style={{ fontSize: '1.4rem', lineHeight: 1 }}>{arrTime}</div>
            </div>
          </div>
        </div>
        {cdOpen && (
          <div className="countdown-panel border-top mt-2 pt-2 pb-1 text-center">
            <small className="text-muted text-uppercase" style={{ fontSize: '.7rem', letterSpacing: '.05em' }}>Partenza tra</small>
            {remaining !== null
              ? <div className={getCountdownClass(remaining)}>{formatCountdown(remaining)}</div>
              : <div className="countdown-value fw-bold text-danger">Partito</div>}
            <div className="d-flex gap-2 justify-content-center mt-1">
              <button className={`btn btn-sm ${notifActive ? 'btn-outline-danger' : 'btn-success'} cd-notif-btn`}
                onClick={async e => { e.stopPropagation(); if (!notifActive) { await requestPermission(); setNotifActive(true); } else setNotifActive(false); }}>
                <i className={`bi bi-bell${notifActive ? '-slash' : ''} me-1`}></i>{notifActive ? 'Disattiva allarme' : 'Attiva allarme'}
              </button>
              <button className="btn btn-sm btn-outline-primary cd-tratta-btn"
                onClick={e => { e.stopPropagation(); onOpenTratta({ trainLabel, trainNum: String(leg1.train.numeroTreno || ''), trainDate: String(td1), codOrigine: leg1.train.codOrigine || '', train2Num: String(leg2.train.numeroTreno || ''), train2Date: String(td2), codOrigine2: leg2.train.codOrigine || '', transferStation: transfer1.stationName, train3Num: String(leg3.train.numeroTreno || ''), train3Date: String(td3), codOrigine3: leg3.train.codOrigine || '', transfer2Station: transfer2.stationName, routeFrom: routeFromName, routeTo: routeToName, depTs: leg1.depTime }); }}>
                <i className="bi bi-map me-1"></i>Vedi tratta
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

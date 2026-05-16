'use client';
import { useState, useRef } from 'react';
import type { Train, NotifThreshold, TrattaCardData } from '@/lib/types';
import { getCatColors } from '@/lib/catColors';
import { formatTime } from '@/lib/utils';
import { useCountdown, formatCountdown, getCountdownClass } from '@/hooks/useCountdown';
import { useNotifications } from '@/hooks/useNotifications';

interface Props {
  train: Train;
  tab: 'partenze' | 'arrivi';
  stationName: string;
  notifThresholds: NotifThreshold[];
  onOpenTratta: (data: TrattaCardData) => void;
  showToast: (msg: string) => void;
}

export default function TrainCard({ train: t, tab, stationName, notifThresholds, onOpenTratta, showToast }: Props) {
  const isDep = tab === 'partenze';
  const [cdOpen, setCdOpen] = useState(false);
  const [notifActive, setNotifActive] = useState(false);
  const prevSecRef = useRef<number>(99999);
  const { requestPermission, sendNotification, getVibrationPattern } = useNotifications();

  const timeMs  = isDep ? t.orarioPartenza : t.orarioArrivo;
  const timeStr = timeMs
    ? formatTime(new Date(timeMs))
    : (isDep ? t.compOrarioPartenza : t.compOrarioArrivo) || '--:--';
  const timeLabel = isDep ? 'Partenza' : 'Arrivo';
  const dest      = isDep ? (t.destinazione || '—') : (t.origine || '—');
  const numLabel  = (t.compNumeroTreno || String(t.numeroTreno || '')).trim();
  const isPast    = timeMs ? timeMs < Date.now() : false;

  const platEff    = isDep ? t.binarioEffettivoPartenzaDescrizione : t.binarioEffettivoArrivoDescrizione;
  const platProg   = isDep ? t.binarioProgrammatoPartenzaDescrizione : t.binarioProgrammatoArrivoDescrizione;
  const platShow   = platEff || platProg || null;
  const platChanged = !!(platEff && platProg && platEff.trim() !== platProg.trim());

  const cat = (t.categoriaDescrizione || t.categoria || '').trim().toUpperCase() || 'REG';
  const [catBg, catTx] = getCatColors(cat);
  const trainLabel = `${cat} ${numLabel}`.trim();

  const delay = t.ritardo || 0;
  const delayBadge = delay > 15
    ? <span className="badge bg-danger">+{delay} min</span>
    : delay > 0
      ? <span className="badge bg-warning text-dark">+{delay} min</span>
      : delay < 0
        ? <span className="badge bg-success">{delay} min</span>
        : <span className="badge bg-success"><i className="bi bi-check-lg"></i> In orario</span>;

  const statusBadge = t.nonPartito
    ? <span className="badge bg-secondary">Non partito</span>
    : t.inStazione
      ? <span className="badge bg-success bg-opacity-75"><i className="bi bi-geo-alt-fill"></i> In stazione</span>
      : null;

  const remaining = useCountdown(cdOpen ? (timeMs || null) : null, delay);

  function handleCardClick() {
    if (!cdOpen) {
      setNotifActive(false);
      prevSecRef.current = 99999;
    }
    setCdOpen(prev => !prev);
  }

  async function handleNotifToggle(e: React.MouseEvent) {
    e.stopPropagation();
    if (!notifActive) {
      await requestPermission();
      setNotifActive(true);
      showToast('Allarme attivato');
    } else {
      setNotifActive(false);
      showToast('Allarme disattivato');
    }
  }

  // Check for notification thresholds
  if (cdOpen && remaining !== null && notifActive) {
    const totalSec = Math.floor(remaining / 1000);
    const prevSec = prevSecRef.current;
    const enabledThresholds = notifThresholds
      .filter(t => t.enabled && t.min > 0)
      .sort((a, b) => b.min - a.min);
    for (let i = 0; i < enabledThresholds.length; i++) {
      const sec = enabledThresholds[i].min * 60;
      if (prevSec >= sec && totalSec < sec) {
        const vib = getVibrationPattern(i);
        if (navigator.vibrate) navigator.vibrate(vib);
        const delayNote = delay > 0 ? ` (ritardo +${delay} min)` : '';
        const minLabel = enabledThresholds[i].min;
        const body = minLabel === 1
          ? `Partenza effettiva tra meno di 1 minuto${delayNote}`
          : `Partenza effettiva tra meno di ${minLabel} minuti${delayNote}`;
        sendNotification(trainLabel, body, `treno-${minLabel}min`, vib);
        break;
      }
    }
    prevSecRef.current = totalSec;
  }

  const otherName = isDep ? (t.destinazione || '') : (t.origine || '');

  function openTratta(e: React.MouseEvent) {
    e.stopPropagation();
    onOpenTratta({
      trainLabel,
      trainNum: String(t.numeroTreno || ''),
      trainDate: String(t.dataPartenzaTreno || ''),
      codOrigine: t.codOrigine || '',
      routeFrom: isDep ? stationName : otherName,
      routeTo: isDep ? otherName : stationName,
      depTs: timeMs || 0,
    });
  }

  return (
    <div
      className={`card mb-2 border-0 shadow-sm solution-card${isPast ? ' opacity-50' : ''}`}
      style={{ filter: isPast ? 'grayscale(.75)' : undefined, cursor: 'pointer' }}
      onClick={handleCardClick}
    >
      <div className="card-body p-3">
        <div className="d-flex justify-content-between align-items-start mb-2">
          <div className="d-flex align-items-center gap-2 flex-wrap me-2">
            <span className={`badge ${catBg} ${catTx}`}>{cat}</span>
            <span className="text-muted small fw-semibold">{numLabel}</span>
            {statusBadge}
          </div>
          {delayBadge}
        </div>
        <div className="d-flex justify-content-between align-items-center">
          <span className="fw-bold lh-sm me-3">{dest}</span>
          <div className="text-end flex-shrink-0">
            <div className="train-time text-primary lh-1">{timeStr}</div>
            <div className="text-muted small mt-1">{timeLabel}</div>
          </div>
        </div>
        {platShow ? (
          <div className="d-flex align-items-center gap-2 flex-wrap mt-2">
            <span className="text-muted small">Binario</span>
            <span className={`badge ${platChanged ? 'bg-warning text-dark' : 'bg-primary'} platform-num`}>{platShow}</span>
            {platChanged && <small className="text-muted fst-italic">var. da <strong>{platProg}</strong></small>}
          </div>
        ) : (
          <div className="mt-2"><small className="text-muted fst-italic">Binario non disponibile</small></div>
        )}

        {cdOpen && (
          <div className="countdown-panel border-top mt-2 pt-2 pb-1 text-center">
            <small className="text-muted text-uppercase" style={{ fontSize: '.7rem', letterSpacing: '.05em' }}>{timeLabel} tra</small>
            {remaining !== null ? (
              <>
                <div className={getCountdownClass(remaining)}>{formatCountdown(remaining)}</div>
                {delay > 0 && (
                  <div className="cd-delay-note text-warning small mb-1">
                    ⚠️ Ritardo +{delay} min · partenza effettiva {formatTime(new Date((timeMs || 0) + delay * 60000))}
                  </div>
                )}
              </>
            ) : (
              <div className="countdown-value fw-bold text-danger">Partito</div>
            )}
            <div className="d-flex gap-2 justify-content-center mt-1">
              <button
                className={`btn btn-sm ${notifActive ? 'btn-outline-danger' : 'btn-success'} cd-notif-btn`}
                onClick={handleNotifToggle}
              >
                <i className={`bi bi-bell${notifActive ? '-slash' : ''} me-1`}></i>
                {notifActive ? 'Disattiva allarme' : 'Attiva allarme'}
              </button>
              <button className="btn btn-sm btn-outline-primary cd-tratta-btn" onClick={openTratta}>
                <i className="bi bi-map me-1"></i>Dettaglio tratta
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

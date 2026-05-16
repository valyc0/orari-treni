'use client';
import { useState, useEffect, useRef } from 'react';
import { useAppContext } from '@/context/AppContext';
import { useFavorites } from '@/hooks/useFavorites';
import { useNotifThresholds } from '@/hooks/useNotifThresholds';
import TrainCard from './TrainCard';
import type { Train, TrattaCardData } from '@/lib/types';
import { viTimestamp } from '@/lib/viTimestamp';
import { toLocalIso, formatTime } from '@/lib/utils';

interface Props {
  showToast: (msg: string) => void;
  openTratta: (data: TrattaCardData) => void;
}

function getRecentStations() {
  try { return JSON.parse(localStorage.getItem('treni_recent_stations') || '[]'); } catch { return []; }
}

export default function PageOrari({ showToast, openTratta }: Props) {
  const { state, dispatch } = useAppContext();
  const { station, activeTab, chosenDate, autoRefresh } = state;
  const { isStationFav, toggleStation } = useFavorites();
  const { thresholds } = useNotifThresholds();

  const [trains, setTrains] = useState<Train[]>([]);
  const [loading, setLoading] = useState(false);
  const [lastUpdate, setLastUpdate] = useState('');
  const [shownKeys, setShownKeys] = useState(new Set<string>());
  const [firstTs, setFirstTs] = useState<number | null>(null);
  const [lastTs, setLastTs] = useState<number | null>(null);
  const [recentStations, setRecentStations] = useState<{ id: string; name: string }[]>([]);

  const [orariDate, setOrariDate] = useState('');
  const [orariTime, setOrariTime] = useState('');
  const refreshTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Carica recenti solo lato client (evita hydration mismatch)
  useEffect(() => {
    setRecentStations(getRecentStations());
  }, []);

  useEffect(() => {
    const now = new Date();
    const p = (n: number) => String(n).padStart(2, '0');
    setOrariDate(`${now.getFullYear()}-${p(now.getMonth()+1)}-${p(now.getDate())}`);
    setOrariTime(`${p(now.getHours())}:${p(now.getMinutes())}`);
  }, [station]);

  async function fetchTrains(silent = false) {
    if (!station) return;
    if (!silent) setLoading(true);
    const ico = document.getElementById('refreshIco');
    if (ico) ico.classList.add('spin');
    try {
      const d = chosenDate || new Date();
      const ts = viTimestamp(d);
      const url = activeTab === 'partenze'
        ? `/api/partenze?id=${encodeURIComponent(station.id)}&ts=${encodeURIComponent(ts)}`
        : `/api/arrivi?id=${encodeURIComponent(station.id)}&ts=${encodeURIComponent(ts)}`;
      const res = await fetch(url);
      const data: Train[] = await res.json();
      const tsKey = activeTab === 'partenze' ? 'orarioPartenza' : 'orarioArrivo';
      const newKeys = new Set<string>();
      data.forEach(t => newKeys.add(t.numeroTreno + '|' + (t.dataPartenzaTreno || '')));
      setShownKeys(newKeys);
      setTrains(data);
      const getTs = (t: Train) => tsKey === 'orarioPartenza' ? t.orarioPartenza || t.orarioPartenzaZero : t.orarioArrivo || t.orarioArrivoZero;
      setFirstTs(data.length ? getTs(data[0]) || null : null);
      setLastTs(data.length ? getTs(data[data.length-1]) || null : null);
      setLastUpdate('Aggiornato: ' + formatTime(new Date()));
    } catch { showToast('Impossibile caricare i dati'); }
    finally {
      setLoading(false);
      if (ico) ico.classList.remove('spin');
    }
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (station) fetchTrains(); }, [station, activeTab]);

  useEffect(() => {
    if (refreshTimerRef.current) clearInterval(refreshTimerRef.current);
    if (autoRefresh) refreshTimerRef.current = setInterval(() => fetchTrains(true), 60000);
    return () => { if (refreshTimerRef.current) clearInterval(refreshTimerRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRefresh, station, activeTab]);

  async function loadMore(direction: 'prev' | 'next', anchorTs: number) {
    if (!station) return;
    const baseDate = direction === 'prev' ? new Date(anchorTs - 3 * 60 * 60 * 1000) : new Date(anchorTs);
    const ts = viTimestamp(baseDate);
    const url = activeTab === 'partenze'
      ? `/api/partenze?id=${encodeURIComponent(station.id)}&ts=${encodeURIComponent(ts)}`
      : `/api/arrivi?id=${encodeURIComponent(station.id)}&ts=${encodeURIComponent(ts)}`;
    try {
      const res = await fetch(url);
      const data: Train[] = await res.json();
      const tsKey = activeTab === 'partenze' ? 'orarioPartenza' : 'orarioArrivo';
      const getTs = (t: Train) => tsKey === 'orarioPartenza' ? t.orarioPartenza || t.orarioPartenzaZero : t.orarioArrivo || t.orarioArrivoZero;
      const newTrains = data.filter(t => {
        const key = t.numeroTreno + '|' + (t.dataPartenzaTreno || '');
        if (shownKeys.has(key)) return false;
        const tTs = getTs(t);
        if (!tTs) return false;
        if (direction === 'prev' && tTs >= anchorTs) return false;
        if (direction === 'next' && tTs <= anchorTs) return false;
        return true;
      });
      if (!newTrains.length) { showToast(direction === 'prev' ? 'Nessun orario precedente' : 'Nessun orario successivo'); return; }
      const newKeys = new Set(shownKeys);
      newTrains.forEach(t => newKeys.add(t.numeroTreno + '|' + (t.dataPartenzaTreno || '')));
      setShownKeys(newKeys);
      if (direction === 'prev') {
        setTrains(prev => [...newTrains, ...prev]);
        setFirstTs(getTs(newTrains[0]) || null);
      } else {
        setTrains(prev => [...prev, ...newTrains]);
        setLastTs(getTs(newTrains[newTrains.length-1]) || null);
      }
    } catch { showToast('Errore nel caricamento'); }
  }

  function handleSearch() {
    const date = orariDate ? new Date(`${orariDate}T${orariTime || '00:00'}`) : null;
    dispatch({ type: 'SET_DATE', date });
    setTimeout(() => fetchTrains(), 0);
  }

  function setQuickTime(hour: string) {
    const now = new Date();
    const p = (n: number) => String(n).padStart(2, '0');
    if (hour === 'now') {
      setOrariDate(`${now.getFullYear()}-${p(now.getMonth()+1)}-${p(now.getDate())}`);
      setOrariTime(`${p(now.getHours())}:${p(now.getMinutes())}`);
    } else {
      setOrariTime(`${p(parseInt(hour))}:00`);
    }
    setTimeout(handleSearch, 0);
  }

  function setDomani() {
    const d = new Date(); d.setDate(d.getDate() + 1);
    setOrariDate(toLocalIso(d).slice(0, 10));
    setOrariTime('06:00');
    setTimeout(handleSearch, 0);
  }

  function handleFav() {
    if (!station) return;
    const added = toggleStation(station.id, station.name);
    showToast(added ? 'Aggiunto ai preferiti ⭐' : 'Rimosso dai preferiti');
  }

  if (!station) {
    return (
      <div>
        {!recentStations.length ? (
          <div className="d-flex flex-column align-items-center justify-content-center text-muted py-5 mt-3">
            <i className="bi bi-train-front-fill" style={{ fontSize: '5rem', opacity: .12 }}></i>
            <h5 className="mt-3 fw-semibold">Cerca una stazione</h5>
            <p className="small mb-0">Inserisci il nome per vedere partenze e arrivi</p>
          </div>
        ) : (
          <div className="px-3 pt-3">
            <p className="text-muted small mb-2 fw-semibold text-uppercase" style={{ letterSpacing: '.04em' }}>
              <i className="bi bi-clock-history me-1"></i>Recenti
            </p>
            <div className="list-group shadow-sm rounded-3">
              {recentStations.map((s: { id: string; name: string }) => (
                <button key={s.id} className="list-group-item list-group-item-action border-0 d-flex align-items-center gap-3 py-3"
                        onClick={() => { dispatch({ type: 'SET_STATION', station: s }); dispatch({ type: 'SET_PAGE', page: 'orari' }); dispatch({ type: 'SET_DATE', date: null }); }}>
                  <i className="bi bi-geo-alt-fill text-primary fs-5 flex-shrink-0"></i>
                  <span className="fw-semibold">{s.name}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  const isFav = isStationFav(station.id);

  return (
    <div>
      <div className="d-flex align-items-center justify-content-between bg-white border-bottom px-3 py-2 shadow-sm">
        <div className="d-flex align-items-center gap-2 overflow-hidden">
          <i className="bi bi-geo-alt-fill text-primary fs-5 flex-shrink-0"></i>
          <span className="fw-bold text-truncate">{station.name}</span>
        </div>
        <div className="d-flex align-items-center gap-1 flex-shrink-0 ms-2">
          <button className="btn btn-link p-1 fs-4 lh-1 text-warning" onClick={handleFav}>
            <i className={`bi bi-star${isFav ? '-fill' : ''}`}></i>
          </button>
          <button className="btn btn-sm btn-outline-primary rounded-pill px-3" onClick={() => fetchTrains()}>
            <i className="bi bi-arrow-clockwise" id="refreshIco"></i>
          </button>
        </div>
      </div>

      <div className="bg-light border-bottom px-3 pt-2 pb-2">
        <div className="d-flex gap-2 mb-2">
          <input type="date" className="form-control form-control-sm flex-grow-1"
                 value={orariDate} onChange={e => setOrariDate(e.target.value)} />
          <button className="btn btn-primary px-4 fw-bold" onClick={handleSearch}>
            <i className="bi bi-search me-1"></i>Cerca
          </button>
        </div>
        <div className="d-flex gap-2 flex-wrap align-items-center">
          {[{h:'now',l:'Adesso'},{h:'6',l:'Mattina'},{h:'13',l:'Pomeriggio'},{h:'18',l:'Sera'},{h:'21',l:'Notte'}].map(({h,l}) => (
            <button key={h} className="btn btn-sm btn-outline-secondary" onClick={() => setQuickTime(h)}>{l}</button>
          ))}
          <button className="btn btn-sm btn-outline-secondary" onClick={setDomani}>Domani</button>
          <input type="time" className="form-control form-control-sm ms-auto" style={{ maxWidth: '100px' }}
                 value={orariTime} onChange={e => setOrariTime(e.target.value)} />
        </div>
      </div>

      <div className="sticky-tabs bg-white shadow-sm">
        <ul className="nav nav-tabs border-0 mb-0">
          {(['partenze','arrivi'] as const).map(tab => (
            <li key={tab} className="nav-item flex-fill text-center">
              <button className={`nav-link w-100 rounded-0 py-3 ${activeTab === tab ? 'active' : 'border-0'}`}
                      onClick={() => dispatch({ type: 'SET_TAB', tab })}>
                <i className={`bi bi-arrow-${tab === 'partenze' ? 'up-right' : 'down-left'}-circle${activeTab === tab ? '-fill' : ''} me-1`}></i>
                {tab === 'partenze' ? 'Partenze' : 'Arrivi'}
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div className="d-flex align-items-center justify-content-between bg-light px-3 py-2 border-bottom">
        <small className="text-muted">{lastUpdate || '–'}</small>
        <div className="d-flex align-items-center gap-2">
          <small className="text-muted">Auto</small>
          <div className="form-check form-switch mb-0">
            <input className="form-check-input" type="checkbox" role="switch"
                   checked={autoRefresh} onChange={e => dispatch({ type: 'SET_AUTO_REFRESH', enabled: e.target.checked })} />
          </div>
        </div>
      </div>

      {loading ? (
        <div className="d-flex flex-column align-items-center justify-content-center py-5 text-muted">
          <div className="spinner-border text-primary" role="status" style={{ width: '2.5rem', height: '2.5rem' }}></div>
          <small className="mt-3">Caricamento…</small>
        </div>
      ) : trains.length === 0 ? (
        <div className="text-center text-muted py-5">
          <i className="bi bi-calendar-x" style={{ fontSize: '3rem', opacity: .25 }}></i>
          <h6 className="mt-3 fw-semibold">Nessun treno trovato</h6>
          <p className="small mb-0">Prova a cambiare orario o data</p>
        </div>
      ) : (
        <>
          <div className="px-3 pt-2">
            <button className="btn btn-outline-secondary btn-sm w-100 mb-2" onClick={() => firstTs && loadMore('prev', firstTs)}>
              <i className="bi bi-arrow-up me-1"></i>Orari precedenti
            </button>
          </div>
          <div className="px-3 pt-1 pb-2">
            {trains.map((t, i) => (
              <TrainCard key={`${t.numeroTreno}-${t.dataPartenzaTreno}-${i}`} train={t} tab={activeTab} stationName={station.name}
                         notifThresholds={thresholds} onOpenTratta={openTratta} showToast={showToast} />
            ))}
          </div>
          <div className="px-3 pb-3">
            <button className="btn btn-outline-secondary btn-sm w-100 mt-2" onClick={() => lastTs && loadMore('next', lastTs)}>
              <i className="bi bi-arrow-down me-1"></i>Orari successivi
            </button>
          </div>
        </>
      )}
    </div>
  );
}

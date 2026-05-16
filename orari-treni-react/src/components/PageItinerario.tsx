'use client';
import { useState, useEffect, useRef } from 'react';
import { useAppContext } from '@/context/AppContext';
import { useStationsCache } from '@/hooks/useStationsCache';
import { useFavorites } from '@/hooks/useFavorites';
import { useNotifThresholds } from '@/hooks/useNotifThresholds';
import { useItinerarioSearch } from '@/hooks/useItinerarioSearch';
import { searchStationsAPI } from '@/lib/routeHelpers';
import type { Station, ConnectionSolution, Connection2Solution, TrattaCardData } from '@/lib/types';
import SolutionCard from '@/components/SolutionCard';
import ConnectionCard from '@/components/ConnectionCard';
import Connection2Card from '@/components/Connection2Card';

interface Props {
  showToast: (msg: string) => void;
  openTratta: (data: TrattaCardData) => void;
  active: boolean;
}

export default function PageItinerario({ showToast, openTratta, active }: Props) {
  const { state, dispatch } = useAppContext();
  const { search: searchCache } = useStationsCache();
  const { toggleRoute, isRouteFav } = useFavorites();
  const { thresholds: notifThresholds } = useNotifThresholds();
  const { result, prevBtnState, nextBtnState, doSearchRoute, doSearchRouteWithVia, loadMoreRoute } =
    useItinerarioSearch(showToast);

  // Form state
  const [fromVal, setFromVal]     = useState('');
  const [toVal, setToVal]         = useState('');
  const [routeFrom, setRouteFrom] = useState<Station | null>(null);
  const [routeTo, setRouteTo]     = useState<Station | null>(null);
  const [dateStr, setDateStr]     = useState('');
  const [timeStr, setTimeStr]     = useState('');

  // Autocomplete state
  const [fromDropOpen, setFromDropOpen] = useState(false);
  const [toDropOpen, setToDropOpen]     = useState(false);
  const [fromResults, setFromResults]   = useState<Station[]>([]);
  const [toResults, setToResults]       = useState<Station[]>([]);

  // Refs
  const lastAutoRouteKey = useRef('');
  const fromTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toTimer   = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ─── Init date/time ────────────────────────────────────────────────────────
  useEffect(() => {
    const now = new Date();
    const p = (n: number) => String(n).padStart(2, '0');
    setDateStr(`${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`);
    setTimeStr(`${p(now.getHours())}:${p(now.getMinutes())}`);
  }, []);

  // ─── Close dropdowns on outside click ─────────────────────────────────────
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (!(e.target as HTMLElement).closest('#wrap-from')) setFromDropOpen(false);
      if (!(e.target as HTMLElement).closest('#wrap-to')) setToDropOpen(false);
    }
    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, []);

  // ─── Auto-search from context (favorites navigation) ──────────────────────
  useEffect(() => {
    if (!active || !state.routeFrom || !state.routeTo) return;

    const key = `${state.routeFrom.id}→${state.routeTo.id}`;
    // Se arriva una navigazione AI con via, forza sempre la ricerca (anche stessa rotta)
    const hasVia = (state.routeVia?.length ?? 0) > 0;
    if (!hasVia && lastAutoRouteKey.current === key) return;
    lastAutoRouteKey.current = key;

    const capturedFrom = state.routeFrom;
    const capturedTo   = state.routeTo;
    const aiVia        = state.routeVia ?? [];
    setRouteFrom(capturedFrom);
    setFromVal(capturedFrom.name);
    setRouteTo(capturedTo);
    setToVal(capturedTo.name);
    dispatch({ type: 'SET_ROUTE_FROM', station: capturedFrom });
    dispatch({ type: 'SET_ROUTE_TO',   station: capturedTo });
    dispatch({ type: 'SET_ROUTE_VIA',  via: null }); // consuma le via

    // ── Leggi e consuma i parametri di orario salvati dal chatbot AI ──
    const aiParamsRaw = sessionStorage.getItem('ai_route_params');
    sessionStorage.removeItem('ai_route_params');

    let date0 = new Date();
    try {
      const aiParams = aiParamsRaw ? JSON.parse(aiParamsRaw) : null;
      if (aiParams?.date) {
        const [y, m, d] = (aiParams.date as string).split('-').map(Number);
        date0 = new Date(y, m - 1, d);
        const p = (n: number) => String(n).padStart(2, '0');
        setDateStr(`${y}-${p(m)}-${p(d)}`);
      }
      if (aiParams?.time) {
        const [h, mn] = (aiParams.time as string).split(':').map(Number);
        date0.setHours(h, mn, 0, 0);
        setTimeStr(aiParams.time);
        // Se l'orario richiesto è già passato e non c'è una data esplicita,
        // avanza al giorno dopo (es. "parto alle 22" ma sono le 23 → domani)
        if (!aiParams?.date && date0 < new Date()) {
          date0.setDate(date0.getDate() + 1);
        }
      }
      // Sincronizza sempre il campo data col valore calcolato
      const _p = (n: number) => String(n).padStart(2, '0');
      setDateStr(`${date0.getFullYear()}-${_p(date0.getMonth() + 1)}-${_p(date0.getDate())}`);
    } catch {}

    if (aiVia.length > 0) {
      doSearchRouteWithVia(capturedFrom, aiVia, capturedTo, date0);
    } else {
      doSearchRoute(capturedFrom, capturedTo, date0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, state.routeFrom, state.routeTo, state.routeVia]);

  // ─── Autocomplete ──────────────────────────────────────────────────────────
  function doAcSearch(q: string, isFrom: boolean) {
    const setResults = isFrom ? setFromResults : setToResults;
    const setOpen = isFrom ? setFromDropOpen : setToDropOpen;
    const timerRef = isFrom ? fromTimer : toTimer;

    if (q.length < 2) { setOpen(false); setResults([]); return; }

    const local = searchCache(q);
    if (local !== null) {
      setResults(local.slice(0, 8));
      setOpen(local.length > 0);
      return;
    }

    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(async () => {
      let done = false;
      const pollInterval = setInterval(() => {
        if (done) { clearInterval(pollInterval); return; }
        const cached = searchCache(q);
        if (cached === null) return;
        clearInterval(pollInterval);
        done = true;
        setResults(cached.slice(0, 8));
        setOpen(cached.length > 0);
      }, 300);
      try {
        const list = await searchStationsAPI(q);
        if (done) return;
        clearInterval(pollInterval);
        done = true;
        setResults(list.slice(0, 8));
        setOpen(list.length > 0);
      } catch {
        clearInterval(pollInterval);
        if (!done) setOpen(false);
      }
    }, 380);
  }

  // ─── Chips ─────────────────────────────────────────────────────────────────
  function applyTimeChip(chip: string) {
    const now = new Date();
    const mins = chip === '+30m' ? 30 : chip === '+1h' ? 60 : chip === '+2h' ? 120 : 0;
    const base = new Date(now.getTime() + mins * 60000);
    const p = (n: number) => String(n).padStart(2, '0');
    setDateStr(`${base.getFullYear()}-${p(base.getMonth() + 1)}-${p(base.getDate())}`);
    setTimeStr(`${p(base.getHours())}:${p(base.getMinutes())}`);
  }

  function applyDateChip(chip: string) {
    const now = new Date();
    const offset = chip === 'Domani' ? 1 : 0;
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
    const p = (n: number) => String(n).padStart(2, '0');
    setDateStr(`${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`);
  }

  function swap() {
    setRouteFrom(routeTo);
    setRouteTo(routeFrom);
    setFromVal(toVal);
    setToVal(fromVal);
  }

  function saveFav() {
    if (!routeFrom || !routeTo) { showToast('Seleziona partenza e arrivo'); return; }
    const added = toggleRoute(routeFrom, routeTo);
    showToast(added ? 'Itinerario salvato' : 'Itinerario rimosso');
  }

  const isFav = routeFrom && routeTo ? isRouteFav(routeFrom.id, routeTo.id) : false;


  // ─── searchRoute (button handler) ─────────────────────────────────────────

  function searchRoute() {
    if (!routeFrom || !routeTo) { showToast('Inserisci stazione di partenza e arrivo'); return; }
    dispatch({ type: 'SET_ROUTE_FROM', station: routeFrom });
    dispatch({ type: 'SET_ROUTE_TO', station: routeTo });
    const date0 = dateStr ? new Date(`${dateStr}T${timeStr || '00:00'}`) : new Date();
    doSearchRoute(routeFrom, routeTo, date0);
  }

  // ─── searchNextDay ─────────────────────────────────────────────────────────

  function searchNextDay() {
    if (!routeFrom || !routeTo) return;
    const base = dateStr ? new Date(`${dateStr}T00:00`) : new Date();
    base.setDate(base.getDate() + 1);
    const p = (n: number) => String(n).padStart(2, '0');
    const next = `${base.getFullYear()}-${p(base.getMonth() + 1)}-${p(base.getDate())}`;
    setDateStr(next);
    setTimeStr('00:00');
    const date0 = new Date(`${next}T00:00`);
    doSearchRoute(routeFrom, routeTo, date0);
  }

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div>
      {/* Form */}
      <div className="px-3 pt-3 pb-2">

        {/* Da – autocomplete */}
        <div className="mb-2 position-relative route-input-wrap" id="wrap-from">
          <div className="input-group">
            <span className="input-group-text">
              <i className="bi bi-circle-fill text-primary" style={{ fontSize: '.5rem' }}></i>
            </span>
            <input
              type="text"
              className="form-control"
              placeholder="Partenza"
              value={fromVal}
              autoComplete="off"
              onChange={e => {
                const q = e.target.value;
                setFromVal(q);
                if (!q) setRouteFrom(null);
                doAcSearch(q, true);
              }}
              onFocus={() => {
                if (fromVal.trim().length >= 2 && fromResults.length > 0) setFromDropOpen(true);
              }}
            />
            {fromVal && (
              <button className="btn btn-outline-secondary" type="button"
                onClick={() => { setFromVal(''); setRouteFrom(null); setFromDropOpen(false); setFromResults([]); }}>
                <i className="bi bi-x-lg"></i>
              </button>
            )}
          </div>
          {fromDropOpen && fromResults.length > 0 && (
            <div className="ac-dropdown dropdown-menu show w-100" style={{ zIndex: 1050, position: 'absolute', top: '100%', left: 0 }}>
              {fromResults.map(s => (
                <button key={s.id} className="dropdown-item" type="button"
                  onClick={() => { setRouteFrom(s); setFromVal(s.name); setFromDropOpen(false); setFromResults([]); }}>
                  <i className="bi bi-train-front me-2 text-muted"></i>{s.name}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Swap */}
        <div className="d-flex justify-content-center mb-2">
          <button className="btn btn-sm btn-outline-secondary" type="button" onClick={swap}>
            <i className="bi bi-arrow-down-up"></i>
          </button>
        </div>

        {/* A – autocomplete */}
        <div className="mb-2 position-relative route-input-wrap" id="wrap-to">
          <div className="input-group">
            <span className="input-group-text">
              <i className="bi bi-geo-alt-fill text-danger" style={{ fontSize: '.85rem' }}></i>
            </span>
            <input
              type="text"
              className="form-control"
              placeholder="Arrivo"
              value={toVal}
              autoComplete="off"
              onChange={e => {
                const q = e.target.value;
                setToVal(q);
                if (!q) setRouteTo(null);
                doAcSearch(q, false);
              }}
              onFocus={() => {
                if (toVal.trim().length >= 2 && toResults.length > 0) setToDropOpen(true);
              }}
            />
            {toVal && (
              <button className="btn btn-outline-secondary" type="button"
                onClick={() => { setToVal(''); setRouteTo(null); setToDropOpen(false); setToResults([]); }}>
                <i className="bi bi-x-lg"></i>
              </button>
            )}
          </div>
          {toDropOpen && toResults.length > 0 && (
            <div className="ac-dropdown dropdown-menu show w-100" style={{ zIndex: 1050, position: 'absolute', top: '100%', left: 0 }}>
              {toResults.map(s => (
                <button key={s.id} className="dropdown-item" type="button"
                  onClick={() => { setRouteTo(s); setToVal(s.name); setToDropOpen(false); setToResults([]); }}>
                  <i className="bi bi-train-front me-2 text-muted"></i>{s.name}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Date / time row */}
        <div className="d-flex gap-2 mt-2 align-items-center flex-wrap">
          <input type="date" className="form-control form-control-sm" style={{ width: 'auto' }}
            value={dateStr} onChange={e => setDateStr(e.target.value)} />
          <input type="time" className="form-control form-control-sm" style={{ width: 'auto' }}
            value={timeStr} onChange={e => setTimeStr(e.target.value)} />
          <div className="d-flex gap-1 ms-auto flex-wrap">
            {(['Ora', '+30m', '+1h', '+2h'] as const).map(chip => (
              <button key={chip} type="button" className="btn btn-sm btn-outline-secondary route-time-btn"
                onClick={() => applyTimeChip(chip)}>
                {chip}
              </button>
            ))}
          </div>
        </div>

        {/* Date chips */}
        {(() => {
          const p = (n: number) => String(n).padStart(2, '0');
          const now = new Date();
          const chipDate = (offset: number) => {
            const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
            return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
          };
          const chipDates: Record<string, string> = {
            Oggi: chipDate(0), Domani: chipDate(1),
          };
          return (
            <div className="d-flex gap-2 mt-1">
              {(['Oggi', 'Domani'] as const).map(chip => (
                <button
                  key={chip}
                  type="button"
                  className={`btn btn-sm route-date-btn ${dateStr === chipDates[chip] ? 'btn-secondary' : 'btn-outline-secondary'}`}
                  onClick={() => applyDateChip(chip)}
                >
                  {chip}
                </button>
              ))}
            </div>
          );
        })()}

        {/* Action buttons */}
        <div className="d-flex gap-2 mt-2">
          <button className="btn btn-primary flex-grow-1" type="button" onClick={searchRoute}>
            <i className="bi bi-search me-1"></i>Cerca
          </button>
          <button className="btn btn-outline-secondary" type="button" onClick={saveFav}
            title={isFav ? 'Rimuovi dai preferiti' : 'Salva nei preferiti'}>
            <i className={`bi bi-star${isFav ? '-fill' : ''}`}></i>
          </button>
        </div>
      </div>

      {/* Results */}
      <div id="routeResults">

        {result.kind === 'loading' && (
          <div className="d-flex flex-column align-items-center justify-content-center py-5 text-muted">
            <div className="spinner-border text-primary" role="status" style={{ width: '2.5rem', height: '2.5rem' }}></div>
            <small className="mt-3">{result.message}</small>
          </div>
        )}

        {result.kind === 'error' && (
          <div className="text-center text-muted py-5">
            <i className="bi bi-wifi-off" style={{ fontSize: '3.5rem', opacity: .18 }}></i>
            <h6 className="mt-3 fw-semibold">{result.message}</h6>
            <p className="small mb-0">Verifica la connessione e riprova</p>
          </div>
        )}

        {result.kind === 'empty' && (
          <div className="text-center text-muted py-5">
            <i className="bi bi-map" style={{ fontSize: '3.5rem', opacity: .18 }}></i>
            <h6 className="mt-3 fw-semibold">Nessun treno trovato</h6>
            <p className="small mb-2">Prova a cambiare data o orario</p>
            {routeFrom && routeTo && (
              <button
                type="button"
                className="btn btn-outline-primary btn-sm"
                onClick={searchNextDay}
              >
                <i className="bi bi-calendar-arrow-up me-1"></i>Cerca il giorno dopo
              </button>
            )}
          </div>
        )}

        {result.kind === 'direct' && (
          <>
            <div className="px-3 py-2">
              <small className="text-muted fw-semibold">
                {result.fromName} → {result.toName}
                &nbsp;•&nbsp; {result.matches.length} treno{result.matches.length === 1 ? '' : 'i'}
              </small>
            </div>
            <div className="px-3">
              <button
                type="button"
                className="btn btn-outline-secondary btn-sm w-100 mb-3"
                disabled={prevBtnState === 'loading' || prevBtnState === 'done'}
                onClick={() => loadMoreRoute('prev')}
              >
                {prevBtnState === 'loading' ? (
                  <><span className="spinner-border spinner-border-sm me-1" role="status"></span>Caricamento…</>
                ) : prevBtnState === 'done' ? (
                  <><i className="bi bi-check me-1"></i>Nessun treno precedente</>
                ) : (
                  <><i className="bi bi-arrow-up me-1"></i>Treni precedenti</>
                )}
              </button>
            </div>
            <div className="px-3 pb-3" id="routeCardList">
              {result.matches.map(m => (
                <SolutionCard
                  key={`${m.dep.numeroTreno}|${m.dep.dataPartenzaTreno ?? ''}`}
                  match={m}
                  routeFromName={result.fromName}
                  routeToName={result.toName}
                  notifThresholds={notifThresholds}
                  onOpenTratta={openTratta}
                />
              ))}
            </div>
            <div className="px-3 pb-3">
              <button
                type="button"
                className="btn btn-outline-secondary btn-sm w-100"
                disabled={nextBtnState === 'loading' || nextBtnState === 'done'}
                onClick={() => loadMoreRoute('next')}
              >
                {nextBtnState === 'loading' ? (
                  <><span className="spinner-border spinner-border-sm me-1" role="status"></span>Caricamento…</>
                ) : nextBtnState === 'done' ? (
                  <><i className="bi bi-check me-1"></i>Nessun treno successivo</>
                ) : (
                  <><i className="bi bi-arrow-down me-1"></i>Treni successivi</>
                )}
              </button>
            </div>
          </>
        )}

        {result.kind === 'connections' && (
          <>
            <div className="px-3 py-2">
              <small className="text-muted fw-semibold">
                {result.fromName} → {result.toName}
                &nbsp;•&nbsp; {result.connections.length} soluzione{result.connections.length === 1 ? '' : 'i'} con{' '}
                {result.connections.some(c => c.type === '2hop') ? (
                  <>2 coincidenze <span className="badge bg-secondary ms-1">AI</span></>
                ) : 'coincidenza'}
              </small>
            </div>
            <div className="px-3 pb-3">
              {result.connections.map(c =>
                c.type === '2hop' ? (
                  <Connection2Card
                    key={c.key}
                    conn={c as Connection2Solution}
                    routeFromName={result.fromName}
                    routeToName={result.toName}
                    notifThresholds={notifThresholds}
                    onOpenTratta={openTratta}
                  />
                ) : (
                  <ConnectionCard
                    key={c.key}
                    conn={c as ConnectionSolution}
                    routeFromName={result.fromName}
                    routeToName={result.toName}
                    notifThresholds={notifThresholds}
                    onOpenTratta={openTratta}
                  />
                )
              )}
            </div>
          </>
        )}

      </div>
    </div>
  );
}

'use client';
import { useState, useRef, useEffect, useCallback } from 'react';
import { useStationsCache } from '@/hooks/useStationsCache';
import { useAppContext } from '@/context/AppContext';
import type { Station } from '@/lib/types';

const MAX_RECENT = 6;

function saveRecentStation(st: Station) {
  try {
    let r: Station[] = JSON.parse(localStorage.getItem('treni_recent_stations') || '[]');
    r = [st, ...r.filter(s => s.id !== st.id)].slice(0, MAX_RECENT);
    localStorage.setItem('treni_recent_stations', JSON.stringify(r));
  } catch {}
}

function getRecentStations(): Station[] {
  try { return JSON.parse(localStorage.getItem('treni_recent_stations') || '[]'); } catch { return []; }
}

interface Props { showToast: (msg: string) => void; }

export default function SearchPill({ showToast }: Props) {
  const { dispatch, state } = useAppContext();
  const { search, ready } = useStationsCache();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Station[]>([]);
  const [recentStations, setRecentStations] = useState<Station[]>([]);
  const [open, setOpen] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Carica le stazioni recenti solo lato client (evita hydration mismatch)
  useEffect(() => {
    setRecentStations(getRecentStations());
  }, []);

  // Sync input value with selected station
  useEffect(() => {
    if (state.station) setQuery(state.station.name);
  }, [state.station]);

  // Close on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, []);

  function selectStation(id: string, name: string) {
    const st = { id, name };
    saveRecentStation(st);
    setRecentStations(getRecentStations());
    setQuery(name);
    setOpen(false);
    dispatch({ type: 'SET_STATION', station: st });
    dispatch({ type: 'SET_PAGE', page: 'orari' });
    dispatch({ type: 'SET_DATE', date: null });
  }

  const handleInput = useCallback((q: string) => {
    setQuery(q);
    if (timerRef.current) clearTimeout(timerRef.current);
    if (q.length < 2) { setOpen(false); return; }

    const local = search(q);
    if (local !== null) {
      if (!local.length) { setOpen(false); return; }
      setResults(local.slice(0, 9));
      setOpen(true);
      return;
    }

    // Fallback API with debounce
    timerRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/stazioni?q=${encodeURIComponent(q)}`);
        const list: Station[] = await res.json();
        if (!list.length) { setOpen(false); return; }
        setResults(list.slice(0, 9));
        setOpen(true);
      } catch {
        showToast('Errore nella ricerca – riprova');
      }
    }, 380);
  }, [search, showToast]);

  function renderList() {
    const items = query.length >= 2 ? results : recentStations.slice(0, MAX_RECENT);
    if (!items.length) return null;
    return items.map(s => (
      <a key={s.id} href="#" className="list-group-item list-group-item-action ac-item d-flex align-items-center gap-2 py-3"
         onClick={e => { e.preventDefault(); selectStation(s.id, s.name); }}>
        <i className="bi bi-train-front text-primary flex-shrink-0"></i>
        <span>{s.name}</span>
      </a>
    ));
  }

  return (
    <div className="position-relative" ref={wrapRef}>
      <div className="search-pill d-flex align-items-center px-3 py-1 gap-2">
        {ready
          ? <i className="bi bi-search search-pill-icon flex-shrink-0"></i>
          : <span className="spin search-pill-icon flex-shrink-0" style={{fontSize:'1rem'}}>⟳</span>}
        <input
          type="text"
          className="form-control py-2 px-0 border-0"
          placeholder="Cerca stazione…"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          inputMode="search"
          value={query}
          onChange={e => handleInput(e.target.value)}
          onFocus={() => { if (query.length >= 2 && results.length > 0) setOpen(true); else if (query.length < 2) setOpen(true); }}
        />
        {query && (
          <button className="btn p-0 search-pill-clear flex-shrink-0" aria-label="Cancella"
                  onClick={() => { setQuery(''); setOpen(false); }}>
            <i className="bi bi-x-lg"></i>
          </button>
        )}
      </div>
      <div className={`ac-dropdown${open ? ' show' : ''}`}>
        <div className="list-group list-group-flush">
          {renderList()}
        </div>
      </div>
    </div>
  );
}

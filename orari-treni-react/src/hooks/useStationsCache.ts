'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import type { Station } from '@/lib/types';

const CACHE_KEY = 'treni_stations_v2';
const CACHE_TTL = 24 * 60 * 60 * 1000;

// ── Singleton condiviso tra tutte le istanze del hook ──────────────────────
let _shared: Station[]  = [];
let _ready              = false;
let _fetching           = false;
const _subscribers      = new Set<() => void>();

function _notify() { _subscribers.forEach(fn => fn()); }

async function _refresh(existing: Station[]) {
  if (_fetching) return;
  _fetching = true;
  const seen = new Set(existing.map(s => s.id));
  const working = [...existing];
  const letters = 'abcdefghijklmnopqrstuvwxyz'.split('');
  await Promise.all(
    letters.map(l =>
      fetch(`/api/stazioni?q=${encodeURIComponent(l)}`)
        .then(r => r.json())
        .catch(() => [])
        .then((list: Station[]) => {
          if (!list?.length) return;
          list.forEach(s => {
            if (s.id && s.name && !seen.has(s.id)) {
              seen.add(s.id);
              working.push(s);
            }
          });
          _shared = working;
        })
    )
  );
  _shared  = working;
  _ready   = true;
  _fetching = false;
  _notify();
  if (working.length > 100) {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify({ stations: working, ts: Date.now() })); } catch {}
  }
}

function _bootstrap() {
  if (_ready || _fetching) return;
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed?.stations?.length) {
        _shared = parsed.stations;
        _ready  = true;
        _notify();
        if (!parsed.ts || (Date.now() - parsed.ts) >= CACHE_TTL) {
          setTimeout(() => _refresh(_shared), 3000);
        }
        return;
      }
    }
  } catch {}
  _refresh([]);
}
// ──────────────────────────────────────────────────────────────────────────

export function useStationsCache() {
  const [ready, setReady] = useState(_ready);
  const readyRef = useRef(_ready);

  useEffect(() => {
    // Sottoscrivi aggiornamenti dal singleton
    const onUpdate = () => {
      readyRef.current = _ready;
      setReady(_ready);
    };
    _subscribers.add(onUpdate);
    // Avvia bootstrap (no-op se già in corso o completato)
    _bootstrap();
    // Se già pronto prima del montaggio, sincronizza subito
    if (_ready) { readyRef.current = true; setReady(true); }
    return () => { _subscribers.delete(onUpdate); };
  }, []);

  const search = useCallback((q: string): Station[] | null => {
    if (!readyRef.current) return null;
    const needle = q.toLowerCase().trim();
    if (!needle) return [];
    const results = _shared.filter(s => s.name.toLowerCase().includes(needle));
    results.sort((a, b) => {
      const al = a.name.toLowerCase();
      const bl = b.name.toLowerCase();
      return (al.startsWith(needle) ? 0 : 1) - (bl.startsWith(needle) ? 0 : 1)
        || al.localeCompare(bl, 'it');
    });
    return results;
  }, []);

  /** Cerca la stazione più simile nel nome; restituisce null se cache vuota */
  const findByName = useCallback((name: string): Station | null => {
    if (!_shared.length) return null;
    const needle = name.toLowerCase().trim();
    return _shared.find(s => s.name.toLowerCase() === needle)
        ?? _shared.find(s => s.name.toLowerCase().startsWith(needle))
        ?? _shared.find(s => s.name.toLowerCase().includes(needle))
        ?? null;
  }, []);

  return { search, ready, findByName };
}

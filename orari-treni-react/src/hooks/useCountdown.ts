'use client';
import { useState, useEffect } from 'react';

export function useCountdown(depTs: number | null, delayMin: number) {
  const [remaining, setRemaining] = useState<number | null>(null);
  useEffect(() => {
    if (!depTs) { setRemaining(null); return; }
    const actualTs = depTs + delayMin * 60000;
    const tick = () => {
      const diff = actualTs - Date.now();
      setRemaining(diff > 0 ? diff : null);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [depTs, delayMin]);
  return remaining;
}

export function formatCountdown(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const p = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${p(m)}:${p(s)}` : `${p(m)}:${p(s)}`;
}

export function getCountdownClass(ms: number): string {
  const sec = Math.floor(ms / 1000);
  if (sec < 300)  return 'countdown-value fw-bold fs-3 text-danger';
  if (sec < 900)  return 'countdown-value fw-bold fs-3 text-warning';
  return 'countdown-value fw-bold fs-3 text-success';
}

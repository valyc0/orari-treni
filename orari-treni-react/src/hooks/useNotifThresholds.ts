'use client';
import { useState, useEffect } from 'react';
import type { NotifThreshold } from '@/lib/types';

const KEY = 'notif_thresholds';
const DEFAULT: NotifThreshold[] = [
  { min: 10, enabled: true },
  { min: 5,  enabled: true },
  { min: 2,  enabled: true },
];

export function useNotifThresholds() {
  const [thresholds, setThresholds] = useState<NotifThreshold[]>(DEFAULT);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (saved) setThresholds(saved);
    } catch {}
  }, []);

  function save(t: NotifThreshold[]) {
    setThresholds(t);
    try { localStorage.setItem(KEY, JSON.stringify(t)); } catch {}
  }

  function addThreshold() {
    save([...thresholds, { min: 15, enabled: true }]);
  }

  function removeThreshold(i: number) {
    if (thresholds.length <= 1) return;
    save(thresholds.filter((_, idx) => idx !== i));
  }

  function updateThreshold(i: number, t: NotifThreshold) {
    const next = [...thresholds];
    next[i] = t;
    save(next);
  }

  function reset() {
    save(DEFAULT);
  }

  async function cancelAll() {
    if (!('serviceWorker' in navigator)) return 0;
    try {
      const reg = await navigator.serviceWorker.ready;
      const notifications = await reg.getNotifications();
      notifications.forEach(n => n.close());
      return notifications.length;
    } catch { return 0; }
  }

  return { thresholds, save, addThreshold, removeThreshold, updateThreshold, reset, cancelAll };
}

'use client';

export function useNotifications() {
  async function requestPermission() {
    if (!('Notification' in window) || !('serviceWorker' in navigator)) return;
    if (Notification.permission === 'default') {
      await Notification.requestPermission();
    }
  }

  async function sendNotification(title: string, body: string, tag: string, vibrate: number[]) {
    if (!('serviceWorker' in navigator) || Notification.permission !== 'granted') return;
    try {
      const reg = await navigator.serviceWorker.ready;
      reg.showNotification(title, {
        body,
        icon: '/icons/icon-192.png',
        tag,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        renotify: true,
        vibrate,
      } as any);
    } catch {}
  }

  function getVibrationPattern(rank: number): number[] {
    const pulse = 200 + rank * 100;
    const count = rank + 2;
    const pattern: number[] = [];
    for (let i = 0; i < count; i++) {
      pattern.push(pulse);
      if (i < count - 1) pattern.push(100);
    }
    return pattern;
  }

  async function cancelAll(): Promise<number> {
    if (!('serviceWorker' in navigator)) return 0;
    try {
      const reg = await navigator.serviceWorker.ready;
      const notifs = await reg.getNotifications();
      notifs.forEach(n => n.close());
      return notifs.length;
    } catch { return 0; }
  }

  return { requestPermission, sendNotification, getVibrationPattern, cancelAll };
}

'use strict';

/* ═══════════════════════════════════════════════
   NOTIFICHE – permission, invio, pattern vibrazione
═══════════════════════════════════════════════ */

async function requestNotifPermission() {
  if (!('Notification' in window) || !('serviceWorker' in navigator)) return;
  if (Notification.permission === 'default') {
    await Notification.requestPermission();
  }
}

async function sendNotification(title, body, tag, vibrate) {
  if (!('serviceWorker' in navigator) || Notification.permission !== 'granted') return;
  try {
    const reg = await navigator.serviceWorker.ready;
    reg.showNotification(title, {
      body,
      icon: './icons/icon-192.png',
      tag,
      renotify: true,
      vibrate,
    });
  } catch (_) { /* silenzioso */ }
}

/**
 * Restituisce un pattern di vibrazione in base al "rango" della soglia:
 *   rank 0 = soglia più lontana (es. 10 min) → 2 pulsazioni
 *   rank 1 = soglia intermedia (es. 5 min)   → 3 pulsazioni
 *   rank 2 = soglia più vicina (es. 2 min)   → 4 pulsazioni
 */
function getVibrationPattern(rank) {
  const pulse = 200 + rank * 100;
  const count = rank + 2;
  const pattern = [];
  for (let i = 0; i < count; i++) {
    pattern.push(pulse);
    if (i < count - 1) pattern.push(100);
  }
  return pattern;
}

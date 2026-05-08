'use strict';

/* ═══════════════════════════════════════════════
   IMPOSTAZIONI – soglie di notifica
═══════════════════════════════════════════════ */

function renderImpostazioni() {
  const list = document.getElementById('thresholdList');
  if (!list) return;
  list.innerHTML = notifThresholds.map((t, i) => `
    <div class="d-flex align-items-center gap-3 mb-3" id="thr-row-${i}">
      <div class="form-check form-switch mb-0 flex-shrink-0">
        <input class="form-check-input" type="checkbox" role="switch"
               id="thr-enabled-${i}" ${t.enabled ? 'checked' : ''}>
      </div>
      <div class="input-group input-group-sm" style="max-width:120px">
        <input type="number" class="form-control" id="thr-min-${i}"
               value="${t.min}" min="1" max="180">
        <span class="input-group-text">min</span>
      </div>
      <span class="text-muted small flex-grow-1">prima della partenza</span>
      <button class="btn btn-sm btn-outline-danger px-2" onclick="removeThreshold(${i})" title="Rimuovi">
        <i class="bi bi-trash"></i>
      </button>
    </div>
  `).join('');

  notifThresholds.forEach((_, i) => {
    document.getElementById(`thr-enabled-${i}`).addEventListener('change', saveThresholds);
    document.getElementById(`thr-min-${i}`).addEventListener('change', saveThresholds);
  });

  document.getElementById('btnAddThreshold').onclick = () => {
    notifThresholds.push({ min: 15, enabled: true });
    saveThresholds();
    renderImpostazioni();
  };
}

function saveThresholds() {
  notifThresholds = notifThresholds.map((t, i) => ({
    min:     Math.max(1, parseInt(document.getElementById(`thr-min-${i}`)?.value, 10) || t.min),
    enabled: document.getElementById(`thr-enabled-${i}`)?.checked ?? t.enabled,
  }));
  localStorage.setItem('notif_thresholds', JSON.stringify(notifThresholds));
}

function removeThreshold(index) {
  if (notifThresholds.length <= 1) return; // almeno 1 soglia
  notifThresholds.splice(index, 1);
  localStorage.setItem('notif_thresholds', JSON.stringify(notifThresholds));
  renderImpostazioni();
}

function resetThresholds() {
  notifThresholds = [
    { min: 10, enabled: true },
    { min: 5,  enabled: true },
    { min: 2,  enabled: true },
  ];
  localStorage.setItem('notif_thresholds', JSON.stringify(notifThresholds));
  renderImpostazioni();
  showToast('Soglie ripristinate ai valori default');
}

async function cancelAllNotifications() {
  if (!('serviceWorker' in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.ready;
    const notifications = await reg.getNotifications();
    notifications.forEach(n => n.close());
    showToast(`${notifications.length} notifiche annullate`);
  } catch (_) { showToast('Errore nell\'annullamento'); }
}

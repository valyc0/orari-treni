'use strict';

/* ═══════════════════════════════════════════════
   UTILS – funzioni di utilità condivise
═══════════════════════════════════════════════ */

/** Escape HTML per prevenire XSS nell'interpolazione di template. */
function esc(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

/** Formatta un oggetto Date come "HH:MM". */
function formatTime(d) {
  return String(d.getHours()).padStart(2,'0') + ':' + String(d.getMinutes()).padStart(2,'0');
}

/** Restituisce la data in formato "YYYY-MM-DDTHH:MM" nella timezone locale. */
function toLocalIso(d) {
  const p = n => String(n).padStart(2,'0');
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Restituisce [classBg, classTx] Bootstrap per la categoria treno. */
function getCatColors(cat) {
  if (/FR|AV/.test(cat))  return ['bg-danger',   'text-white'];
  if (/ICN/.test(cat))    return ['bg-cat-icn',   'text-white'];
  if (/IC/.test(cat))     return ['bg-cat-ic',    'text-white'];
  if (/EC/.test(cat))     return ['bg-warning',   'text-dark'];
  if (/REG|RV/.test(cat)) return ['bg-success',   'text-white'];
  return ['bg-secondary', 'text-white'];
}

/** Mostra un toast temporaneo con il messaggio dato. */
function showToast(msg) {
  const el = document.getElementById('appToast');
  document.getElementById('toastBody').textContent = msg;
  if (!_bsToast) _bsToast = bootstrap.Toast.getOrCreateInstance(el, { delay: 2600 });
  _bsToast.show();
}

/** HTML del spinner di caricamento. */
function renderLoading() {
  return `
  <div class="d-flex flex-column align-items-center justify-content-center py-5 text-muted">
    <div class="spinner-border text-primary" role="status" style="width:2.5rem;height:2.5rem"></div>
    <small class="mt-3">Caricamento…</small>
  </div>`;
}

/**
 * HTML di uno stato vuoto/errore uniforme.
 * @param {string} icon     - Nome icona Bootstrap (es. "wifi-off", "calendar-x")
 * @param {string} title    - Titolo principale
 * @param {string} subtitle - Sottotitolo
 */
function renderEmptyState(icon, title, subtitle) {
  return `
  <div class="text-center text-muted py-5">
    <i class="bi bi-${icon}" style="font-size:3rem;opacity:.25"></i>
    <h6 class="mt-3 fw-semibold">${title}</h6>
    <p class="small mb-0">${subtitle}</p>
  </div>`;
}

/**
 * HTML di una voce di autocomplete stazione (usato sia nella ricerca
 * principale sia nell'autocomplete dell'itinerario).
 */
function renderAcItem(s) {
  return `
  <a href="#" class="list-group-item list-group-item-action ac-item d-flex align-items-center gap-2 py-3"
     data-id="${esc(s.id)}" data-name="${esc(s.name)}">
    <i class="bi bi-train-front text-primary flex-shrink-0"></i>
    <span>${esc(s.name)}</span>
  </a>`;
}

/**
 * Imposta i chip di selezione orario rapido (Adesso / Mattina / …).
 * @param {string}   dateId   - id dell'input date
 * @param {string}   timeId   - id dell'input time
 * @param {string}   chipSel  - selettore CSS dei bottoni chip
 * @param {Function} onChange - callback chiamata dopo ogni selezione
 */
function setupTimeChips(dateId, timeId, chipSel, onChange) {
  const p = n => String(n).padStart(2, '0');
  document.querySelectorAll(chipSel).forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll(chipSel).forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const h = btn.dataset.hour;
      if (h === 'now') {
        const n = new Date();
        document.getElementById(dateId).value = toLocalIso(n).slice(0, 10);
        document.getElementById(timeId).value = `${p(n.getHours())}:${p(n.getMinutes())}`;
      } else {
        document.getElementById(timeId).value = `${p(parseInt(h))}:00`;
      }
      if (onChange) onChange();
    });
  });
  // Deseleziona i chip quando l'utente modifica l'orario manualmente
  document.getElementById(timeId).addEventListener('input', () => {
    document.querySelectorAll(chipSel).forEach(b => b.classList.remove('active'));
  });
}

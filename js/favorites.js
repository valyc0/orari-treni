'use strict';

/* ═══════════════════════════════════════════════
   PREFERITI – stazioni e itinerari salvati
═══════════════════════════════════════════════ */

function toggleFavorite() {
  if (!station) return;
  const idx = favorites.findIndex(f => f.type !== 'route' && f.id === station.id);
  if (idx >= 0) { favorites.splice(idx, 1); showToast('Rimosso dai preferiti'); }
  else          { favorites.push({ id: station.id, name: station.name }); showToast('Aggiunto ai preferiti ⭐'); }
  saveFavorites();
  const btn   = document.getElementById('btnFav');
  const isFav = favorites.some(f => f.type !== 'route' && f.id === station.id);
  if (btn) btn.innerHTML = `<i class="bi bi-star${isFav ? '-fill' : ''}"></i>`;
}

function toggleRouteFavorite() {
  if (!routeFrom || !routeTo) { showToast('Seleziona prima partenza e arrivo'); return; }
  const routeKey = `${routeFrom.id}→${routeTo.id}`;
  const idx = favorites.findIndex(f => f.type === 'route' && f.routeKey === routeKey);
  const btn = document.getElementById('btnSaveRoute');
  if (idx >= 0) {
    favorites.splice(idx, 1);
    showToast('Itinerario rimosso dai preferiti');
    if (btn) btn.innerHTML = `<i class="bi bi-star me-1"></i>Salva itinerario`;
  } else {
    favorites.push({
      type: 'route', routeKey,
      fromId: routeFrom.id, fromName: routeFrom.name,
      toId: routeTo.id,     toName: routeTo.name,
    });
    showToast('Itinerario salvato ⭐');
    if (btn) btn.innerHTML = `<i class="bi bi-star-fill me-1"></i>Salvato`;
  }
  saveFavorites();
}

function saveFavorites() {
  localStorage.setItem('treni_fav', JSON.stringify(favorites));
}

function renderFavorites() {
  const el = document.getElementById('favList');
  if (!el) return;

  if (!favorites.length) {
    el.innerHTML = `
      <div class="text-center text-muted py-5">
        <i class="bi bi-star" style="font-size:3.5rem;opacity:.18"></i>
        <h6 class="mt-3 fw-semibold">Nessun preferito</h6>
        <p class="small mb-0">Salva stazioni o itinerari con ☆</p>
      </div>`;
    return;
  }

  const stations = favorites.filter(f => f.type !== 'route');
  const routes   = favorites.filter(f => f.type === 'route');
  let html = '';

  if (stations.length) {
    html += `<div class="px-3 pt-3 pb-1"><small class="text-muted fw-semibold text-uppercase" style="font-size:.7rem;letter-spacing:.08em">Stazioni</small></div>`;
    html += `<div class="list-group list-group-flush px-3">` +
      stations.map(f => `
        <div class="list-group-item list-group-item-action border-0 rounded-3 mb-2 shadow-sm
                    d-flex align-items-center gap-3 py-3 fav-card"
             style="cursor:pointer" data-id="${esc(f.id)}" data-name="${esc(f.name)}">
          <div class="rounded-3 p-2 flex-shrink-0" style="background:#dbeafe">
            <i class="bi bi-train-front-fill text-primary fs-4"></i>
          </div>
          <div class="flex-grow-1 overflow-hidden">
            <div class="fw-bold text-truncate">${esc(f.name)}</div>
            <small class="text-muted">${esc(f.id)}</small>
          </div>
          <button class="btn btn-link text-danger p-1 flex-shrink-0 btn-remove-fav"
                  data-id="${esc(f.id)}" aria-label="Rimuovi">
            <i class="bi bi-x-circle-fill fs-5"></i>
          </button>
        </div>`).join('') + `</div>`;
  }

  if (routes.length) {
    html += `<div class="px-3 pt-3 pb-1"><small class="text-muted fw-semibold text-uppercase" style="font-size:.7rem;letter-spacing:.08em">Itinerari</small></div>`;
    html += `<div class="list-group list-group-flush px-3 pb-3">` +
      routes.map(f => `
        <div class="list-group-item list-group-item-action border-0 rounded-3 mb-2 shadow-sm
                    d-flex align-items-center gap-3 py-3 fav-route-card"
             style="cursor:pointer" data-from-id="${esc(f.fromId)}" data-from-name="${esc(f.fromName)}"
             data-to-id="${esc(f.toId)}" data-to-name="${esc(f.toName)}">
          <div class="rounded-3 p-2 flex-shrink-0" style="background:#dcfce7">
            <i class="bi bi-signpost-split-fill text-success fs-4"></i>
          </div>
          <div class="flex-grow-1 overflow-hidden">
            <div class="fw-bold text-truncate">${esc(f.fromName)}</div>
            <div class="d-flex align-items-center gap-1">
              <i class="bi bi-arrow-down text-muted" style="font-size:.75rem"></i>
              <span class="text-muted small text-truncate">${esc(f.toName)}</span>
            </div>
          </div>
          <button class="btn btn-link text-danger p-1 flex-shrink-0 btn-remove-route"
                  data-key="${esc(f.routeKey)}" aria-label="Rimuovi">
            <i class="bi bi-x-circle-fill fs-5"></i>
          </button>
        </div>`).join('') + `</div>`;
  }

  el.innerHTML = html;

  el.querySelectorAll('.fav-card').forEach(card =>
    card.addEventListener('click', e => {
      if (e.target.closest('.btn-remove-fav')) return;
      selectStation(card.dataset.id, card.dataset.name);
    }));

  el.querySelectorAll('.btn-remove-fav').forEach(btn =>
    btn.addEventListener('click', e => {
      e.stopPropagation();
      favorites = favorites.filter(f => f.type !== 'route' && f.id !== btn.dataset.id || f.type === 'route');
      saveFavorites(); renderFavorites();
      showToast('Rimosso dai preferiti');
    }));

  el.querySelectorAll('.fav-route-card').forEach(card =>
    card.addEventListener('click', e => {
      if (e.target.closest('.btn-remove-route')) return;
      routeFrom = { id: card.dataset.fromId, name: card.dataset.fromName };
      routeTo   = { id: card.dataset.toId,   name: card.dataset.toName   };
      showPage('itinerario');
      document.getElementById('routeFrom').value = card.dataset.fromName;
      document.getElementById('routeTo').value   = card.dataset.toName;
      document.getElementById('clearFrom').classList.remove('d-none');
      document.getElementById('clearTo').classList.remove('d-none');
      const routeKey = `${routeFrom.id}→${routeTo.id}`;
      const isSaved = favorites.some(f => f.type === 'route' && f.routeKey === routeKey);
      const btnS = document.getElementById('btnSaveRoute');
      if (btnS) btnS.innerHTML = `<i class="bi bi-star${isSaved ? '-fill' : ''}"></i>`;
      searchRoute();
    }));

  el.querySelectorAll('.btn-remove-route').forEach(btn =>
    btn.addEventListener('click', e => {
      e.stopPropagation();
      favorites = favorites.filter(f => f.routeKey !== btn.dataset.key);
      saveFavorites(); renderFavorites();
      showToast('Itinerario rimosso dai preferiti');
    }));
}

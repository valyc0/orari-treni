'use strict';

/* ═══════════════════════════════════════════════
   STATE – variabili globali di stato
═══════════════════════════════════════════════ */

// Proxy
let _proxyOk = null; // indice del proxy funzionante

// Orari page
let station     = null;
let activeTab   = 'partenze';
let chosenDate  = null;
let autoRefresh = false;
let refreshTimer = null;
let _shownTrainsKeys = new Set();

// Persistenza
let favorites = JSON.parse(localStorage.getItem('treni_fav') || '[]');
let notifThresholds = JSON.parse(localStorage.getItem('notif_thresholds') || 'null') || [
  { min: 10, enabled: true },
  { min: 5,  enabled: true },
  { min: 2,  enabled: true },
];

// UI
let _bsToast = null;

// Itinerario page
let routeFrom = null; // { id, name }
let routeTo   = null;
let _itinerarioInited = false;
let _countdownInterval = null;
let _shownRouteKeys = new Set();

// Tratta modal
let _trattaModal     = null;
let _trattaCard      = null;
let _trattaInterval  = null;
let _trattaCountdown = null;
const TRATTA_REFRESH_S = 30;

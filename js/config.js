'use strict';

/* ═══════════════════════════════════════════════
   CONFIG – costanti globali dell'applicazione
═══════════════════════════════════════════════ */

const VT_BASE    = 'https://www.viaggiatreno.it/infomobilita/resteasy/viaggiatreno';
const REFRESH_MS = 60_000;
const DAYS   = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

// CORS proxy pool – viene usato il primo che risponde correttamente
const PROXY_POOL = [
  u => `https://corsproxy.io/?url=${encodeURIComponent(u)}`,
  u => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
  u => `https://api.codetabs.com/v1/proxy/?quest=${encodeURIComponent(u)}`,
  u => `https://cors-proxy.fringe.zone/${u}`,
  u => `https://thingproxy.freeboard.io/fetch/${u}`,
];

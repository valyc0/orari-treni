'use strict';

/* ═══════════════════════════════════════════════
   CONFIG – costanti globali dell'applicazione
═══════════════════════════════════════════════ */

// L'API ViaggaTreno serve su HTTP (redirige HTTPS→HTTP): usiamo http:// direttamente
// per evitare che i proxy CORS falliscano sul downgrade di protocollo.
const VT_BASE    = 'http://www.viaggiatreno.it/infomobilita/resteasy/viaggiatreno';
const REFRESH_MS = 60_000;
const DAYS   = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

// CORS proxy pool – viene usato il primo che risponde correttamente
const PROXY_POOL = [
  u => `https://api.cors.lol/?url=${encodeURIComponent(u)}`,
  u => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
  u => `https://corsproxy.io/?url=${encodeURIComponent(u)}`,
];

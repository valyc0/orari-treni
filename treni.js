/*
 * treni.js è stato suddiviso in moduli separati nella cartella js/.
 *
 * Struttura:
 *   js/config.js        – costanti e pool proxy
 *   js/state.js         – variabili globali di stato
 *   js/utils.js         – funzioni di utilità (esc, formatTime, toast, …)
 *   js/api.js           – proxy fetch + chiamate ViaggaTreno API
 *   js/notifications.js – permessi e invio notifiche push
 *   js/settings.js      – pagina impostazioni (soglie notifica)
 *   js/favorites.js     – gestione preferiti (stazioni e itinerari)
 *   js/orari.js         – pagina orari partenze/arrivi
 *   js/tratta.js        – modal andamento treno
 *   js/connections.js   – ricerca con coincidenza
 *   js/itinerario.js    – pagina itinerario A→B + countdown
 *   js/navigation.js    – routing tra pagine + autocomplete stazione
 *   js/main.js          – inizializzazione
 *
 * Vedi index.html per l'ordine di caricamento.
 */

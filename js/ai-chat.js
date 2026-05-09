'use strict';

/* ═══════════════════════════════════════════════
   AI CHAT – assistente vocale per info sui treni
═══════════════════════════════════════════════ */

const AI_SYSTEM_PROMPT =
  `Sei un assistente esperto di treni italiani Trenitalia e RFI. ` +
  `Aiuti gli utenti con informazioni su orari tipici, coincidenze, tratte, stazioni, binari, ` +
  `tariffe, abbonamenti e servizi ferroviari italiani. ` +
  `Conosci bene la rete: linee regionali (FL1-FL8 di Roma, S-Milano, ecc.), ` +
  `Intercity, Frecciarossa, Frecciargento, Frecciabianca, Italo, ` +
  `e le principali stazioni hub (Roma Termini, Milano Centrale, Napoli Centrale, ecc.). ` +
  `Rispondi SEMPRE in italiano, in modo conciso e diretto. ` +
  `Se l'utente chiede orari in tempo reale, spiega che non hai dati live ` +
  `ma puoi fornire indicazioni su orari tipici e percorsi abituali.\n\n` +
  `ITINERARI: Quando l'utente chiede come andare da un posto a un altro, descrivi il percorso ` +
  `E aggiungi OBBLIGATORIAMENTE come ULTIMA riga della risposta il marcatore:\n` +
  `[ROUTE:{"from":"STAZIONE_PARTENZA","to":"STAZIONE_DESTINAZIONE"}]\n` +
  `Usa nomi di stazioni Trenitalia standard (es. "Roma Termini", "Villa Bonelli", "Isernia").\n\n` +
  `ORARI nel marcatore – segui queste regole:\n` +
  `• Orario di PARTENZA ("parto alle X", "dalle X", "dopo le X"): aggiungi "time":"HH:MM".\n` +
  `• Orario di ARRIVO ("arrivo entro le X", "voglio essere lì alle X", "entro le X"):\n` +
  `  - calcola la durata tipica del viaggio\n` +
  `  - sottrai la durata dall'orario di arrivo per ottenere l'orario di partenza stimato\n` +
  `  - metti l'orario di PARTENZA stimato in "time":"HH:MM"\n` +
  `  - metti l'orario di arrivo richiesto in "arriveBy":"HH:MM"\n` +
  `  Esempio: Roma→Milano ~3h, arrivo entro 14:00 → "time":"11:00","arriveBy":"14:00"\n` +
  `• Date relative ("domani", "venerdì", ecc.): calcola la data assoluta in "date":"YYYY-MM-DD".\n` +
  `NON includere il marcatore per domande generiche non legate a un itinerario specifico.`;

let _aiHistory     = [];
let _ttsEnabled    = false;
let _isListening   = false;
let _recognition   = null;
const _pendingRoutes = [];   // route data salvati per i bottoni "cerca itinerario"

/* ── Apri / chiudi pannello ── */

function openAIChat() {
  document.getElementById('aiChatPanel').classList.add('open');
  const bd = document.getElementById('aiChatBackdrop');
  bd.classList.remove('d-none');
  requestAnimationFrame(() => bd.classList.add('show'));
  setTimeout(() => document.getElementById('aiChatInput')?.focus(), 320);
  if (_aiHistory.length === 0) {
    _appendMsg('assistant',
      'Ciao! Sono il tuo assistente per i treni italiani 🚂\n' +
      'Chiedimi pure su orari, coincidenze, stazioni o qualsiasi info ferroviaria.\n' +
      'Puoi anche usare il microfono 🎤 per parlare.');
  }
}

function closeAIChat() {
  document.getElementById('aiChatPanel').classList.remove('open');
  const bd = document.getElementById('aiChatBackdrop');
  bd.classList.remove('show');
  setTimeout(() => bd.classList.add('d-none'), 280);
  _stopVoice();
  if (_ttsEnabled) window.speechSynthesis?.cancel();
}

/* ── Messaggi ── */

function _appendMsg(role, text) {
  const container = document.getElementById('aiChatMessages');
  const div       = document.createElement('div');
  div.className   = `ai-msg ai-msg-${role}`;
  div.innerHTML   = `<div class="ai-bubble">${esc(text).replace(/\n/g, '<br>')}</div>`;
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
  _aiHistory.push({ role, content: text });
  if (role === 'assistant' && _ttsEnabled) _speak(text);
}

function _showTyping() {
  const container = document.getElementById('aiChatMessages');
  const div       = document.createElement('div');
  div.id          = 'aiTypingIndicator';
  div.className   = 'ai-msg ai-msg-assistant';
  div.innerHTML   = `<div class="ai-bubble ai-typing"><span></span><span></span><span></span></div>`;
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}
function _hideTyping() { document.getElementById('aiTypingIndicator')?.remove(); }

/** Aggiunge una card-azione "Cerca itinerario" nel pannello chat. */
function _appendRouteButton(routeData) {
  const idx       = _pendingRoutes.push(routeData) - 1;
  const container = document.getElementById('aiChatMessages');
  const div       = document.createElement('div');
  div.className   = 'ai-msg ai-msg-assistant';

  // Riga data/ora: mostra il vincolo temporale originale dell'utente
  let timeHtml = '';
  if (routeData.date || routeData.time || routeData.arriveBy) {
    const datePart = routeData.date ? `<strong>${routeData.date}</strong> ` : '';
    const timePart = routeData.arriveBy
      ? `<span class="badge bg-warning text-dark ms-1">arrivo entro ${routeData.arriveBy}</span>` +
        (routeData.time ? ` <span class="text-muted">(partenza ~${routeData.time})</span>` : '')
      : routeData.time
        ? `<span class="badge bg-light text-dark border ms-1">partenza ${routeData.time}</span>`
        : '';
    timeHtml = `<div class="small mt-1">${datePart}${timePart}</div>`;
  }

  div.innerHTML = `
    <div class="ai-bubble ai-route-action">
      <div class="d-flex align-items-center gap-2 mb-2">
        <i class="bi bi-map-fill text-primary"></i>
        <span class="fw-semibold small">Itinerario trovato</span>
      </div>
      <div class="small text-muted mb-1">
        <i class="bi bi-circle-fill text-success me-1" style="font-size:.4rem;vertical-align:middle"></i>${esc(routeData.from)}<br>
        <i class="bi bi-geo-alt-fill text-danger me-1"></i>${esc(routeData.to)}
      </div>
      ${timeHtml}
      <button class="btn btn-primary btn-sm w-100 mt-2" onclick="openRouteFromAI(${idx})">
        <i class="bi bi-search me-1"></i>Cerca orari e coincidenze
      </button>
    </div>`;
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

/**
 * Apre la tab Itinerario e avvia la ricerca con i dati forniti dall'AI.
 * Cercal le stazioni per nome tramite l'API ViaggaTreno, poi chiama searchRoute().
 */
async function openRouteFromAI(idx) {
  const routeData = _pendingRoutes[idx];
  if (!routeData) return;

  closeAIChat();
  showPage('itinerario');

  const resEl = document.getElementById('routeResults');
  resEl.innerHTML = `<div class="d-flex justify-content-center py-5">
    <div class="spinner-border text-primary" role="status"></div>
    <span class="ms-3 text-secondary align-self-center">Ricerca stazioni…</span>
  </div>`;

  try {
    const [fromList, toList] = await Promise.all([
      searchStations(routeData.from),
      searchStations(routeData.to),
    ]);

    resEl.innerHTML = '';

    // Riempie i campi del form con quello che abbiamo trovato
    const fillField = (elId, clearId, st, fallback) => {
      if (st) {
        document.getElementById(elId).value = st.name;
        document.getElementById(clearId).classList.remove('d-none');
      } else {
        document.getElementById(elId).value = fallback; // nome grezzo dall'AI
      }
    };

    const from = fromList[0] || null;
    const to   = toList[0]   || null;

    routeFrom = from;
    routeTo   = to;
    fillField('routeFrom', 'clearFrom', from, routeData.from);
    fillField('routeTo',   'clearTo',   to,   routeData.to);

    if (routeData.date) document.getElementById('routeDate').value = routeData.date;
    if (routeData.time) document.getElementById('routeTime').value = routeData.time;

    if (!from || !to) {
      showToast('Stazione non trovata – controlla i campi e premi Cerca');
      return;
    }

    // Se era un vincolo di arrivo, aggiunge banner informativo dopo il rendering dei risultati
    if (routeData.arriveBy) {
      const arriveBy = routeData.arriveBy;
      const depTime  = routeData.time || '?';
      const observer = new MutationObserver(() => {
        if (resEl.firstElementChild && !resEl.querySelector('.ai-arrive-banner')) {
          observer.disconnect();
          const banner = document.createElement('div');
          banner.className = 'ai-arrive-banner alert alert-warning d-flex align-items-center gap-2 py-2 mx-3 mb-2 small';
          banner.innerHTML = `<i class="bi bi-clock-fill flex-shrink-0"></i>
            Risultati per <strong>arrivare entro le ${esc(arriveBy)}</strong>
            · partenza stimata: <strong>${esc(depTime)}</strong>`;
          resEl.prepend(banner);
        }
      });
      observer.observe(resEl, { childList: true });
      setTimeout(() => observer.disconnect(), 10000);
    }

    searchRoute();
  } catch (err) {
    console.error('[AIRoute]', err);
    resEl.innerHTML = '';
    showToast('Errore nella ricerca – riprova');
  }
}

/* ── Invio messaggio ── */

async function sendAIMessage() {
  const input = document.getElementById('aiChatInput');
  const text  = (input.value || '').trim();
  if (!text) return;
  input.value = '';

  _appendMsg('user', text);
  _showTyping();

  const ok = await loadPuter();
  if (!ok) {
    _hideTyping();
    _appendMsg('assistant', '⚠️ Servizio AI non disponibile. Riprova più tardi.');
    return;
  }

  try {
    // Data odierna nel prompt per gestire date relative ("domani", "venerdì", ecc.)
    const todayStr = new Date().toLocaleDateString('it-IT',
      { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    const messages = [
      { role: 'system', content: AI_SYSTEM_PROMPT + `\n\nData e ora corrente: ${todayStr}.` },
      ..._aiHistory.slice(-14),   // ultimi 7 scambi (14 messaggi)
    ];
    const raw   = await puter.ai.chat(messages, { model: 'gpt-4o-mini' });
    let   reply = typeof raw === 'string' ? raw
      : (raw?.message?.content || raw?.content || String(raw));
    reply = reply.trim();

    // Estrai marcatore [ROUTE:{...}] se presente (JSON piatto, no nested)
    const routeMatch = reply.match(/\[ROUTE:(\{[^}]+\})\]/i);
    let routeData = null;
    if (routeMatch) {
      try   { routeData = JSON.parse(routeMatch[1]); }
      catch (_) { /* formato non valido, ignora */ }
      reply = reply.replace(/\[ROUTE:[^\]]+\]/i, '').trim();
    }

    _hideTyping();
    _appendMsg('assistant', reply);
    if (routeData?.from && routeData?.to) _appendRouteButton(routeData);
  } catch (err) {
    _hideTyping();
    console.error('[AIChat]', err);
    _appendMsg('assistant', '⚠️ Errore nella risposta. Riprova tra poco.');
  }
}

/* ── Voce input (SpeechRecognition) ── */

let _micGotResult = false;

function toggleVoiceInput() {
  if (_isListening) { _stopVoice(); return; }

  const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRec) {
    showToast('Riconoscimento vocale non supportato');
    return;
  }

  _recognition = new SpeechRec();
  _recognition.lang            = 'it-IT';
  _recognition.continuous      = false;
  _recognition.interimResults  = false;
  _recognition.maxAlternatives = 1;
  _micGotResult                = false;

  _recognition.onstart = () => {
    _isListening = true;
    const btn = document.getElementById('aiMicBtn');
    btn.classList.add('btn-danger', 'ai-mic-active');
    btn.classList.remove('btn-outline-secondary');
    btn.innerHTML = '<i class="bi bi-mic-fill"></i>';
  };

  // Solo cattura il testo – NON chiama stop() qui (evita doppio onend)
  _recognition.onresult = e => {
    const transcript = (e.results[0][0].transcript || '').trim();
    if (transcript) {
      document.getElementById('aiChatInput').value = transcript;
      _micGotResult = true;
    }
  };

  // onend è il punto unico di cleanup; invia solo se abbiamo testo
  _recognition.onend = () => {
    const shouldSend = _micGotResult;
    _stopVoice();               // resetta UI e flag
    if (shouldSend) sendAIMessage();
  };

  // onerror separato: gestisce no-speech / not-allowed / ecc.
  _recognition.onerror = e => {
    const err = e.error;
    if (err !== 'no-speech' && err !== 'aborted') {
      showToast(err === 'not-allowed'
        ? 'Permesso microfono negato'
        : `Errore microfono: ${err}`);
    }
    // onend seguirà comunque, lasciamo che faccia il cleanup
  };

  try {
    _recognition.start();
  } catch (ex) {
    console.warn('[Mic] start error', ex);
    _stopVoice();
  }
}

function _stopVoice() {
  if (!_isListening && !_recognition) return;  // già fermato
  _isListening  = false;
  _micGotResult = false;
  // Null prima di stop() per evitare ri-entrata da onend
  const rec = _recognition;
  _recognition  = null;
  try { rec?.stop(); } catch (_) {}
  const btn = document.getElementById('aiMicBtn');
  if (!btn) return;
  btn.classList.remove('btn-danger', 'ai-mic-active');
  btn.classList.add('btn-outline-secondary');
  btn.innerHTML = '<i class="bi bi-mic"></i>';
}

/* ── TTS (SpeechSynthesis) ── */

function toggleAITTS() {
  _ttsEnabled = !_ttsEnabled;
  const btn = document.getElementById('aiTtsBtn');
  btn.classList.toggle('btn-primary',          _ttsEnabled);
  btn.classList.toggle('btn-outline-secondary', !_ttsEnabled);
  if (!_ttsEnabled) window.speechSynthesis?.cancel();
}

function _speak(text) {
  if (!window.speechSynthesis) return;
  speechSynthesis.cancel();
  const utt  = new SpeechSynthesisUtterance(text.replace(/<[^>]+>/g, ''));
  utt.lang   = 'it-IT';
  utt.rate   = 1.05;
  speechSynthesis.speak(utt);
}

/* ── Keyboard enter ── */

document.getElementById('aiChatInput')?.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendAIMessage(); }
});

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
  `ma puoi fornire indicazioni su orari tipici e percorsi abituali.`;

let _aiHistory   = [];
let _ttsEnabled  = false;
let _isListening = false;
let _recognition = null;

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
    const messages = [
      { role: 'system', content: AI_SYSTEM_PROMPT },
      ..._aiHistory.slice(-14),   // ultimi 7 scambi (14 messaggi)
    ];
    const raw   = await puter.ai.chat(messages, { model: 'gpt-4o-mini' });
    const reply = typeof raw === 'string' ? raw
      : (raw?.message?.content || raw?.content || String(raw));
    _hideTyping();
    _appendMsg('assistant', reply.trim());
  } catch (err) {
    _hideTyping();
    console.error('[AIChat]', err);
    _appendMsg('assistant', '⚠️ Errore nella risposta. Riprova tra poco.');
  }
}

/* ── Voce input (SpeechRecognition) ── */

function toggleVoiceInput() {
  if (_isListening) { _stopVoice(); return; }

  const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRec) {
    showToast('Riconoscimento vocale non supportato');
    return;
  }

  _recognition = new SpeechRec();
  _recognition.lang            = 'it-IT';
  _recognition.interimResults  = false;
  _recognition.maxAlternatives = 1;

  _recognition.onstart = () => {
    _isListening = true;
    const btn = document.getElementById('aiMicBtn');
    btn.classList.add('btn-danger', 'ai-mic-active');
    btn.classList.remove('btn-outline-secondary');
    btn.innerHTML = '<i class="bi bi-mic-fill"></i>';
  };

  _recognition.onresult = e => {
    const transcript = e.results[0][0].transcript.trim();
    document.getElementById('aiChatInput').value = transcript;
    _stopVoice();
    sendAIMessage();
  };

  _recognition.onerror = _recognition.onend = () => _stopVoice();
  _recognition.start();
}

function _stopVoice() {
  _isListening = false;
  _recognition?.stop();
  _recognition = null;
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

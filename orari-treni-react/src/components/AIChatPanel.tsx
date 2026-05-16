'use client';
import { useState, useRef, useCallback } from 'react';
import { useAppContext } from '@/context/AppContext';
import { useStationsCache } from '@/hooks/useStationsCache';
import type { Station } from '@/lib/types';

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
  `Usa SEMPRE i nomi ufficiali Trenitalia (es. "Roma Termini", "Firenze Santa Maria Novella", "Milano Centrale", "Napoli Centrale").\n\n` +
  `STAZIONI INTERMEDIE (CAMBI): Se il percorso richiede uno o più cambi, aggiungi "via" con le stazioni hub dove si cambia treno, IN ORDINE di percorrenza, max 4:\n` +
  `[ROUTE:{"from":"Roma Termini","via":["Firenze Santa Maria Novella","Bologna Centrale"],"to":"Torino Porta Nuova"}]\n` +
  `Per percorsi DIRETTI (nessun cambio) ometti completamente "via".\n` +
  `Verifica che ogni stazione che inserisci in "from", "via" e "to" esista nella rete Trenitalia con quel nome esatto.\n\n` +
  `ORARI nel marcatore – segui queste regole:\n` +
  `• Orario di PARTENZA ("parto alle X", "dalle X", "dopo le X"): aggiungi "time":"HH:MM".\n` +
  `• Orario di ARRIVO ("arrivo entro le X", "voglio essere lì alle X", "entro le X"):\n` +
  `  - calcola la durata tipica del viaggio\n` +
  `  - sottrai la durata dall'orario di arrivo per ottenere l'orario di partenza stimato\n` +
  `  - metti l'orario di PARTENZA stimato in "time":"HH:MM"\n` +
  `  - metti l'orario di arrivo richiesto in "arriveBy":"HH:MM"\n` +
  `  Esempio: Roma→Milano ~3h, arrivo entro 14:00 → "time":"11:00","arriveBy":"14:00"\n` +
  `• Date relative ("domani", "venerdì", "stasera", "questa sera", "domani mattina", ecc.): calcola la data assoluta in "date":"YYYY-MM-DD".\n` +
  `• Nessuna data specificata: ometti "date" — il sistema gestisce automaticamente gli orari già passati.\n` +
  `NON includere il marcatore per domande generiche non legate a un itinerario specifico.`;

declare const puter: any;
let _puterLoading = false;

async function loadPuter(): Promise<boolean> {
  if (typeof puter !== 'undefined') return true;
  if (_puterLoading) {
    return new Promise(resolve => {
      const wait = setInterval(() => {
        if (typeof puter !== 'undefined') { clearInterval(wait); resolve(true); }
      }, 100);
      setTimeout(() => { clearInterval(wait); resolve(false); }, 10000);
    });
  }
  _puterLoading = true;
  return new Promise(resolve => {
    const s = document.createElement('script');
    s.src = 'https://js.puter.com/v2/';
    s.onload  = () => { _puterLoading = false; resolve(true); };
    s.onerror = () => { _puterLoading = false; resolve(false); };
    document.head.appendChild(s);
  });
}

function esc(s: unknown): string {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

interface AIMessage { role: 'user' | 'assistant'; content: string; }
interface RouteData { from: string; via?: string[]; to: string; time?: string; arriveBy?: string; date?: string; }

interface Props { showToast: (msg: string) => void; }

export default function AIChatPanel({ showToast }: Props) {
  const { dispatch } = useAppContext();
  const { findByName } = useStationsCache();
  const [open, setOpen]           = useState(false);
  const [messages, setMessages]   = useState<Array<{ role: string; content: string; isRoute?: boolean; routeData?: RouteData }>>([]);
  const [input, setInput]         = useState('');
  const [typing, setTyping]       = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [ttsEnabled, setTtsEnabled] = useState(false);
  const historyRef    = useRef<AIMessage[]>([]);
  const recognitionRef= useRef<any>(null);
  const micGotResult  = useRef(false);
  const messagesEndRef= useRef<HTMLDivElement>(null);

  const scrollBottom = useCallback(() => {
    setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
  }, []);

  const speak = useCallback((text: string) => {
    if (!window.speechSynthesis) return;
    speechSynthesis.cancel();
    const utt = new SpeechSynthesisUtterance(text.replace(/<[^>]+>/g, ''));
    utt.lang = 'it-IT'; utt.rate = 1.05;
    speechSynthesis.speak(utt);
  }, []);

  const addMessage = useCallback((role: 'user'|'assistant', content: string, routeData?: RouteData) => {
    setMessages(prev => [...prev, { role, content, isRoute: !!routeData, routeData }]);
    historyRef.current.push({ role, content });
    if (role === 'assistant' && ttsEnabled) speak(content);
    scrollBottom();
  }, [ttsEnabled, speak, scrollBottom]);

  const openPanel = useCallback(() => {
    setOpen(true);
    if (historyRef.current.length === 0) {
      addMessage('assistant',
        'Ciao! Sono il tuo assistente per i treni italiani 🚂\n' +
        'Chiedimi pure su orari, coincidenze, stazioni o qualsiasi info ferroviaria.\n' +
        'Puoi anche usare il microfono 🎤 per parlare.');
    }
  }, [addMessage]);

  const closePanel = useCallback(() => {
    setOpen(false);
    stopVoice();
    if (ttsEnabled) window.speechSynthesis?.cancel();
  }, [ttsEnabled]);

  const resetChat = useCallback(() => {
    setMessages([]);
    historyRef.current = [];
    if (ttsEnabled) window.speechSynthesis?.cancel();
    addMessage('assistant',
      'Ciao! Sono il tuo assistente per i treni italiani 🚂\n' +
      'Chiedimi pure su orari, coincidenze, stazioni o qualsiasi info ferroviaria.\n' +
      'Puoi anche usare il microfono 🎤 per parlare.');
  }, [ttsEnabled, addMessage]);

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text) return;
    setInput('');
    addMessage('user', text);
    setTyping(true);

    const ok = await loadPuter();
    if (!ok) {
      setTyping(false);
      addMessage('assistant', '⚠️ Servizio AI non disponibile. Riprova più tardi.');
      return;
    }

    try {
      const todayStr = new Date().toLocaleDateString('it-IT', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
      const msgs = [
        { role: 'system', content: AI_SYSTEM_PROMPT + `\n\nData e ora corrente: ${todayStr}.` },
        ...historyRef.current.slice(-14),
      ];
      const raw = await puter.ai.chat(msgs, { model: 'gpt-4o-mini' });
      let reply = typeof raw === 'string' ? raw : (raw?.message?.content || raw?.content || String(raw));
      reply = reply.trim();

      const routeMatch = reply.match(/\[ROUTE:(\{[^}]+\})\]/i);
      let routeData: RouteData | undefined;
      if (routeMatch) {
        try { routeData = JSON.parse(routeMatch[1]); } catch {}
        reply = reply.replace(/\[ROUTE:[^\]]+\]/i, '').trim();
      }

      setTyping(false);
      addMessage('assistant', reply, routeData?.from && routeData?.to ? routeData : undefined);
    } catch {
      setTyping(false);
      addMessage('assistant', '⚠️ Errore nella risposta. Riprova tra poco.');
    }
  }, [input, addMessage]);

  /** Risolve nome stazione → Station: cache → API → AI correction → API */
  const resolveStation = useCallback(async (name: string): Promise<Station | null> => {
    // 1. Cache locale
    const cached = findByName(name);
    if (cached) return cached;

    // 2. API ViaggiaTreno
    try {
      const list: Station[] = await fetch(`/api/stazioni?q=${encodeURIComponent(name)}`).then(r => r.json());
      if (list.length > 0) return list[0];
    } catch {}

    // 3. Chiedi all'AI il nome corretto e riprova
    try {
      await loadPuter();
      const aiReply = await (window as any).puter.ai.chat(
        `La stazione ferroviaria italiana "${name}" non esiste nel database ViaggiaTreno. ` +
        `Rispondi SOLO con il nome esatto della stazione italiana equivalente nel formato Trenitalia (es. "ROMA TERMINI", "MILANO CENTRALE"). Nessun altro testo.`,
        { model: 'gpt-4o-mini' }
      );
      const corrected: string = (typeof aiReply === 'string' ? aiReply : (aiReply?.message?.content ?? '')).trim().toUpperCase();
      if (corrected) {
        const list2: Station[] = await fetch(`/api/stazioni?q=${encodeURIComponent(corrected)}`).then(r => r.json());
        if (list2.length > 0) return list2[0];
      }
    } catch {}

    return null;
  }, [findByName]);

  const openRouteFromAI = useCallback(async (routeData: RouteData) => {
    closePanel();
    try {
      // Risolvi tutte le stazioni in parallelo (from + via[] + to)
      const allNames = [routeData.from, ...(routeData.via ?? []), routeData.to];
      const resolved = await Promise.all(allNames.map(n => resolveStation(n)));

      const from = resolved[0];
      const to   = resolved[resolved.length - 1];
      const via  = resolved.slice(1, -1).filter((s): s is Station => s !== null);

      if (from) dispatch({ type: 'SET_ROUTE_FROM', station: from });
      if (to)   dispatch({ type: 'SET_ROUTE_TO',   station: to });
      dispatch({ type: 'SET_ROUTE_VIA', via: via.length ? via : null });
      if (routeData.time || routeData.date || routeData.arriveBy) {
        sessionStorage.setItem('ai_route_params', JSON.stringify({ time: routeData.time, date: routeData.date, arriveBy: routeData.arriveBy }));
      }
      dispatch({ type: 'SET_PAGE', page: 'itinerario' });

      const missing = allNames.filter((n, i) => !resolved[i]);
      if (missing.length) showToast(`Stazione non trovata: ${missing.join(', ')}`);
    } catch {
      showToast('Errore nella ricerca stazioni');
    }
  }, [closePanel, dispatch, showToast, resolveStation]);

  function stopVoice() {
    setIsListening(false);
    micGotResult.current = false;
    const rec = recognitionRef.current;
    recognitionRef.current = null;
    try { rec?.stop(); } catch {}
  }

  const toggleVoice = useCallback(() => {
    if (isListening) { stopVoice(); return; }
    const SpeechRec = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRec) { showToast('Riconoscimento vocale non supportato'); return; }

    const rec = new SpeechRec();
    recognitionRef.current = rec;
    rec.lang = 'it-IT'; rec.continuous = false; rec.interimResults = false; rec.maxAlternatives = 1;
    micGotResult.current = false;

    rec.onstart = () => setIsListening(true);
    rec.onresult = (e: any) => {
      const transcript = (e.results[0][0].transcript || '').trim();
      if (transcript) { setInput(transcript); micGotResult.current = true; }
    };
    rec.onend = () => {
      const shouldSend = micGotResult.current;
      stopVoice();
      if (shouldSend) {
        setTimeout(() => sendMessage(), 50);
      }
    };
    rec.onerror = (e: any) => {
      const err = e.error;
      if (err !== 'no-speech' && err !== 'aborted') {
        showToast(err === 'not-allowed' ? 'Permesso microfono negato' : `Errore microfono: ${err}`);
      }
    };
    try { rec.start(); } catch { stopVoice(); }
  }, [isListening, sendMessage, showToast]);

  return (
    <>
      {/* FAB */}
      <button
        className="btn btn-primary rounded-circle shadow-lg d-flex align-items-center justify-content-center ai-chat-fab"
        style={{ position: 'fixed', bottom: 80, right: 'max(20px, calc(50% - 300px))', width: 52, height: 52, zIndex: 1040 }}
        onClick={openPanel}
        title="Assistente AI">
        <i className="bi bi-robot fs-5"></i>
      </button>

      {/* Backdrop */}
      {open && (
        <div
          className="ai-chat-backdrop position-fixed top-0 start-0 w-100 h-100 show"
          style={{ zIndex: 1045, background: 'rgba(0,0,0,.35)', backdropFilter: 'blur(2px)' }}
          onClick={closePanel}
        />
      )}

      {/* Panel */}
      <div
        id="aiChatPanel"
        className={`ai-chat-panel position-fixed bottom-0 end-0 d-flex flex-column${open ? ' open' : ''}`}
        style={{
          zIndex: 1046,
          width: 'min(420px, 100vw)',
          height: '70vh',
          background: '#fff',
          borderRadius: '16px 16px 0 0',
          boxShadow: '0 -4px 24px rgba(0,0,0,.18)',
          transform: open ? 'translateY(0)' : 'translateY(110%)',
          transition: 'transform .28s cubic-bezier(.4,0,.2,1)',
        }}>
        {/* Header */}
        <div className="d-flex align-items-center gap-2 px-3 py-2 border-bottom flex-shrink-0">
          <i className="bi bi-robot text-primary fs-5"></i>
          <span className="fw-semibold">Assistente AI treni</span>
          <div className="ms-auto d-flex gap-2">
            <button
              id="aiTtsBtn"
              className={`btn btn-sm ${ttsEnabled ? 'btn-primary' : 'btn-outline-secondary'}`}
              title="Leggi ad alta voce"
              onClick={() => { setTtsEnabled(p => !p); if (ttsEnabled) window.speechSynthesis?.cancel(); }}>
              <i className="bi bi-volume-up"></i>
            </button>
            <button
              className="btn btn-sm btn-outline-secondary"
              title="Nuova conversazione"
              onClick={resetChat}>
              <i className="bi bi-trash3"></i>
            </button>
            <button className="btn btn-sm btn-outline-secondary" onClick={closePanel}>
              <i className="bi bi-x-lg"></i>
            </button>
          </div>
        </div>

        {/* Messages */}
        <div id="aiChatMessages" className="flex-grow-1 overflow-y-auto px-3 py-2" style={{ overflowX: 'hidden' }}>
          {messages.map((msg, idx) => (
            <div key={idx} className={`ai-msg ai-msg-${msg.role}`}>
              {msg.isRoute && msg.routeData ? (
                <div className="ai-bubble ai-route-action">
                  <div className="d-flex align-items-center gap-2 mb-2">
                    <i className="bi bi-map-fill text-primary"></i>
                    <span className="fw-semibold small">Itinerario trovato</span>
                  </div>
                  {msg.content && (
                    <div className="ai-bubble mb-2" style={{ background: 'none', padding: 0 }}>
                      {msg.content.split('\n').map((line, i) => <span key={i}>{line}<br/></span>)}
                    </div>
                  )}
                  <div className="small text-muted mb-1">
                    <i className="bi bi-circle-fill text-success me-1" style={{ fontSize: '.4rem', verticalAlign: 'middle' }}></i>
                    <span className="fw-semibold text-dark">{msg.routeData.from}</span>
                    {msg.routeData.via?.map((s, i) => (
                      <span key={i}><br/>
                        <i className="bi bi-arrow-down text-muted me-1" style={{ fontSize: '.75rem' }}></i>
                        <span className="text-primary">{s}</span>
                        <small className="text-muted ms-1">(cambio)</small>
                      </span>
                    ))}
                    <br/><i className="bi bi-geo-alt-fill text-danger me-1"></i>
                    <span className="fw-semibold text-dark">{msg.routeData.to}</span>
                  </div>
                  {(msg.routeData.date || msg.routeData.time || msg.routeData.arriveBy) && (
                    <div className="small mt-1">
                      {msg.routeData.date && <strong>{msg.routeData.date} </strong>}
                      {msg.routeData.arriveBy
                        ? <><span className="badge bg-warning text-dark ms-1">arrivo entro {msg.routeData.arriveBy}</span>{msg.routeData.time && <span className="text-muted"> (partenza ~{msg.routeData.time})</span>}</>
                        : msg.routeData.time && <span className="badge bg-light text-dark border ms-1">partenza {msg.routeData.time}</span>}
                    </div>
                  )}
                  <button className="btn btn-primary btn-sm w-100 mt-2" onClick={() => openRouteFromAI(msg.routeData!)}>
                    <i className="bi bi-search me-1"></i>Cerca orari e coincidenze
                  </button>
                </div>
              ) : (
                <div className="ai-bubble">
                  {msg.content.split('\n').map((line, i) => <span key={i}>{line}<br/></span>)}
                </div>
              )}
            </div>
          ))}
          {typing && (
            <div className="ai-msg ai-msg-assistant">
              <div className="ai-bubble ai-typing"><span/><span/><span/></div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div className="px-3 py-2 border-top flex-shrink-0">
          <div className="input-group">
            <input
              id="aiChatInput"
              type="text"
              className="form-control"
              placeholder="Scrivi un messaggio…"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
            />
            <button
              id="aiMicBtn"
              className={`btn ${isListening ? 'btn-danger ai-mic-active' : 'btn-outline-secondary'}`}
              onClick={toggleVoice}
              title="Microfono">
              <i className={`bi bi-mic${isListening ? '-fill' : ''}`}></i>
            </button>
            <button
              className="btn btn-primary"
              onClick={sendMessage}
              disabled={!input.trim() || typing}>
              <i className="bi bi-send-fill"></i>
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

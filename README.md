# orari-treni

Web app mobile-first per consultare gli orari dei treni italiani in tempo reale, basata sull'API pubblica di ViaggiaTreno (Trenitalia).

## Funzionalità

- **Ricerca stazione** con autocompletamento
- **Partenze e arrivi** per qualsiasi stazione, con possibilità di scegliere data e ora
- **Aggiornamento automatico** ogni 60 secondi
- **Stazioni preferite** salvate in locale (`localStorage`)
- **Ricerca itinerario** tra due stazioni
- **Proxy CORS automatico** con fallback su più provider pubblici
- Interfaccia responsive ottimizzata per dispositivi mobili (Bootstrap 5, navigazione bottom bar)

## Struttura

| File | Descrizione |
|------|-------------|
| `index.html` | Interfaccia utente (HTML + CSS) |
| `treni.js` | Logica applicativa (vanilla JS) |
| `serve.sh` | Avvia un server HTTP locale su porta 8080 |

## Avvio

```bash
./serve.sh
```

Il server si avvia su **HTTPS porta 4443** (genera automaticamente un certificato self-signed al primo avvio):

- `https://localhost:4443`
- `https://<IP-locale>:4443`

**Per installare come app (PWA):** alla prima visita accetta l'avviso di sicurezza del browser, poi usa il menu "Aggiungi alla schermata Home" (Android/iOS) o l'icona di installazione nella barra degli indirizzi (Chrome desktop).

---

## Come funziona il calcolo delle coincidenze

L'algoritmo è in [`js/connections.js`](js/connections.js) (`searchRouteWithConnections`).
L'idea di fondo è: *un treno A porta da **origine** a una stazione intermedia X; un treno B parte da X e arriva a **destinazione***.
Se B parte da X almeno 5 minuti dopo l'arrivo di A, la coppia (A → X → B) è una coincidenza valida.

### Fasi

```
1. Recupero dati grezzi
   ├── buildTimeWindows(date0) → 3 timestamp: +0 min, +60 min, +120 min
   ├── getDepartures(origine, ts)   × 3 finestre  ─┐ in parallelo
   └── getArrivals(destinazione, ts) × 3 finestre  ─┘

2. Deduplicazione
   Partenze e arrivi vengono deduplicati per numeroTreno (la stessa
   corsa può comparire in più finestre temporali).

3. Caricamento fermate
   Per ogni treno unico si chiama getTrainDetails() (endpoint
   /andamentoTreno) che restituisce l'elenco completo delle fermate
   con gli orari effettivi/programmati.
   Le due liste (treni in partenza, treni in arrivo) vengono risolte
   in parallelo.

4. Costruzione transferFromMap
   Per ogni treno in partenza dall'origine si scorre l'elenco delle
   fermate *dopo* l'origine. Per ciascuna fermata intermedia f si
   memorizza:

     transferFromMap[f.id] → { train, fermata f, arrTime }

   dove arrTime = f.effettivaArrivo ?? f.programmataArrivo ?? …

5. Incrocio con i treni in arrivo
   Per ogni treno in arrivo a destinazione si scorrono le fermate
   *prima* della destinazione. Se una fermata f è presente in
   transferFromMap e vale:

     arrTime_leg1 + 5 min ≤ depTime_leg2

   la coppia è una soluzione valida.

6. Costruzione della soluzione
   Si assembla un oggetto { key, leg1, transfer, leg2, totalMin }:

     key        "numeroTreno1→numeroTreno2"
     leg1       treno A + orario partenza dall'origine
     transfer   stazione X, arrivo/partenza, attesa in minuti, binario
     leg2       treno B + orario arrivo a destinazione
     totalMin   durata totale dal gate origine al gate destinazione

7. Ordinamento e deduplicazione finale
   Le soluzioni sono ordinate per orario di partenza e deduplicate
   per key (stesso binomio di treni non compare due volte).
```

### Soglia di cambio

Il tempo minimo garantito tra arrivo di A e partenza di B è **5 minuti**
(`MIN_TRANSFER_MS = 5 * 60 * 1000`).

### Priorità degli orari

Per ogni fermata si usa il primo valore disponibile in questo ordine:

| Caso | Campo usato |
|------|-------------|
| Arrivo alla stazione di cambio (leg1) | `effettivaArrivo` → `programmataArrivo` → `arrivo_teorico` → `programmata` |
| Partenza dalla stazione di cambio (leg2) | `effettivaPartenza` → `programmataPartenza` → `partenza_teorica` → `programmata` |

Questo fa sì che, se il treno A è in ritardo, il ritardo venga propagato nel calcolo del margine di cambio.

---

### Fallback per treni futuri (hub-matching)

L'endpoint `/andamentoTreno` restituisce le fermate dettagliate **solo per i treni già partiti o circolanti**. Per i treni futuri (stato `nonPartito: true`) la risposta è vuota, quindi le fasi 3-5 non trovano nulla.

In questo caso `searchRouteWithConnections` delega a **`searchRouteHubFallback`** (`js/connections.js`), che lavora esclusivamente sui dati restituiti da `/partenze` e `/arrivi` senza chiamare `/andamentoTreno`.

#### Logica del fallback

```
1. Hub discovery
   ├── Per ogni treno in partenza da A:  destinazione → candidati hub
   └── Per ogni treno in arrivo a B:     origine      → filtra candidati hub
   → hub = stazioni in cui i treni da A "terminano" e i treni per B "iniziano"

2. Per ogni hub trovato:
   ├── getDepartures(hub, ts) × 3 finestre  → orario di partenza del treno leg2 dall'hub
   └── getArrivals(hub, ts) × 6 finestre    → orario di arrivo del treno leg1 all'hub

3. Incrocio
   Per ogni coppia (leg1, leg2) si verifica:
     a. leg1 parte da A prima di arrivare all'hub
     b. leg2 parte dall'hub dopo l'arrivo di leg1 + 10 min (margine)
     c. leg2 arriva a B dopo essere partito dall'hub

4. Costruzione identica al percorso principale:
   { key, leg1, transfer { stationId, stationName, arrTime, depTime,
     waitMin, binEff, binProg }, leg2, totalMin }
```

#### Perché il margine minimo è 10 minuti (non 5)?

Con `/andamentoTreno` gli orari di arrivo/partenza all'hub sono già quelli **della fermata intermedia** (molto precisi). Con il fallback gli orari vengono da `/arrivi` e `/partenze` applicati all'hub, che per i treni non ancora partiti coincidono con l'orario programmato del capolinea: c'è una piccola imprecisione (il treno potrebbe fermarsi all'hub qualche minuto prima o dopo la sua corsa finale). Il margine di 10 minuti compensa questa approssimazione.

#### Esempio: Villa Bonelli → Isernia (treno futuro)

```
[/partenze VB]   REG 12503  dest "ROMA TERMINI"  dep 06:03
[/arrivi IS]     REG 23363  orig "ROMA TERMINI"  arr 08:27
                 REG 23365  orig "ROMA TERMINI"  arr 11:15

Hub: ROMA TERMINI (codOrigine S08409)

[/arrivi RT]     REG 12503  arr 06:25
[/partenze RT]   REG 23365  dep 09:07

Soluzione: REG 12503 VB 06:03 → RT 06:25 → REG 23365 09:07 → IS 11:15
           (attesa 162 min, totale 5h 12m)
```

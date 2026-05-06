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

Poi apri il browser su `http://localhost:8080`.

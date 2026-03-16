# Solana Meme Coin Holder PNL Tracker (Demo)

Interfaccia web HTML/CSS/JS per analizzare una meme coin su Solana tramite contract address (mint), con:

- PNL top 5 holder + media
- PNL medio di tutti gli holder
- Dettaglio PNL per holder in tendina
- Whale tracking (wallet >= $10.000)
- Grafico TradingView-style

## Avvio locale

```bash
python3 -m http.server 8000
```

Poi apri `http://localhost:8000`.

## Nota API

Il progetto è pronto per integrare API reali (Helius/Shyft/Birdeye ecc.), ma al momento usa dati demo deterministici per mostrare il flusso completo senza dipendenze esterne.

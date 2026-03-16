# Solana Meme Coin Holder PNL Tracker (Demo)

Web app HTML/CSS/JS per analizzare una meme coin su Solana tramite mint address, con:

- PNL top 5 holder (media + dettaglio)
- PNL medio di tutti gli holder
- Whale tracking (wallet >= $10.000)
- Grafico market cap con marker delle entrate whale

## Avvio locale

```bash
python3 -m http.server 8000
```

Poi apri `http://localhost:8000`.

## Nota importante

Questa versione è demo e usa dati deterministici locali. La logica è però strutturata per sostituire il mock con API reali:

1. lista holder da indexer Solana,
2. filtro wallet tecnici (LP/burn/CEX),
3. ricostruzione entrate wallet,
4. PNL calcolato su market cap (non su prezzo spot).

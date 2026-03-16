# Solana Meme Coin Holder PNL Tracker (Real-data edition)

Web app HTML/CSS/JS con backend Node per analizzare una meme coin Solana via mint address.

## Cosa fa

- Top 5 holder con % holding e PNL% su market cap
- Stima media PNL holder (campione top wallet)
- Whale tracking (wallet >= $10.000)
- Grafico market cap con marker entrate whale

## Data source reali

- **Solana RPC**: holder/token account + first-seen per wallet
- **Dexscreener API**: market cap attuale
- **GeckoTerminal API**: serie storica OHLCV (convertita in market cap)

## Avvio

```bash
npm start
```

Apri poi: `http://localhost:8000`

## Configurazione RPC (opzionale ma consigliata)

Per token molto popolari, l'RPC pubblico può essere lento o rate-limited.

```bash
SOLANA_RPC_URL="https://<tuo-rpc-endpoint>" npm start
```

## Nota sul calcolo PNL

Il PNL usa l'entry derivata dal primo timestamp rilevato sul token account principale del wallet e confronta:

`PNL% = ((marketCapNow / entryMarketCap) - 1) * 100`

La media "all holders" è una **stima su campione** (top 40 wallet) per mantenere tempi API sostenibili.

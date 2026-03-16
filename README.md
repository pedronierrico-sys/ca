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

## Avvio corretto in locale (passo-passo)

1. Apri terminale nella cartella progetto (`/workspace/ca`).
2. Avvia il server:

```bash
npm start
```

3. Apri il browser su:

```text
http://localhost:8000
```

4. Inserisci il mint e clicca **Analizza**.

## Importante

- **Non aprire `index.html` con `file://`**: in quel caso il frontend non riesce a chiamare l'API del backend.
- Verifica backend con:

```text
http://localhost:8000/api/health
```

Deve rispondere con JSON `{"status":"ok", ...}`.

## Configurazione RPC (opzionale ma consigliata)

- Compatibilità RPC: se `getTokenAccountsByMint` non è supportato dal provider, il backend usa automaticamente fallback `getProgramAccounts`.

Per token molto popolari, l'RPC pubblico può essere lento o rate-limited:

```bash
SOLANA_RPC_URL="https://<tuo-rpc-endpoint>" npm start
```

## Nota sul calcolo PNL

`PNL% = ((marketCapNow / entryMarketCap) - 1) * 100`

La media "all holders" è una **stima su campione** (top 40 wallet) per mantenere tempi API sostenibili.

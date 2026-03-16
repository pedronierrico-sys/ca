const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const PORT = Number(process.env.PORT || 8000);
const RPC_URL = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
const BASE_DIR = __dirname;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

function json(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

async function rpc(method, params) {
  const r = await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  if (!r.ok) throw new Error(`RPC HTTP ${r.status}`);
  const j = await r.json();
  if (j.error) throw new Error(`${method}: ${j.error.message || 'rpc error'}`);
  return j.result;
}

function isLikelySolanaAddress(address) {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(String(address || '').trim());
}

async function fetchDexData(mint) {
  const r = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${mint}`);
  if (!r.ok) throw new Error(`Dexscreener HTTP ${r.status}`);
  const j = await r.json();
  const pairs = Array.isArray(j.pairs) ? j.pairs.filter((p) => p.chainId === 'solana') : [];
  if (!pairs.length) throw new Error('Nessuna pair trovata su Dexscreener');
  pairs.sort((a, b) => (Number(b?.liquidity?.usd || 0) - Number(a?.liquidity?.usd || 0)));
  const best = pairs[0];
  return {
    priceUsd: Number(best?.priceUsd || 0),
    marketCapNow: Number(best?.marketCap || best?.fdv || 0),
    symbol: best?.baseToken?.symbol || 'TOKEN',
    pairAddress: best?.pairAddress,
  };
}

async function fetchOhlcvSeries(mint) {
  const u = `https://api.geckoterminal.com/api/v2/networks/solana/tokens/${mint}/ohlcv/hour?aggregate=1&limit=120`;
  const r = await fetch(u, { headers: { accept: 'application/json' } });
  if (!r.ok) return [];
  const j = await r.json();
  const list = j?.data?.attributes?.ohlcv_list || [];
  return list.map((row, idx) => ({
    t: Number(row[0]) || idx,
    close: Number(row[4]) || 0,
  })).filter((x) => Number.isFinite(x.close) && x.close > 0);
}

async function loadHolders(mint) {
  const resp = await rpc('getTokenAccountsByMint', [mint, { encoding: 'jsonParsed', commitment: 'confirmed' }]);
  const list = resp?.value || [];
  const ownerMap = new Map();

  for (const acc of list) {
    const info = acc?.account?.data?.parsed?.info;
    const owner = info?.owner;
    const amountUi = Number(info?.tokenAmount?.uiAmount || 0);
    if (!owner || !Number.isFinite(amountUi) || amountUi <= 0) continue;
    const prev = ownerMap.get(owner) || { owner, amountUi: 0, tokenAccounts: [] };
    prev.amountUi += amountUi;
    prev.tokenAccounts.push(acc.pubkey);
    ownerMap.set(owner, prev);
  }

  const owners = [...ownerMap.values()].sort((a, b) => b.amountUi - a.amountUi);
  return owners;
}

async function firstSeenTs(tokenAccount) {
  try {
    const sigs = await rpc('getSignaturesForAddress', [tokenAccount, { limit: 30 }]);
    if (!Array.isArray(sigs) || !sigs.length) return null;
    const withTime = sigs.filter((s) => Number.isFinite(s.blockTime));
    if (!withTime.length) return null;
    return withTime[withTime.length - 1].blockTime;
  } catch {
    return null;
  }
}

function mapSeriesToMcap(ohlcv, marketCapNow, priceNow) {
  if (!ohlcv.length || !marketCapNow || !priceNow) {
    const fallback = Array.from({ length: 60 }, (_, i) => ({ t: i, value: marketCapNow || 0 }));
    return fallback;
  }
  const factor = marketCapNow / priceNow;
  return ohlcv.map((x, i) => ({ t: x.t || i, value: x.close * factor }));
}

function nearestIndexByTs(series, ts) {
  if (!ts || !series.length) return Math.max(0, series.length - 1);
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < series.length; i++) {
    const d = Math.abs(Number(series[i].t) - Number(ts));
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  }
  return best;
}

async function analyzeMint(mint) {
  const [supplyR, dex, holdersRaw, ohlcv] = await Promise.all([
    rpc('getTokenSupply', [mint]),
    fetchDexData(mint),
    loadHolders(mint),
    fetchOhlcvSeries(mint),
  ]);

  const totalSupply = Number(supplyR?.value?.uiAmount || 0);
  const marketCapNow = Number(dex.marketCapNow || 0);
  const series = mapSeriesToMcap(ohlcv, marketCapNow, dex.priceUsd);

  const topOwners = holdersRaw.slice(0, 120);
  const top5Source = topOwners.slice(0, 5);
  const whaleSource = topOwners.filter((h) => ((h.amountUi / totalSupply) * marketCapNow) >= 10000).slice(0, 25);

  const sampleForAvg = topOwners.slice(0, 40);

  async function enrich(ownerObj) {
    const tokenAccount = ownerObj.tokenAccounts[0];
    const ts = await firstSeenTs(tokenAccount);
    const entryIndex = nearestIndexByTs(series, ts);
    const entryMcap = Number(series[entryIndex]?.value || marketCapNow || 0);
    const pnlPct = entryMcap > 0 ? ((marketCapNow / entryMcap) - 1) * 100 : 0;
    const holdingPct = totalSupply > 0 ? (ownerObj.amountUi / totalSupply) * 100 : 0;
    const usdValue = (holdingPct / 100) * marketCapNow;
    return {
      wallet: ownerObj.owner,
      tokenAccount,
      holdingPct,
      usdValue,
      entryMcap,
      pnlPct,
      entryIndex,
      ts,
    };
  }

  const [top5, whales, sampled] = await Promise.all([
    Promise.all(top5Source.map(enrich)),
    Promise.all(whaleSource.map(enrich)),
    Promise.all(sampleForAvg.map(enrich)),
  ]);

  const avgTop5PnlPct = top5.length ? top5.reduce((s, x) => s + x.pnlPct, 0) / top5.length : 0;
  const avgAllHoldersPnlPct = sampled.length ? sampled.reduce((s, x) => s + x.pnlPct, 0) / sampled.length : 0;

  return {
    mint,
    holderCount: holdersRaw.length,
    marketCapNow,
    marketCapSeries: series,
    avgTop5PnlPct,
    avgAllHoldersPnlPct,
    topHolders: top5.map((h) => ({
      wallet: `${h.wallet.slice(0, 4)}...${h.wallet.slice(-4)}`,
      holdingPct: h.holdingPct,
      usdValue: h.usdValue,
      pnlPct: h.pnlPct,
      details: [{ label: 'Entrata rilevata', entryMcap: h.entryMcap, currentMcap: marketCapNow, pnlPct: h.pnlPct }],
    })),
    whales: whales.map((w) => ({
      wallet: `${w.wallet.slice(0, 4)}...${w.wallet.slice(-4)}`,
      usdValue: w.usdValue,
      holdingPct: w.holdingPct,
      action: w.pnlPct >= 0 ? 'In profitto' : 'Sotto entry',
      entryMcap: w.entryMcap,
      pnlPct: w.pnlPct,
      entryIndex: w.entryIndex,
      lastTx: w.ts ? new Date(w.ts * 1000).toLocaleString('it-IT') : 'n/d',
    })),
    chartNote: `Dati reali on-chain. Holder: ${holdersRaw.length}. Top5 e whale da RPC Solana; mcap da Dexscreener; serie storica da GeckoTerminal. Media 'all holders' stimata su top 40 wallet.`,
  };
}

function serveStatic(reqPath, res) {
  const normalizedPath = reqPath === '/' ? '/index.html' : reqPath;
  const relativePath = normalizedPath.replace(/^\/+/, '');
  const filePath = path.resolve(BASE_DIR, relativePath);
  if (!filePath.startsWith(BASE_DIR + path.sep) && filePath !== path.resolve(BASE_DIR, 'index.html')) {
    res.writeHead(403);
    return res.end('Forbidden');
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      return res.end('Not found');
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://${req.headers.host}`);
  if (u.pathname === '/api/analyze') {
    const mint = (u.searchParams.get('mint') || '').trim();
    if (!isLikelySolanaAddress(mint)) return json(res, 400, { error: 'Mint address non valido' });
    try {
      const data = await analyzeMint(mint);
      return json(res, 200, data);
    } catch (e) {
      return json(res, 500, { error: e.message || 'Errore analisi' });
    }
  }
  return serveStatic(u.pathname, res);
});

server.listen(PORT, () => {
  console.log(`Server in ascolto su http://0.0.0.0:${PORT}`);
});

const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const PORT = Number(process.env.PORT || 8000);
const RPC_URL = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
const BASE_DIR = __dirname;
const TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const TOKEN_2022_PROGRAM_ID = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

function withCors(headers = {}) {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Accept',
    ...headers,
  };
}

function json(res, status, payload) {
  res.writeHead(status, withCors({ 'Content-Type': 'application/json; charset=utf-8' }));
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

function aggregateOwnersFromTokenAccounts(list) {
  const ownerMap = new Map();

  for (const acc of list || []) {
    const info = acc?.account?.data?.parsed?.info;
    const owner = info?.owner;
    const amountUi = Number(info?.tokenAmount?.uiAmount || 0);
    const pubkey = acc?.pubkey;
    if (!owner || !pubkey || !Number.isFinite(amountUi) || amountUi <= 0) continue;

    const prev = ownerMap.get(owner) || { owner, amountUi: 0, tokenAccounts: [] };
    prev.amountUi += amountUi;
    prev.tokenAccounts.push(pubkey);
    ownerMap.set(owner, prev);
  }

  return [...ownerMap.values()].sort((a, b) => b.amountUi - a.amountUi);
}

async function loadLargestAccountsOwners(mint) {
  const largest = await rpc('getTokenLargestAccounts', [mint, { commitment: 'confirmed' }]);
  const list = (largest?.value || []).filter((x) => Number(x?.uiAmount || 0) > 0).slice(0, 30);
  if (!list.length) return [];

  const pubkeys = list.map((x) => x.address);
  const details = await rpc('getMultipleAccounts', [pubkeys, { encoding: 'jsonParsed', commitment: 'confirmed' }]);
  const value = details?.value || [];

  const shaped = value.map((acc, i) => ({
    pubkey: pubkeys[i],
    account: {
      data: acc?.data,
    },
  }));

  return aggregateOwnersFromTokenAccounts(shaped);
}

async function loadHoldersFromProgramAccounts(mint, programId) {
  const accounts = await rpc('getProgramAccounts', [
    programId,
    {
      encoding: 'jsonParsed',
      commitment: 'confirmed',
      filters: [
        { memcmp: { offset: 0, bytes: mint } },
      ],
    },
  ]);
  return aggregateOwnersFromTokenAccounts(accounts || []);
}

async function loadHolders(mint) {
  // Fast path (rich parsed response)
  try {
    const resp = await rpc('getTokenAccountsByMint', [mint, { encoding: 'jsonParsed', commitment: 'confirmed' }]);
    const owners = aggregateOwnersFromTokenAccounts(resp?.value || []);
    if (owners.length) return owners;
  } catch (e) {
    const msg = String(e?.message || e);
    const unsupported = msg.includes('Method not found') || msg.includes('method not found') || msg.includes('-32601');
    if (!unsupported) {
      // continue fallback chain anyway, some RPC return partial parser errors
    }
  }

  // Compat fallback: query both token programs directly
  const [classicOwners, token2022Owners] = await Promise.allSettled([
    loadHoldersFromProgramAccounts(mint, TOKEN_PROGRAM_ID),
    loadHoldersFromProgramAccounts(mint, TOKEN_2022_PROGRAM_ID),
  ]);

  const merged = [];
  if (classicOwners.status === 'fulfilled') merged.push(...classicOwners.value);
  if (token2022Owners.status === 'fulfilled') merged.push(...token2022Owners.value);

  if (merged.length) {
    const byOwner = new Map();
    for (const row of merged) {
      const prev = byOwner.get(row.owner) || { owner: row.owner, amountUi: 0, tokenAccounts: [] };
      prev.amountUi += row.amountUi;
      prev.tokenAccounts.push(...row.tokenAccounts);
      byOwner.set(row.owner, prev);
    }
    return [...byOwner.values()].sort((a, b) => b.amountUi - a.amountUi);
  }

  // Last-resort fallback (top accounts only) to avoid completely empty UI
  return loadLargestAccountsOwners(mint);
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
    res.writeHead(403, withCors({ 'Content-Type': 'text/plain; charset=utf-8' }));
    return res.end('Forbidden');
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, withCors({ 'Content-Type': 'text/plain; charset=utf-8' }));
      return res.end('Not found');
    }
    const ext = path.extname(filePath);
    res.writeHead(200, withCors({ 'Content-Type': MIME[ext] || 'application/octet-stream' }));
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, withCors());
    return res.end();
  }
  const u = new URL(req.url, `http://${req.headers.host}`);
  if (u.pathname === '/api/health') {
    return json(res, 200, { status: 'ok', baseDir: BASE_DIR, rpcConfigured: Boolean(RPC_URL) });
  }
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

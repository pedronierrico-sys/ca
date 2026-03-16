const $ = (id) => document.getElementById(id);

const ui = {
  mintInput: $("mintInput"),
  analyzeBtn: $("analyzeBtn"),
  top5Avg: $("top5Avg"),
  allHoldersAvg: $("allHoldersAvg"),
  marketCapNow: $("marketCapNow"),
  topHoldersTable: $("topHoldersTable"),
  holderDetails: $("holderDetails"),
  whaleTable: $("whaleTable"),
  chartNote: $("chartNote"),
  marketCapChart: $("marketCapChart"),
};

ui.analyzeBtn.addEventListener("click", runAnalysis);

function isLikelySolanaAddress(address) {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address.trim());
}

function formatPct(v) {
  const sign = v > 0 ? "+" : "";
  return `${sign}${v.toFixed(2)}%`;
}

function pnlClass(v) {
  return v >= 0 ? "pnl-pos" : "pnl-neg";
}

function fmtUsd(v) {
  return `$${v.toLocaleString("it-IT", { maximumFractionDigits: 0 })}`;
}

function pseudoRandom(seed) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = Math.imul(31, h) + seed.charCodeAt(i) | 0;
  return () => {
    h = Math.imul(1664525, h) + 1013904223;
    return ((h >>> 0) % 10000) / 10000;
  };
}

async function runAnalysis() {
  const mint = ui.mintInput.value.trim();
  if (!isLikelySolanaAddress(mint)) {
    alert("Inserisci un contract address Solana valido (base58, 32-44 caratteri).");
    return;
  }

  ui.analyzeBtn.disabled = true;
  ui.analyzeBtn.textContent = "Analisi in corso...";

  try {
    const data = await getAnalytics(mint);
    renderTopHolders(data.topHolders);
    renderHolderDetails(data.topHolders, data.marketCapNow);
    renderWhales(data.whales);
    renderMarketCapChart(data.marketCapSeries, data.whales);

    ui.top5Avg.textContent = formatPct(data.avgTop5PnlPct);
    ui.top5Avg.className = `value ${pnlClass(data.avgTop5PnlPct)}`;

    ui.allHoldersAvg.textContent = formatPct(data.avgAllHoldersPnlPct);
    ui.allHoldersAvg.className = `value ${pnlClass(data.avgAllHoldersPnlPct)}`;

    ui.marketCapNow.textContent = fmtUsd(data.marketCapNow);
    ui.chartNote.textContent = data.chartNote;
  } catch (err) {
    console.error(err);
    alert("Errore durante l'analisi. Controlla la console.");
  } finally {
    ui.analyzeBtn.disabled = false;
    ui.analyzeBtn.textContent = "Analizza";
  }
}

async function getAnalytics(mint) {
  // Per integrazione reale:
  // 1) Estrai holder token account e filtra wallet tecnici (LP, burn, CEX hot wallet)
  // 2) Ricostruisci costo medio entry per wallet da swap history
  // 3) PNL% = ((mcap_now / mcap_entry_medio) - 1) * 100
  // 4) Whale = USD position >= 10k e marker delle entry sul grafico
  return mockAnalyticsFromMint(mint);
}

function mockAnalyticsFromMint(mint) {
  const rnd = pseudoRandom(mint);
  const holderCount = 800 + Math.floor(rnd() * 6000);
  const marketCapNow = 400000 + rnd() * 22000000;

  // Distribuzione più credibile per meme coin retail (solo holder EOA, non wallet tecnici)
  const rawTop = Array.from({ length: 5 }, (_, i) => 0.5 + rnd() * (4 - i * 0.5));
  const scale = (3 + rnd() * 6) / rawTop.reduce((a, b) => a + b, 0); // top5 totale 3-9%
  const top5Pct = rawTop.map((v) => v * scale);

  const marketCapSeries = buildMarketCapSeries(marketCapNow, rnd);

  const topHolders = top5Pct.map((holdingPct, i) => {
    const tradeCount = 2 + Math.floor(rnd() * 5);
    const details = Array.from({ length: tradeCount }, (_, n) => {
      const entryMcap = marketCapNow * (0.55 + rnd() * 0.95);
      const pnlPct = ((marketCapNow / entryMcap) - 1) * 100;
      return {
        label: `Entrata ${n + 1}`,
        entryMcap,
        currentMcap: marketCapNow,
        pnlPct,
      };
    });

    const pnlPct = details.reduce((s, d) => s + d.pnlPct, 0) / details.length;
    return {
      wallet: `${mint.slice(0, 4)}...${Math.floor(1000 + rnd() * 8999)}`,
      pnlPct,
      holdingPct,
      usdValue: (holdingPct / 100) * marketCapNow,
      details,
    };
  });

  const whales = Array.from({ length: 14 }, () => {
    const usdValue = 10000 + rnd() * 900000;
    const holdingPct = Math.min(2.8, (usdValue / marketCapNow) * 100);
    const entryIndex = Math.floor(rnd() * (marketCapSeries.length - 4));
    const entryMcap = marketCapSeries[entryIndex].value;
    const pnlPct = ((marketCapNow / entryMcap) - 1) * 100;
    const actions = ["Accumulo", "Parziale take profit", "Nuovo ingresso", "Hold"];
    return {
      wallet: `${mint.slice(0, 3)}W...${Math.floor(100000 + rnd() * 899999)}`,
      usdValue,
      holdingPct,
      action: actions[Math.floor(rnd() * actions.length)],
      entryMcap,
      pnlPct,
      entryIndex,
      lastTx: `${1 + Math.floor(rnd() * 36)}h fa`,
    };
  }).sort((a, b) => b.usdValue - a.usdValue);

  const avgTop5PnlPct = topHolders.reduce((s, h) => s + h.pnlPct, 0) / 5;
  const avgAllHoldersPnlPct = avgTop5PnlPct * (0.6 + rnd() * 0.35) - 3 + rnd() * 6;

  return {
    mint,
    holderCount,
    topHolders,
    whales,
    avgTop5PnlPct,
    avgAllHoldersPnlPct,
    marketCapNow,
    marketCapSeries,
    chartNote: `Holder totali stimati: ${holderCount.toLocaleString("it-IT")}. Top5 wallet EOA: ${top5Pct.reduce((s, v) => s + v, 0).toFixed(2)}% supply (esclusi LP/burn/CEX).`,
  };
}

function buildMarketCapSeries(marketCapNow, rnd) {
  const points = [];
  let value = marketCapNow * (0.55 + rnd() * 0.35);
  for (let i = 0; i < 64; i++) {
    const drift = 0.992 + rnd() * 0.03;
    value *= drift;
    points.push({ t: i, value });
  }
  const ratio = marketCapNow / points[points.length - 1].value;
  return points.map((p) => ({ ...p, value: p.value * ratio }));
}

function renderTopHolders(holders) {
  const rows = holders.map((h, i) => `
    <tr>
      <td>#${i + 1}</td>
      <td>${h.wallet}</td>
      <td>${h.holdingPct.toFixed(2)}%</td>
      <td>${fmtUsd(h.usdValue)}</td>
      <td class="${pnlClass(h.pnlPct)}">${formatPct(h.pnlPct)}</td>
    </tr>`).join("");

  ui.topHoldersTable.innerHTML = `
    <table class="table">
      <thead>
        <tr><th>Rank</th><th>Wallet</th><th>Holding %</th><th>Valore USD</th><th>PNL %</th></tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function renderHolderDetails(holders, marketCapNow) {
  ui.holderDetails.innerHTML = holders.map((h, i) => {
    const detailsRows = h.details.map((d) => `
      <tr>
        <td>${d.label}</td>
        <td>${fmtUsd(d.entryMcap)}</td>
        <td>${fmtUsd(marketCapNow)}</td>
        <td class="${pnlClass(d.pnlPct)}">${formatPct(d.pnlPct)}</td>
      </tr>`).join("");

    return `
      <details ${i === 0 ? "open" : ""}>
        <summary>Holder ${h.wallet} — PNL totale: <span class="${pnlClass(h.pnlPct)}">${formatPct(h.pnlPct)}</span></summary>
        <table class="table">
          <thead><tr><th>Entrata</th><th>Market cap entrata</th><th>Market cap attuale</th><th>PNL</th></tr></thead>
          <tbody>${detailsRows}</tbody>
        </table>
      </details>`;
  }).join("");
}

function renderWhales(whales) {
  const rows = whales
    .filter((w) => w.usdValue >= 10000)
    .map((w) => `
      <tr>
        <td>${w.wallet}</td>
        <td>${fmtUsd(w.usdValue)}</td>
        <td>${w.holdingPct.toFixed(2)}%</td>
        <td>${w.action}</td>
        <td>${fmtUsd(w.entryMcap)}</td>
        <td class="${pnlClass(w.pnlPct)}">${formatPct(w.pnlPct)}</td>
        <td>${w.lastTx}</td>
      </tr>`).join("");

  ui.whaleTable.innerHTML = `
    <table class="table">
      <thead>
        <tr><th>Wallet</th><th>Valore USD</th><th>Holding %</th><th>Azione</th><th>Market cap entrata</th><th>PNL %</th><th>Ultima attività</th></tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function renderMarketCapChart(series, whales) {
  const canvas = ui.marketCapChart;
  const ctx = canvas.getContext("2d");
  const w = canvas.width = canvas.clientWidth * devicePixelRatio;
  const h = canvas.height = canvas.clientHeight * devicePixelRatio;
  ctx.scale(devicePixelRatio, devicePixelRatio);

  const cw = canvas.clientWidth;
  const ch = canvas.clientHeight;
  const pad = 28;
  const vals = series.map((p) => p.value);
  const min = Math.min(...vals) * 0.96;
  const max = Math.max(...vals) * 1.04;

  const x = (i) => pad + (i / (series.length - 1)) * (cw - pad * 2);
  const y = (v) => ch - pad - ((v - min) / (max - min)) * (ch - pad * 2);

  ctx.clearRect(0, 0, cw, ch);

  ctx.strokeStyle = "rgba(158,176,217,.25)";
  for (let i = 0; i < 4; i++) {
    const gy = pad + (i / 3) * (ch - pad * 2);
    ctx.beginPath();
    ctx.moveTo(pad, gy);
    ctx.lineTo(cw - pad, gy);
    ctx.stroke();
  }

  ctx.strokeStyle = "#60a5fa";
  ctx.lineWidth = 2;
  ctx.beginPath();
  series.forEach((p, i) => (i === 0 ? ctx.moveTo(x(i), y(p.value)) : ctx.lineTo(x(i), y(p.value))));
  ctx.stroke();

  whales.slice(0, 8).forEach((whale) => {
    const px = x(whale.entryIndex);
    const py = y(series[whale.entryIndex].value);
    ctx.fillStyle = whale.pnlPct >= 0 ? "#4ade80" : "#f87171";
    ctx.beginPath();
    ctx.arc(px, py, 4.5, 0, Math.PI * 2);
    ctx.fill();
  });

  ctx.fillStyle = "#9eb0d9";
  ctx.font = "12px sans-serif";
  ctx.fillText(`Min mcap: ${fmtUsd(min)}`, pad, ch - 8);
  ctx.fillText(`Max mcap: ${fmtUsd(max)}`, cw - 180, ch - 8);
}

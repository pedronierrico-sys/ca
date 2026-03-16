const $ = (id) => document.getElementById(id);

const ui = {
  mintInput: $("mintInput"),
  analyzeBtn: $("analyzeBtn"),
  top5Avg: $("top5Avg"),
  allHoldersAvg: $("allHoldersAvg"),
  topHoldersTable: $("topHoldersTable"),
  holderDetails: $("holderDetails"),
  whaleTable: $("whaleTable"),
  chartNote: $("chartNote"),
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
    renderHolderDetails(data.topHolders);
    renderWhales(data.whales);

    ui.top5Avg.textContent = formatPct(data.avgTop5PnlPct);
    ui.top5Avg.className = `value ${pnlClass(data.avgTop5PnlPct)}`;

    ui.allHoldersAvg.textContent = formatPct(data.avgAllHoldersPnlPct);
    ui.allHoldersAvg.className = `value ${pnlClass(data.avgAllHoldersPnlPct)}`;

    renderTradingViewWidget(data.chartSymbol);
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
  // Adapter point for real APIs:
  // 1) Fetch holders list from Solana indexer (Helius/Shyft/Birdeye)
  // 2) Compute wallet-level PNL from buy/sell history
  // 3) Filter whales by USD threshold >= 10k and detect actions
  // 4) Return structured payload used below
  return mockAnalyticsFromMint(mint);
}

function mockAnalyticsFromMint(mint) {
  const rnd = pseudoRandom(mint);
  const holderCount = 200 + Math.floor(rnd() * 4200);

  const topHolders = Array.from({ length: 5 }, (_, i) => {
    const pnl = -40 + rnd() * 260;
    const holdingPct = 2 + rnd() * 10;
    const usdValue = 15000 + rnd() * 900000;
    const tradeCount = 2 + Math.floor(rnd() * 8);
    const details = Array.from({ length: tradeCount }, (_, n) => {
      const cost = 0.000001 + rnd() * 0.0003;
      const now = cost * (0.6 + rnd() * 2.4);
      const tradePnl = ((now - cost) / cost) * 100;
      return {
        label: `Trade ${n + 1}`,
        buyPrice: cost,
        currentPrice: now,
        pnlPct: tradePnl,
      };
    });
    return {
      wallet: `${mint.slice(0, 4)}...${i}${Math.floor(rnd() * 9999)}`,
      pnlPct: pnl,
      holdingPct,
      usdValue,
      details,
    };
  });

  const whales = Array.from({ length: 9 }, (_, i) => {
    const usdValue = 10000 + rnd() * 1200000;
    const holdingPct = 0.2 + rnd() * 11;
    const actions = ["Accumulo", "Parziale take profit", "Nuovo ingresso", "Hold"];
    return {
      wallet: `${mint.slice(0, 3)}W...${Math.floor(rnd() * 999999)}`,
      usdValue,
      holdingPct,
      action: actions[Math.floor(rnd() * actions.length)],
      avgBuy: 0.000001 + rnd() * 0.0004,
      lastTx: `${1 + Math.floor(rnd() * 24)}h fa`,
    };
  });

  const avgTop5PnlPct = topHolders.reduce((s, h) => s + h.pnlPct, 0) / 5;
  const avgAllHoldersPnlPct = avgTop5PnlPct * (0.4 + rnd() * 0.7) - 5 + rnd() * 10;

  return {
    mint,
    holderCount,
    topHolders,
    whales,
    avgTop5PnlPct,
    avgAllHoldersPnlPct,
    chartSymbol: "BINANCE:SOLUSDT",
    chartNote: "Grafico TradingView in fallback su SOLUSDT. In integrazione reale puoi mappare pair/token su DEX chart specifico.",
  };
}

function renderTopHolders(holders) {
  const rows = holders.map((h, i) => `
    <tr>
      <td>#${i + 1}</td>
      <td>${h.wallet}</td>
      <td>${h.holdingPct.toFixed(2)}%</td>
      <td>$${h.usdValue.toLocaleString("it-IT", { maximumFractionDigits: 0 })}</td>
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

function renderHolderDetails(holders) {
  ui.holderDetails.innerHTML = holders.map((h, i) => {
    const detailsRows = h.details.map(d => `
      <tr>
        <td>${d.label}</td>
        <td>${d.buyPrice.toExponential(3)}</td>
        <td>${d.currentPrice.toExponential(3)}</td>
        <td class="${pnlClass(d.pnlPct)}">${formatPct(d.pnlPct)}</td>
      </tr>`).join("");

    return `
      <details ${i === 0 ? "open" : ""}>
        <summary>Holder ${h.wallet} — PNL totale: <span class="${pnlClass(h.pnlPct)}">${formatPct(h.pnlPct)}</span></summary>
        <table class="table">
          <thead><tr><th>Trade</th><th>Buy price</th><th>Current price</th><th>PNL</th></tr></thead>
          <tbody>${detailsRows}</tbody>
        </table>
      </details>`;
  }).join("");
}

function renderWhales(whales) {
  const rows = whales
    .filter(w => w.usdValue >= 10000)
    .map(w => `
      <tr>
        <td>${w.wallet}</td>
        <td>$${w.usdValue.toLocaleString("it-IT", { maximumFractionDigits: 0 })}</td>
        <td>${w.holdingPct.toFixed(2)}%</td>
        <td>${w.action}</td>
        <td>${w.avgBuy.toExponential(3)}</td>
        <td>${w.lastTx}</td>
      </tr>`).join("");

  ui.whaleTable.innerHTML = `
    <table class="table">
      <thead>
        <tr><th>Wallet</th><th>Valore USD</th><th>Holding %</th><th>Azione</th><th>Prezzo medio acquisto</th><th>Ultima attività</th></tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function renderTradingViewWidget(symbol) {
  const chartEl = document.getElementById("tvChart");
  chartEl.innerHTML = "";
  if (!window.TradingView) {
    chartEl.textContent = "TradingView non disponibile in questo ambiente.";
    return;
  }

  new TradingView.widget({
    width: "100%",
    height: 460,
    symbol,
    interval: "15",
    timezone: "Etc/UTC",
    theme: "dark",
    style: "1",
    locale: "it",
    toolbar_bg: "#0b1020",
    enable_publishing: false,
    hide_top_toolbar: false,
    allow_symbol_change: true,
    container_id: "tvChart",
  });
}

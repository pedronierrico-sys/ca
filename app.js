const $ = (id) => document.getElementById(id);

const ui = {
  mintInput: $("mintInput"),
  analyzeBtn: $("analyzeBtn"),
  liveIntervalInput: $("liveIntervalInput"),
  liveToggleBtn: $("liveToggleBtn"),
  liveStatus: $("liveStatus"),
  lastUpdated: $("lastUpdated"),
  top5Avg: $("top5Avg"),
  allHoldersAvg: $("allHoldersAvg"),
  marketCapNow: $("marketCapNow"),
  topHoldersTable: $("topHoldersTable"),
  holderDetails: $("holderDetails"),
  whaleTable: $("whaleTable"),
  chartNote: $("chartNote"),
  marketCapChart: $("marketCapChart"),
};

const state = {
  liveTimer: null,
  currentMint: null,
  isAnalyzing: false,
};

ui.analyzeBtn.addEventListener("click", () => runAnalysis({ fromLive: false, showAlerts: true }));
ui.liveToggleBtn.addEventListener("click", toggleLiveMode);

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
  return `$${Number(v || 0).toLocaleString("it-IT", { maximumFractionDigits: 0 })}`;
}

async function fetchWithTimeout(url, ms = 75000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, {
      headers: { "Accept": "application/json" },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

function getLiveIntervalMs() {
  const sec = Number(ui.liveIntervalInput.value || 15);
  return Math.max(5, sec) * 1000;
}

function setLiveStatus(message, ok = true) {
  ui.liveStatus.textContent = message;
  ui.liveStatus.className = `hint ${ok ? "" : "pnl-neg"}`;
}

function toggleLiveMode() {
  if (state.liveTimer) {
    clearInterval(state.liveTimer);
    state.liveTimer = null;
    ui.liveToggleBtn.textContent = "Avvia live";
    setLiveStatus("Live update: OFF");
    return;
  }

  const mint = ui.mintInput.value.trim();
  if (!isLikelySolanaAddress(mint)) {
    alert("Per avviare live update inserisci prima un mint valido.");
    return;
  }

  state.currentMint = mint;
  ui.liveToggleBtn.textContent = "Stop live";
  setLiveStatus(`Live update: ON (ogni ${Math.max(5, Number(ui.liveIntervalInput.value || 15))}s)`);

  state.liveTimer = setInterval(() => {
    runAnalysis({ fromLive: true, showAlerts: false });
  }, getLiveIntervalMs());

  runAnalysis({ fromLive: true, showAlerts: false });
}

async function runAnalysis({ fromLive = false, showAlerts = true } = {}) {
  if (state.isAnalyzing) return;

  const mint = (fromLive ? (state.currentMint || ui.mintInput.value.trim()) : ui.mintInput.value.trim());
  if (!isLikelySolanaAddress(mint)) {
    if (showAlerts) alert("Inserisci un contract address Solana valido (base58, 32-44 caratteri).");
    return;
  }

  state.currentMint = mint;
  state.isAnalyzing = true;

  ui.analyzeBtn.disabled = true;
  if (!fromLive) ui.analyzeBtn.textContent = "Analisi in corso...";

  try {
    const data = await getAnalytics(mint);
    renderTopHolders(data.topHolders || []);
    renderHolderDetails(data.topHolders || [], data.marketCapNow || 0);
    renderWhales(data.whales || []);
    renderMarketCapChart(data.marketCapSeries || [], data.whales || []);

    ui.top5Avg.textContent = formatPct(data.avgTop5PnlPct || 0);
    ui.top5Avg.className = `value ${pnlClass(data.avgTop5PnlPct || 0)}`;

    ui.allHoldersAvg.textContent = formatPct(data.avgAllHoldersPnlPct || 0);
    ui.allHoldersAvg.className = `value ${pnlClass(data.avgAllHoldersPnlPct || 0)}`;

    ui.marketCapNow.textContent = fmtUsd(data.marketCapNow || 0);
    ui.chartNote.textContent = data.chartNote || "";
    ui.lastUpdated.textContent = `Ultimo aggiornamento: ${new Date().toLocaleTimeString("it-IT")}`;

    if (state.liveTimer) {
      setLiveStatus(`Live update: ON (ogni ${Math.max(5, Number(ui.liveIntervalInput.value || 15))}s)`);
    }
  } catch (err) {
    console.error(err);
    if (showAlerts) {
      alert(`Errore durante l'analisi: ${err.message || err}`);
    }
    if (state.liveTimer) {
      setLiveStatus(`Live update attivo ma con errori: ${err.message || err}`, false);
    }
  } finally {
    state.isAnalyzing = false;
    ui.analyzeBtn.disabled = false;
    if (!fromLive) ui.analyzeBtn.textContent = "Analizza";
  }
}

async function getAnalytics(mint) {
  const query = `/api/analyze?mint=${encodeURIComponent(mint)}`;
  const candidates = [
    query,
    `http://127.0.0.1:8000${query}`,
    `http://localhost:8000${query}`,
  ];

  const errors = [];

  for (const endpoint of candidates) {
    try {
      const response = await fetchWithTimeout(endpoint);

      let data = {};
      try {
        data = await response.json();
      } catch {
        data = {};
      }

      if (!response.ok) {
        errors.push(`${endpoint}: ${data.error || `HTTP ${response.status}`}`);
        continue;
      }

      return data;
    } catch (e) {
      const isAbort = e?.name === "AbortError" || String(e?.message || "").toLowerCase().includes("aborted");
      errors.push(`${endpoint}: ${isAbort ? "timeout analisi (RPC lento, attesa max ~75s)" : (e?.message || "fetch failed")}`);
    }
  }

  throw new Error(`Backend non raggiungibile o troppo lento. Endpoint provati: ${errors.join(" | ")}. Avvia con npm start da /workspace/ca, usa un RPC più veloce (SOLANA_RPC_URL) e attendi qualche secondo in più.`);
}

function renderTopHolders(holders) {
  const rows = holders.map((h, i) => `
    <tr>
      <td>#${i + 1}</td>
      <td>${h.wallet}</td>
      <td>${Number(h.holdingPct || 0).toFixed(2)}%</td>
      <td>${fmtUsd(h.usdValue)}</td>
      <td class="${pnlClass(h.pnlPct || 0)}">${formatPct(h.pnlPct || 0)}</td>
    </tr>`).join("");

  ui.topHoldersTable.innerHTML = `
    <table class="table">
      <thead>
        <tr><th>Rank</th><th>Wallet</th><th>Holding %</th><th>Valore USD</th><th>PNL %</th></tr>
      </thead>
      <tbody>${rows || '<tr><td colspan="5">Nessun dato</td></tr>'}</tbody>
    </table>`;
}

function renderHolderDetails(holders, marketCapNow) {
  ui.holderDetails.innerHTML = holders.map((h, i) => {
    const detailsRows = (h.details || []).map((d) => `
      <tr>
        <td>${d.label}</td>
        <td>${fmtUsd(d.entryMcap)}</td>
        <td>${fmtUsd(marketCapNow)}</td>
        <td class="${pnlClass(d.pnlPct || 0)}">${formatPct(d.pnlPct || 0)}</td>
      </tr>`).join("");

    return `
      <details ${i === 0 ? "open" : ""}>
        <summary>Holder ${h.wallet} — PNL totale: <span class="${pnlClass(h.pnlPct || 0)}">${formatPct(h.pnlPct || 0)}</span></summary>
        <table class="table">
          <thead><tr><th>Entrata</th><th>Market cap entrata</th><th>Market cap attuale</th><th>PNL</th></tr></thead>
          <tbody>${detailsRows || '<tr><td colspan="4">Nessun dettaglio</td></tr>'}</tbody>
        </table>
      </details>`;
  }).join("");

  if (!holders.length) ui.holderDetails.innerHTML = '<p class="hint">Nessun holder disponibile.</p>';
}

function renderWhales(whales) {
  const rows = whales
    .filter((w) => Number(w.usdValue || 0) >= 10000)
    .map((w) => `
      <tr>
        <td>${w.wallet}</td>
        <td>${fmtUsd(w.usdValue)}</td>
        <td>${Number(w.holdingPct || 0).toFixed(2)}%</td>
        <td>${w.action || "n/d"}</td>
        <td>${fmtUsd(w.entryMcap)}</td>
        <td class="${pnlClass(w.pnlPct || 0)}">${formatPct(w.pnlPct || 0)}</td>
        <td>${w.lastTx || "n/d"}</td>
      </tr>`).join("");

  ui.whaleTable.innerHTML = `
    <table class="table">
      <thead>
        <tr><th>Wallet</th><th>Valore USD</th><th>Holding %</th><th>Azione</th><th>Market cap entrata</th><th>PNL %</th><th>Ultima attività</th></tr>
      </thead>
      <tbody>${rows || '<tr><td colspan="7">Nessuna whale trovata</td></tr>'}</tbody>
    </table>`;
}

function renderMarketCapChart(series, whales) {
  const canvas = ui.marketCapChart;
  const ctx = canvas.getContext("2d");
  const ratio = window.devicePixelRatio || 1;

  const cw = canvas.clientWidth;
  const ch = canvas.clientHeight;
  canvas.width = Math.floor(cw * ratio);
  canvas.height = Math.floor(ch * ratio);
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);

  const points = (series || []).slice(-100);
  if (!points.length) {
    ctx.clearRect(0, 0, cw, ch);
    ctx.fillStyle = "#9eb0d9";
    ctx.font = "14px sans-serif";
    ctx.fillText("Serie market cap non disponibile", 20, 40);
    return;
  }

  const pad = 28;
  const vals = points.map((p) => Number(p.value || 0)).filter((v) => v > 0);
  const min = Math.min(...vals) * 0.98;
  const max = Math.max(...vals) * 1.02;

  const x = (i) => pad + (i / (points.length - 1 || 1)) * (cw - pad * 2);
  const y = (v) => ch - pad - ((v - min) / (max - min || 1)) * (ch - pad * 2);

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
  points.forEach((p, i) => (i === 0 ? ctx.moveTo(x(i), y(Number(p.value || 0))) : ctx.lineTo(x(i), y(Number(p.value || 0)))));
  ctx.stroke();

  (whales || []).slice(0, 10).forEach((whale) => {
    const idx = Math.max(0, Math.min(points.length - 1, Number(whale.entryIndex || 0)));
    const px = x(idx);
    const py = y(Number(points[idx].value || 0));
    ctx.fillStyle = Number(whale.pnlPct || 0) >= 0 ? "#4ade80" : "#f87171";
    ctx.beginPath();
    ctx.arc(px, py, 4.5, 0, Math.PI * 2);
    ctx.fill();
  });

  ctx.fillStyle = "#9eb0d9";
  ctx.font = "12px sans-serif";
  ctx.fillText(`Min mcap: ${fmtUsd(min)}`, pad, ch - 8);
  ctx.fillText(`Max mcap: ${fmtUsd(max)}`, cw - 180, ch - 8);
}

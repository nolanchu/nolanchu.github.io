(function () {
  const ENCRYPTED_PATH = "./encrypted-data.json";

  const $ = (id) => document.getElementById(id);
  const el = {
    lockScreen: $("lock-screen"),
    form: $("unlock-form"),
    pw: $("password-input"),
    status: $("status"),
    snapshotDate: $("snapshot-date"),
    dashboard: $("dashboard"),
    heroTotal: $("hero-total"),
    heroDelta: $("hero-delta"),
    heroAssets: $("hero-assets"),
    heroLiabilities: $("hero-liabilities"),
    heroDate: $("hero-date"),
    deltas: $("deltas"),
    historyMeta: $("history-meta"),
    historyChart: $("history-chart"),
    donutChart: $("donut-chart"),
    moversTable: $("movers-table"),
    instBreakdown: $("institution-breakdown"),
    metrics: $("metrics"),
    accountsMeta: $("accounts-meta"),
    accountsTable: $("accounts-table"),
  };

  let cached = null;
  let historyChartInstance = null;
  let donutChartInstance = null;
  const MIN_CAGR_DAYS = 90;

  function esc(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function money(value, signed) {
    const abs = Math.abs(Number(value));
    const fmt = abs.toLocaleString("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    if (signed) return `${value >= 0 ? "+" : "-"}${fmt}`;
    return `${value < 0 ? "-" : ""}${fmt}`;
  }

  function pct(value) {
    return `${Number(value).toFixed(1)}%`;
  }

  function deltaClass(value) {
    if (value == null || value === "n/a") return "";
    if (typeof value === "number") return value >= 0 ? "up" : "down";
    return value.startsWith("+") ? "up" : value.startsWith("-") ? "down" : "";
  }

  function b64(value) {
    const binary = atob(value);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
    return out;
  }

  async function loadEncrypted() {
    if (cached) return cached;
    const response = await fetch(ENCRYPTED_PATH, { cache: "no-store" });
    if (!response.ok) throw new Error(`Fetch failed (${response.status})`);
    cached = await response.json();
    el.snapshotDate.textContent = cached.snapshot_date || "";
    return cached;
  }

  async function decrypt(password) {
    const payload = await loadEncrypted();
    const raw = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(password),
      "PBKDF2",
      false,
      ["deriveKey"]
    );
    const key = await crypto.subtle.deriveKey(
      {
        name: "PBKDF2",
        salt: b64(payload.kdf.salt_b64),
        iterations: payload.kdf.iterations,
        hash: "SHA-256",
      },
      raw,
      { name: "AES-GCM", length: 256 },
      false,
      ["decrypt"]
    );
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: b64(payload.cipher.iv_b64) },
      key,
      b64(payload.cipher.ciphertext_b64)
    );
    return JSON.parse(new TextDecoder().decode(plain));
  }

  function chartUnavailable(canvasEl, message) {
    canvasEl.parentElement.innerHTML = `<div class="empty-msg">${esc(message)}</div>`;
  }

  function renderHero(payload) {
    el.heroTotal.textContent = money(payload.latest_total);
    el.heroAssets.textContent = money(payload.assets_total);
    el.heroLiabilities.textContent = money(payload.liabilities_total);
    el.heroDate.textContent = payload.latest_day;

    const snap = payload.stats.find((item) => item.label === "Since last snapshot");
    if (snap && snap.delta !== "n/a") {
      const cls = deltaClass(snap.delta);
      el.heroDelta.className = `hero-delta ${cls}`;
      el.heroDelta.textContent = `${snap.delta} since last snapshot`;
      el.heroDelta.style.display = "";
    } else {
      el.heroDelta.style.display = "none";
    }
  }

  function renderDeltas(payload) {
    el.deltas.innerHTML = payload.stats
      .map((item) => {
        const cls = deltaClass(item.delta);
        return `<div class="delta-card">
          <div class="label">${esc(item.label)}</div>
          <div class="value ${cls}">${esc(item.delta)}</div>
        </div>`;
      })
      .join("");
  }

  function renderHistoryChart(series) {
    if (!series || series.length < 2) {
      chartUnavailable(el.historyChart, "Need at least two snapshots for a chart.");
      return;
    }
    if (!window.Chart) {
      chartUnavailable(el.historyChart, "Chart.js did not load, so the history chart is unavailable.");
      return;
    }

    el.historyMeta.textContent = `${series.length} snapshots`;

    if (historyChartInstance) historyChartInstance.destroy();
    historyChartInstance = new Chart(el.historyChart, {
      type: "line",
      data: {
        labels: series.map((item) => item.date),
        datasets: [
          {
            data: series.map((item) => item.total),
            borderColor: "#1a6b5a",
            backgroundColor: "rgba(26,107,90,.08)",
            fill: true,
            tension: 0.3,
            pointRadius: series.length > 30 ? 0 : 4,
            pointHoverRadius: 6,
            pointBackgroundColor: "#1a6b5a",
            pointBorderColor: "#fff",
            pointBorderWidth: 2,
            borderWidth: 2.5,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: "#1a1a1a",
            titleColor: "#ccc",
            bodyColor: "#fff",
            bodyFont: { family: "'DM Mono', monospace", weight: "500", size: 14 },
            titleFont: { family: "'DM Sans', sans-serif", size: 12 },
            padding: 12,
            cornerRadius: 8,
            displayColors: false,
            callbacks: {
              label: (ctx) => money(ctx.parsed.y),
            },
          },
        },
        scales: {
          x: {
            ticks: {
              maxTicksLimit: 6,
              font: { family: "'DM Mono', monospace", size: 11 },
              color: "#999",
            },
            grid: { display: false },
            border: { display: false },
          },
          y: {
            ticks: {
              callback: (value) => money(value),
              font: { family: "'DM Mono', monospace", size: 11 },
              color: "#999",
              maxTicksLimit: 5,
            },
            grid: { color: "rgba(0,0,0,.05)" },
            border: { display: false },
          },
        },
        interaction: { intersect: false, mode: "index" },
        layout: { padding: { top: 4, bottom: 4 } },
      },
    });
  }

  function renderDonut(categories) {
    if (!categories || !categories.length) {
      chartUnavailable(el.donutChart, "No allocation data.");
      return;
    }
    if (!window.Chart) {
      chartUnavailable(el.donutChart, "Chart.js did not load, so the allocation chart is unavailable.");
      return;
    }

    const palette = ["#1a6b5a", "#2d9b7a", "#72c4a8", "#c0392b", "#e6a03e", "#8e7cc3"];

    if (donutChartInstance) donutChartInstance.destroy();
    donutChartInstance = new Chart(el.donutChart, {
      type: "doughnut",
      data: {
        labels: categories.map((item) => item.label),
        datasets: [
          {
            data: categories.map((item) => Math.abs(item.amount)),
            backgroundColor: categories.map((_, index) => palette[index % palette.length]),
            borderWidth: 2,
            borderColor: "#fff",
            hoverOffset: 6,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        cutout: "68%",
        plugins: {
          legend: {
            position: "bottom",
            labels: {
              padding: 16,
              usePointStyle: false,
              boxWidth: 12,
              boxHeight: 12,
              useBorderRadius: true,
              borderRadius: 999,
              font: { family: "'DM Sans', sans-serif", size: 12 },
              color: "#555",
            },
          },
          tooltip: {
            backgroundColor: "#1a1a1a",
            bodyColor: "#fff",
            bodyFont: { family: "'DM Mono', monospace", size: 13 },
            padding: 10,
            cornerRadius: 8,
            displayColors: true,
            callbacks: {
              label: (ctx) => {
                const category = categories[ctx.dataIndex];
                return ` ${category.label}: ${money(category.amount)} (${pct(category.share_pct)})`;
              },
            },
          },
        },
      },
    });
  }

  function renderMovers(items) {
    if (!items || !items.length) {
      el.moversTable.innerHTML =
        '<div class="empty-msg">Need more than one snapshot to show movers.</div>';
      return;
    }

    const rows = items
      .slice(0, 8)
      .map((item) => {
        const deltaText = item.delta == null ? "n/a" : money(item.delta, true);
        const cls = item.delta == null ? "" : item.delta >= 0 ? "positive" : "negative";
        return `<tr>
          <td>${esc(item.account_name)}</td>
          <td>${esc(item.institution)}</td>
          <td class="${cls}">${esc(deltaText)}</td>
          <td class="right">${esc(money(item.amount))}</td>
        </tr>`;
      })
      .join("");

    el.moversTable.innerHTML = `<table>
      <thead><tr><th>Account</th><th>Institution</th><th>Change</th><th class="right">Balance</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
  }

  function renderInstitutions(items) {
    if (!items || !items.length) {
      el.instBreakdown.innerHTML = '<div class="empty-msg">No institution data.</div>';
      return;
    }

    const maxPct = Math.max(...items.map((item) => Math.abs(item.share_pct)));
    el.instBreakdown.innerHTML = items
      .map((item) => {
        const width = maxPct > 0 ? (Math.abs(item.share_pct) / maxPct) * 100 : 0;
        const amountClass = item.amount < 0 ? "negative" : "";
        return `<div class="inst-row">
          <div class="inst-info">
            <div class="inst-name">${esc(item.label)}</div>
            <div class="inst-bar-track"><div class="inst-bar-fill" style="width:${width.toFixed(1)}%"></div></div>
          </div>
          <div class="inst-values">
            <div class="inst-amount ${amountClass}">${esc(money(item.amount))}</div>
            <div class="inst-pct">${esc(pct(item.share_pct))}</div>
          </div>
        </div>`;
      })
      .join("");
  }

  function renderMetrics(payload) {
    const assets = payload.assets_total || 0;
    const liabilities = payload.liabilities_total || 0;
    const series = payload.series || [];

    const debtToAsset = assets > 0 ? liabilities / assets : 0;

    let cagr = null;
    if (series.length >= 2) {
      const first = series[0].total;
      const last = series[series.length - 1].total;
      const d0 = new Date(series[0].date);
      const d1 = new Date(series[series.length - 1].date);
      const elapsedDays = (d1 - d0) / 86400000;
      const years = elapsedDays / 365.25;
      if (elapsedDays >= MIN_CAGR_DAYS && years > 0 && first > 0 && last > 0) {
        cagr = (Math.pow(last / first, 1 / years) - 1) * 100;
      }
    }

    let topAcct = null;
    if (payload.accounts && payload.accounts.length) {
      topAcct = payload.accounts.reduce((max, item) =>
        Math.abs(item.share_pct) > Math.abs(max.share_pct) ? item : max
      , payload.accounts[0]);
    }

    const cards = [
      {
        label: "Debt / Asset Ratio",
        value: `${(debtToAsset * 100).toFixed(1)}%`,
        detail: `${money(liabilities)} liabilities / ${money(assets)} assets`,
      },
      {
        label: "Growth Rate (CAGR)",
        value: cagr != null ? `${cagr >= 0 ? "+" : ""}${cagr.toFixed(1)}%` : "n/a",
        detail:
          cagr != null
            ? `${series[0].date} -> ${series[series.length - 1].date}`
            : `Need at least ${MIN_CAGR_DAYS} days of history`,
      },
      {
        label: "Top Concentration",
        value: topAcct ? pct(Math.abs(topAcct.share_pct)) : "n/a",
        detail: topAcct ? topAcct.account_name : "",
      },
    ];

    el.metrics.innerHTML = cards
      .map((card) => `<div class="metric-card">
        <div class="label">${esc(card.label)}</div>
        <div class="value">${esc(card.value)}</div>
        <div class="detail">${esc(card.detail)}</div>
      </div>`)
      .join("");
  }

  function renderAccounts(items) {
    if (!items || !items.length) {
      el.accountsTable.innerHTML = '<div class="empty-msg">No accounts found.</div>';
      return;
    }

    el.accountsMeta.textContent = `${items.length} accounts`;
    const rows = items
      .map((item) => {
        const cls = item.amount < 0 ? "negative" : "";
        return `<tr>
          <td>${esc(item.account_name)}</td>
          <td>${esc(item.institution)}</td>
          <td>${esc(item.account_type)}</td>
          <td class="right">${esc(pct(item.share_pct))}</td>
          <td class="right ${cls}">${esc(money(item.amount))}</td>
        </tr>`;
      })
      .join("");

    el.accountsTable.innerHTML = `<table>
      <thead><tr><th>Account</th><th>Institution</th><th>Type</th><th class="right">Share</th><th class="right">Balance</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
  }

  function renderAll(payload) {
    renderHero(payload);
    renderDeltas(payload);
    renderHistoryChart(payload.series || []);
    renderDonut(payload.category_breakdown || []);
    renderMovers(payload.account_changes || []);
    renderInstitutions(payload.institution_breakdown || []);
    renderMetrics(payload);
    renderAccounts(payload.accounts || []);

    el.lockScreen.classList.add("hidden");
    el.dashboard.classList.remove("hidden");
  }

  function setStatus(message, isError) {
    el.status.textContent = message;
    el.status.classList.toggle("error", !!isError);
  }

  el.form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const password = el.pw.value;
    if (!password) return;

    if (!window.crypto || !window.crypto.subtle) {
      setStatus("Browser doesn't support Web Crypto.", true);
      return;
    }

    try {
      setStatus("Decrypting...");
      const payload = await decrypt(password);
      try {
        renderAll(payload);
        setStatus(`Unlocked snapshot ${payload.latest_day}.`);
      } catch (renderErr) {
        console.error(renderErr);
        setStatus("Snapshot decrypted, but the page failed while rendering.", true);
        return;
      }
      el.pw.value = "";
    } catch (err) {
      console.error(err);
      setStatus("Wrong password or corrupted payload.", true);
    }
  });

  loadEncrypted().catch((err) => {
    console.error(err);
    el.snapshotDate.textContent = "Unavailable";
    setStatus("Could not load encrypted payload.", true);
  });
})();

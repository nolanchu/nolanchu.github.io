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

  // ── Helpers ──

  function esc(v) {
    return String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function money(v, signed) {
    const abs = Math.abs(Number(v));
    const fmt = abs.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (signed) return `${v >= 0 ? "+" : "\u2212"}${fmt}`;
    return `${v < 0 ? "\u2212" : ""}${fmt}`;
  }

  function pct(v) { return `${v.toFixed(1)}%`; }

  function deltaClass(v) {
    if (v == null || v === "n/a") return "";
    const s = typeof v === "string" ? v : "";
    if (typeof v === "number") return v >= 0 ? "up" : "down";
    return s.startsWith("+") ? "up" : s.startsWith("\u2212") || s.startsWith("-") ? "down" : "";
  }

  function b64(v) {
    const b = atob(v), a = new Uint8Array(b.length);
    for (let i = 0; i < b.length; i++) a[i] = b.charCodeAt(i);
    return a;
  }

  // ── Crypto ──

  async function loadEncrypted() {
    if (cached) return cached;
    const r = await fetch(ENCRYPTED_PATH, { cache: "no-store" });
    if (!r.ok) throw new Error(`Fetch failed (${r.status})`);
    cached = await r.json();
    el.snapshotDate.textContent = cached.snapshot_date || "";
    return cached;
  }

  async function decrypt(password) {
    const payload = await loadEncrypted();
    const raw = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"]);
    const key = await crypto.subtle.deriveKey(
      { name: "PBKDF2", salt: b64(payload.kdf.salt_b64), iterations: payload.kdf.iterations, hash: "SHA-256" },
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

  // ── Rendering ──

  function renderHero(p) {
    el.heroTotal.textContent = money(p.latest_total);
    el.heroAssets.textContent = money(p.assets_total);
    el.heroLiabilities.textContent = money(p.liabilities_total);
    el.heroDate.textContent = p.latest_day;

    // Delta badge: since last snapshot
    const snap = p.stats.find((s) => s.label === "Since last snapshot");
    if (snap && snap.delta !== "n/a") {
      const cls = deltaClass(snap.delta);
      el.heroDelta.className = "hero-delta " + cls;
      el.heroDelta.textContent = snap.delta + " since last snapshot";
    } else {
      el.heroDelta.style.display = "none";
    }
  }

  function renderDeltas(p) {
    el.deltas.innerHTML = p.stats
      .map((s) => {
        const cls = deltaClass(s.delta);
        return `<div class="delta-card">
          <div class="label">${esc(s.label)}</div>
          <div class="value ${cls}">${esc(s.delta)}</div>
        </div>`;
      })
      .join("");
  }

  function renderHistoryChart(series) {
    if (!series || series.length < 2) {
      el.historyChart.parentElement.innerHTML =
        '<div class="empty-msg">Need at least two snapshots for a chart.</div>';
      return;
    }

    el.historyMeta.textContent = `${series.length} snapshots`;

    const labels = series.map((d) => d.date);
    const data = series.map((d) => d.total);

    new Chart(el.historyChart, {
      type: "line",
      data: {
        labels,
        datasets: [{
          data,
          borderColor: "#1a6b5a",
          backgroundColor: "rgba(26,107,90,.08)",
          fill: true,
          tension: .3,
          pointRadius: series.length > 30 ? 0 : 4,
          pointHoverRadius: 6,
          pointBackgroundColor: "#1a6b5a",
          pointBorderColor: "#fff",
          pointBorderWidth: 2,
          borderWidth: 2.5,
        }],
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
              callback: (v) => money(v),
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
    if (!categories || !categories.length) return;

    const palette = ["#1a6b5a", "#2d9b7a", "#72c4a8", "#c0392b", "#e6a03e", "#8e7cc3"];
    const labels = categories.map((c) => c.label);
    const data = categories.map((c) => Math.abs(c.amount));
    const colors = categories.map((_, i) => palette[i % palette.length]);

    new Chart(el.donutChart, {
      type: "doughnut",
      data: {
        labels,
        datasets: [{
          data,
          backgroundColor: colors,
          borderWidth: 2,
          borderColor: "#fff",
          hoverOffset: 6,
        }],
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
              usePointStyle: true,
              pointStyleWidth: 10,
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
                const cat = categories[ctx.dataIndex];
                return ` ${cat.label}: ${money(cat.amount)} (${pct(cat.share_pct)})`;
              },
            },
          },
        },
      },
    });
  }

  function renderMovers(items) {
    if (!items || !items.length) {
      el.moversTable.innerHTML = '<div class="empty-msg">Need more than one snapshot to show movers.</div>';
      return;
    }

    const rows = items.slice(0, 8).map((item) => {
      const dt = item.delta == null ? "n/a" : money(item.delta, true);
      const cls = item.delta == null ? "" : item.delta >= 0 ? "positive" : "negative";
      return `<tr>
        <td>${esc(item.account_name)}</td>
        <td>${esc(item.institution)}</td>
        <td class="${cls}">${esc(dt)}</td>
        <td class="right">${esc(money(item.amount))}</td>
      </tr>`;
    }).join("");

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

    const maxPct = Math.max(...items.map((i) => Math.abs(i.share_pct)));

    el.instBreakdown.innerHTML = items
      .map((item) => {
        const w = maxPct > 0 ? (Math.abs(item.share_pct) / maxPct) * 100 : 0;
        const amtClass = item.amount < 0 ? "negative" : "";
        return `<div class="inst-row">
          <div class="inst-info">
            <div class="inst-name">${esc(item.label)}</div>
            <div class="inst-bar-track"><div class="inst-bar-fill" style="width:${w.toFixed(1)}%"></div></div>
          </div>
          <div class="inst-values">
            <div class="inst-amount ${amtClass}">${esc(money(item.amount))}</div>
            <div class="inst-pct">${esc(pct(item.share_pct))}</div>
          </div>
        </div>`;
      })
      .join("");
  }

  function renderMetrics(p) {
    const assets = p.assets_total || 0;
    const liabilities = p.liabilities_total || 0;
    const series = p.series || [];

    // Debt-to-asset ratio
    const dta = assets > 0 ? (liabilities / assets) : 0;

    // CAGR
    let cagr = null;
    if (series.length >= 2) {
      const first = series[0].total;
      const last = series[series.length - 1].total;
      const d0 = new Date(series[0].date);
      const d1 = new Date(series[series.length - 1].date);
      const years = (d1 - d0) / (365.25 * 86400000);
      if (years > 0 && first > 0 && last > 0) {
        cagr = (Math.pow(last / first, 1 / years) - 1) * 100;
      }
    }

    // Largest account concentration
    let topAcct = null;
    if (p.accounts && p.accounts.length) {
      topAcct = p.accounts.reduce((max, a) =>
        Math.abs(a.share_pct) > Math.abs(max.share_pct) ? a : max
      , p.accounts[0]);
    }

    const cards = [
      {
        label: "Debt / Asset Ratio",
        value: (dta * 100).toFixed(1) + "%",
        detail: `${money(liabilities)} liabilities \u00f7 ${money(assets)} assets`,
      },
      {
        label: "Growth Rate (CAGR)",
        value: cagr != null ? (cagr >= 0 ? "+" : "") + cagr.toFixed(1) + "%" : "n/a",
        detail: cagr != null ? `${series[0].date} \u2192 ${series[series.length - 1].date}` : "Need more data",
      },
      {
        label: "Top Concentration",
        value: topAcct ? pct(Math.abs(topAcct.share_pct)) : "n/a",
        detail: topAcct ? topAcct.account_name : "",
      },
    ];

    el.metrics.innerHTML = cards
      .map((c) => `<div class="metric-card">
        <div class="label">${esc(c.label)}</div>
        <div class="value">${esc(c.value)}</div>
        <div class="detail">${esc(c.detail)}</div>
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
      .map((a) => {
        const cls = a.amount < 0 ? "negative" : "";
        return `<tr>
          <td>${esc(a.account_name)}</td>
          <td>${esc(a.institution)}</td>
          <td>${esc(a.account_type)}</td>
          <td class="right">${esc(pct(a.share_pct))}</td>
          <td class="right ${cls}">${esc(money(a.amount))}</td>
        </tr>`;
      })
      .join("");

    el.accountsTable.innerHTML = `<table>
      <thead><tr><th>Account</th><th>Institution</th><th>Type</th><th class="right">Share</th><th class="right">Balance</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
  }

  // ── Main render ──

  function renderAll(p) {
    renderHero(p);
    renderDeltas(p);
    renderHistoryChart(p.series || []);
    renderDonut(p.category_breakdown || []);
    renderMovers(p.account_changes || []);
    renderInstitutions(p.institution_breakdown || []);
    renderMetrics(p);
    renderAccounts(p.accounts || []);

    el.lockScreen.classList.add("hidden");
    el.dashboard.classList.remove("hidden");
  }

  function setStatus(msg, err) {
    el.status.textContent = msg;
    el.status.classList.toggle("error", !!err);
  }

  // ── Events ──

  el.form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const pw = el.pw.value;
    if (!pw) return;

    if (!window.crypto?.subtle) {
      setStatus("Browser doesn't support Web Crypto.", true);
      return;
    }

    try {
      setStatus("Decrypting\u2026");
      const p = await decrypt(pw);
      renderAll(p);
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

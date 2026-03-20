(function () {
  const encryptedPath = "./encrypted-data.json";

  const elements = {
    form: document.getElementById("unlock-form"),
    passwordInput: document.getElementById("password-input"),
    status: document.getElementById("status"),
    snapshotDate: document.getElementById("snapshot-date"),
    dashboard: document.getElementById("dashboard"),
    summary: document.getElementById("summary"),
    historyMeta: document.getElementById("history-meta"),
    historyChart: document.getElementById("history-chart"),
    categoryBreakdown: document.getElementById("category-breakdown"),
    institutionBreakdown: document.getElementById("institution-breakdown"),
    moversTable: document.getElementById("movers-table"),
    accountsMeta: document.getElementById("accounts-meta"),
    accountsTable: document.getElementById("accounts-table"),
  };

  let encryptedPayload = null;

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function fmtMoney(value, signed) {
    const absValue = Math.abs(Number(value));
    const formatted = absValue.toLocaleString("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    if (signed) {
      return `${value >= 0 ? "+" : "-"}${formatted}`;
    }
    return `${value < 0 ? "-" : ""}${formatted}`;
  }

  function b64ToBytes(value) {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }

  async function loadEncryptedPayload() {
    if (encryptedPayload) {
      return encryptedPayload;
    }
    const response = await fetch(encryptedPath, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Failed to fetch encrypted payload (${response.status})`);
    }
    encryptedPayload = await response.json();
    elements.snapshotDate.textContent = `Snapshot ${encryptedPayload.snapshot_date}`;
    return encryptedPayload;
  }

  async function decryptPayload(password) {
    const payload = await loadEncryptedPayload();
    const passwordKey = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(password),
      "PBKDF2",
      false,
      ["deriveKey"]
    );
    const key = await crypto.subtle.deriveKey(
      {
        name: "PBKDF2",
        salt: b64ToBytes(payload.kdf.salt_b64),
        iterations: payload.kdf.iterations,
        hash: "SHA-256",
      },
      passwordKey,
      { name: "AES-GCM", length: 256 },
      false,
      ["decrypt"]
    );
    const plaintext = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: b64ToBytes(payload.cipher.iv_b64),
      },
      key,
      b64ToBytes(payload.cipher.ciphertext_b64)
    );
    return JSON.parse(new TextDecoder().decode(plaintext));
  }

  function summaryCards(payload) {
    return [
      { label: "Net worth", value: fmtMoney(payload.latest_total), className: "hero-total" },
      { label: "Assets", value: fmtMoney(payload.assets_total) },
      { label: "Liabilities", value: fmtMoney(payload.liabilities_total) },
      { label: "Latest snapshot", value: escapeHtml(payload.latest_day) },
      { label: "Tracked accounts", value: String(payload.accounts.length) },
      ...payload.stats.map((item) => ({
        label: item.label,
        value: item.delta,
      })),
    ];
  }

  function renderSummary(payload) {
    elements.summary.innerHTML = summaryCards(payload)
      .map(
        (item) => `
          <article class="summary-card ${item.className || ""}">
            <div class="label">${escapeHtml(item.label)}</div>
            <div class="value">${escapeHtml(item.value)}</div>
          </article>
        `
      )
      .join("");
  }

  function renderHistoryChart(series) {
    if (!series || series.length < 2) {
      elements.historyChart.innerHTML =
        '<div class="empty">At least two snapshots are needed before the history curve becomes useful.</div>';
      return;
    }

    const width = 960;
    const height = 320;
    const leftPad = 36;
    const rightPad = 18;
    const topPad = 24;
    const bottomPad = 38;
    const innerWidth = width - leftPad - rightPad;
    const innerHeight = height - topPad - bottomPad;
    const totals = series.map((point) => point.total);
    const minTotal = Math.min(...totals);
    const maxTotal = Math.max(...totals);
    const spread = Math.max(maxTotal - minTotal, 1);
    const baseline = topPad + innerHeight;

    const points = series.map((point, index) => {
      const x = leftPad + (index / Math.max(series.length - 1, 1)) * innerWidth;
      const y = topPad + (1 - (point.total - minTotal) / spread) * innerHeight;
      return { x, y, date: point.date, total: point.total };
    });

    const linePath = points
      .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`)
      .join(" ");
    const areaPath = `M ${points[0].x.toFixed(1)} ${baseline.toFixed(1)} ${points
      .map((point) => `L ${point.x.toFixed(1)} ${point.y.toFixed(1)}`)
      .join(" ")} L ${points[points.length - 1].x.toFixed(1)} ${baseline.toFixed(1)} Z`;

    const gridLines = [];
    for (let step = 0; step < 5; step += 1) {
      const y = topPad + (step / 4) * innerHeight;
      const value = maxTotal - (step / 4) * (maxTotal - minTotal);
      gridLines.push(`
        <line x1="${leftPad}" y1="${y.toFixed(1)}" x2="${width - rightPad}" y2="${y.toFixed(
        1
      )}" class="chart-grid" />
        <text x="0" y="${(y + 4).toFixed(1)}" class="chart-axis">${fmtMoney(value)}</text>
      `);
    }

    const pointDots = points
      .map(
        (point) =>
          `<circle cx="${point.x.toFixed(1)}" cy="${point.y.toFixed(1)}" r="3.5" class="chart-dot" />`
      )
      .join("");

    elements.historyChart.innerHTML = `
      <div class="chart-wrap">
        <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Net worth history chart">
          <defs>
            <linearGradient id="history-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="#3d8d7a" stop-opacity="0.38"></stop>
              <stop offset="100%" stop-color="#3d8d7a" stop-opacity="0.02"></stop>
            </linearGradient>
          </defs>
          ${gridLines.join("")}
          <path d="${areaPath}" fill="url(#history-fill)"></path>
          <path d="${linePath}" fill="none" stroke="#184c43" stroke-width="4" stroke-linecap="round"></path>
          ${pointDots}
          <text x="${leftPad}" y="${height - 10}" class="chart-axis">${escapeHtml(
            points[0].date
          )}</text>
          <text x="${width - rightPad}" y="${height - 10}" text-anchor="end" class="chart-axis">${escapeHtml(
            points[points.length - 1].date
          )}</text>
        </svg>
      </div>
    `;
  }

  function renderBreakdown(container, items, emptyText) {
    if (!items || !items.length) {
      container.innerHTML = `<div class="empty">${escapeHtml(emptyText)}</div>`;
      return;
    }

    container.innerHTML = `
      <table class="breakdown-table">
        <thead>
          <tr><th>Group</th><th>Share</th><th>Amount</th></tr>
        </thead>
        <tbody>
          ${items
            .map(
              (item) => `
                <tr>
                  <td>${escapeHtml(item.label)}</td>
                  <td>${escapeHtml(`${item.share_pct.toFixed(1)}%`)}</td>
                  <td class="${item.amount < 0 ? "negative" : ""}">${escapeHtml(
                fmtMoney(item.amount)
              )}</td>
                </tr>
              `
            )
            .join("")}
        </tbody>
      </table>
    `;
  }

  function renderMovers(items) {
    if (!items || !items.length) {
      elements.moversTable.innerHTML =
        '<div class="empty">More than one snapshot is needed before account-level changes can be shown.</div>';
      return;
    }

    elements.moversTable.innerHTML = `
      <table class="movers-table">
        <thead>
          <tr><th>Account</th><th>Institution</th><th>Move</th><th>Latest</th></tr>
        </thead>
        <tbody>
          ${items
            .slice(0, 6)
            .map((item) => {
              const deltaText = item.delta == null ? "n/a" : fmtMoney(item.delta, true);
              const deltaClass =
                item.delta == null ? "" : item.delta >= 0 ? "positive" : "negative";
              return `
                <tr>
                  <td>${escapeHtml(item.account_name)}</td>
                  <td>${escapeHtml(item.institution)}</td>
                  <td class="${deltaClass}">${escapeHtml(deltaText)}</td>
                  <td>${escapeHtml(fmtMoney(item.amount))}</td>
                </tr>
              `;
            })
            .join("")}
        </tbody>
      </table>
    `;
  }

  function renderAccounts(items) {
    if (!items || !items.length) {
      elements.accountsTable.innerHTML =
        '<div class="empty">No account rows were found in the decrypted payload.</div>';
      return;
    }

    elements.accountsTable.innerHTML = `
      <table class="accounts-table">
        <thead>
          <tr><th>Account</th><th>Institution</th><th>Type</th><th>Subtype</th><th>Share</th><th>Amount</th></tr>
        </thead>
        <tbody>
          ${items
            .map(
              (item) => `
                <tr>
                  <td>${escapeHtml(item.account_name)}</td>
                  <td>${escapeHtml(item.institution)}</td>
                  <td>${escapeHtml(item.account_type)}</td>
                  <td>${escapeHtml(item.account_subtype)}</td>
                  <td>${escapeHtml(`${item.share_pct.toFixed(1)}%`)}</td>
                  <td class="${item.amount < 0 ? "negative" : ""}">${escapeHtml(
                fmtMoney(item.amount)
              )}</td>
                </tr>
              `
            )
            .join("")}
        </tbody>
      </table>
    `;
  }

  function renderPayload(payload) {
    renderSummary(payload);
    renderHistoryChart(payload.series || []);
    renderBreakdown(
      elements.categoryBreakdown,
      payload.category_breakdown || [],
      "No category breakdown was found in the snapshot."
    );
    renderBreakdown(
      elements.institutionBreakdown,
      payload.institution_breakdown || [],
      "No institution breakdown was found in the snapshot."
    );
    renderMovers(payload.account_changes || []);
    renderAccounts(payload.accounts || []);

    elements.historyMeta.textContent = `${payload.series.length} snapshots from ${payload.first_day} to ${payload.latest_day}`;
    elements.accountsMeta.textContent = `${payload.accounts.length} accounts in the latest snapshot`;
    elements.dashboard.classList.remove("hidden");
  }

  function setStatus(message, isError) {
    elements.status.textContent = message;
    elements.status.classList.toggle("error", Boolean(isError));
  }

  elements.form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const password = elements.passwordInput.value;
    if (!password) {
      return;
    }

    if (!window.crypto || !window.crypto.subtle) {
      setStatus("This browser does not support the Web Crypto APIs needed for decryption.", true);
      return;
    }

    try {
      setStatus("Decrypting snapshot locally...", false);
      const payload = await decryptPayload(password);
      renderPayload(payload);
      setStatus(`Decrypted snapshot ${payload.latest_day}.`, false);
      elements.passwordInput.value = "";
    } catch (error) {
      console.error(error);
      setStatus("Decryption failed. The password is wrong or the published payload is invalid.", true);
    }
  });

  loadEncryptedPayload().catch((error) => {
    console.error(error);
    elements.snapshotDate.textContent = "Metadata unavailable";
    setStatus("The encrypted payload could not be loaded from this static site.", true);
  });
})();

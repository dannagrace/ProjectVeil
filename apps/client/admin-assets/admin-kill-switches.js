const headline = document.getElementById("headline");
  const versionRows = document.getElementById("versionRows");
  const switchRows = document.getElementById("switchRows");
  const summary = document.getElementById("clientVersionSummary");

      const { escapeHtml } = window.VeilAdmin;

      function render(payload) {
    headline.textContent = `已加载 ${payload.serverTime} · activeVersion=${payload.clientMinVersion.activeVersion}`;
    summary.textContent = `默认最低版本 ${payload.clientMinVersion.defaultVersion} · ${
      payload.clientMinVersion.upgradeMessage || "未配置升级提示"
    }`;
    versionRows.innerHTML = Object.entries(payload.clientMinVersion.channels || {})
      .map(([channel, version]) => `<tr><td>${escapeHtml(channel)}</td><td>${escapeHtml(version)}</td></tr>`)
      .join("") || '<tr><td colspan="2" class="muted">当前没有按渠道覆盖。</td></tr>';
    switchRows.innerHTML = payload.killSwitches
      .map((item) => `
        <tr>
          <td>${escapeHtml(item.key)}<div class="muted">${escapeHtml(item.label)}</div></td>
          <td><span class="pill ${item.enabled ? "warn" : ""}">${item.enabled ? "enabled" : "disabled"}</span></td>
          <td>${(item.channels || []).length ? escapeHtml((item.channels || []).join(", ")) : '<span class="muted">all</span>'}</td>
          <td>${item.summary ? escapeHtml(item.summary) : '<span class="muted">无备注</span>'}</td>
        </tr>
      `)
      .join("");
  }

  async function refresh() {
    const secret = document.getElementById("adminSecret").value.trim();
    headline.textContent = "正在加载...";
    try {
      const response = await fetch("/api/admin/runtime/kill-switches", {
        headers: secret ? { "x-veil-admin-secret": secret } : {}
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || response.status);
      }
      render(payload);
    } catch (error) {
      headline.textContent = `加载失败：${error.message}`;
    }
  }

  document.getElementById("refreshButton").addEventListener("click", refresh);

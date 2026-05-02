const secretInput = document.getElementById("secret");
  const statusEl = document.getElementById("status");
  const summaryEl = document.getElementById("summary");
  const runtimeStateEl = document.getElementById("runtimeState");
  const entriesBody = document.getElementById("entriesBody");

  const entryIdEl = document.getElementById("entryId");
  const entryTitleEl = document.getElementById("entryTitle");
  const entryStartsAtEl = document.getElementById("entryStartsAt");
  const entryEndsAtEl = document.getElementById("entryEndsAt");
  const entryStatusEl = document.getElementById("entryStatus");
  const entryDescriptionEl = document.getElementById("entryDescription");
  const entryActionEl = document.getElementById("entryAction");
  const entryEndActionEl = document.getElementById("entryEndAction");

  function readSecret() {
    return secretInput.value.trim();
  }

      const { escapeHtml } = window.VeilAdmin;

      async function requestJson(url, options = {}) {
    const secret = readSecret();
    const response = await fetch(url, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(secret ? { "x-veil-admin-secret": secret } : {}),
        ...(options.headers || {})
      }
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error || response.statusText);
    }
    return payload;
  }

  function renderSummary(summary, runtime) {
    summaryEl.innerHTML = "";
    const items = [
      `scheduled ${summary.counts.scheduled}`,
      `active ${summary.counts.active}`,
      `ended ${summary.counts.ended}`,
      `next ${summary.nextStartAt || "none"}`
    ];
    for (const item of items) {
      const chip = document.createElement("span");
      chip.className = "chip";
      chip.textContent = item;
      summaryEl.appendChild(chip);
    }
    runtimeStateEl.textContent = JSON.stringify(runtime, null, 2);
  }

  async function fetchCalendar() {
    statusEl.textContent = "正在刷新...";
    try {
      const payload = await requestJson("/api/admin/live-ops-calendar");
      renderSummary(payload.summary, payload.runtime);
      entriesBody.innerHTML = "";
      for (const entry of payload.entries) {
        const row = document.createElement("tr");
        row.innerHTML = `
          <td>
            <strong>${escapeHtml(entry.id)}</strong><br />
            <span class="muted">${escapeHtml(entry.title)}</span><br />
            <span class="muted">${escapeHtml(entry.description || "")}</span>
          </td>
          <td>
            <div>${escapeHtml(entry.startsAt)}</div>
            <div class="muted">${escapeHtml(entry.endsAt || "无结束时间")}</div>
          </td>
          <td>
            <div>${escapeHtml(entry.status)}</div>
            <div class="muted">started ${escapeHtml(entry.startedAtActual || "-")}</div>
            <div class="muted">ended ${escapeHtml(entry.endedAtActual || "-")}</div>
          </td>
          <td>
            <div class="actions">
              <button type="button" data-action="start" data-id="${escapeHtml(entry.id)}">手动开始</button>
              <button type="button" class="secondary" data-action="end" data-id="${escapeHtml(entry.id)}">手动结束</button>
              <button type="button" class="danger" data-action="delete" data-id="${escapeHtml(entry.id)}">删除</button>
            </div>
            <pre>${escapeHtml(JSON.stringify({ action: entry.action, endAction: entry.endAction || null }, null, 2))}</pre>
          </td>
        `;
        entriesBody.appendChild(row);
      }
      statusEl.textContent = `已刷新 ${payload.updatedAt}`;
    } catch (error) {
      statusEl.textContent = `刷新失败：${error.message}`;
    }
  }

  async function saveEntry() {
    try {
      const payload = {
        entry: {
          id: entryIdEl.value.trim(),
          title: entryTitleEl.value.trim(),
          description: entryDescriptionEl.value.trim() || undefined,
          startsAt: entryStartsAtEl.value.trim(),
          endsAt: entryEndsAtEl.value.trim() || undefined,
          status: entryStatusEl.value,
          action: JSON.parse(entryActionEl.value),
          endAction: entryEndActionEl.value.trim() ? JSON.parse(entryEndActionEl.value) : undefined
        }
      };
      await requestJson("/api/admin/live-ops-calendar", {
        method: "POST",
        body: JSON.stringify(payload)
      });
      statusEl.textContent = "条目已保存";
      await fetchCalendar();
    } catch (error) {
      statusEl.textContent = `保存失败：${error.message}`;
    }
  }

  async function triggerEntry(id, action) {
    try {
      if (action === "delete") {
        await requestJson(`/api/admin/live-ops-calendar/${encodeURIComponent(id)}`, {
          method: "DELETE"
        });
      } else {
        await requestJson(`/api/admin/live-ops-calendar/${encodeURIComponent(id)}/${action}`, {
          method: "POST"
        });
      }
      statusEl.textContent = `${id} 已执行 ${action}`;
      await fetchCalendar();
    } catch (error) {
      statusEl.textContent = `操作失败：${error.message}`;
    }
  }

  document.getElementById("reload").addEventListener("click", fetchCalendar);
  document.getElementById("saveEntry").addEventListener("click", saveEntry);
  entriesBody.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-action]");
    if (!button) return;
    triggerEntry(button.dataset.id, button.dataset.action);
  });

  fetchCalendar();

const secretInput = document.getElementById('adminSecret');
    const statusDiv = document.getElementById('status');
    const reportFilter = document.getElementById('reportStatusFilter');
    const reportList = document.getElementById('reportList');
    const compensationHistoryBody = document.getElementById('compensationHistoryBody');
    const playerOverviewBody = document.getElementById('playerOverviewBody');
    const batchCompensationBody = document.getElementById('batchCompensationBody');
    const auditLogBody = document.getElementById('auditLogBody');

        const { escapeHtml } = window.VeilAdmin;

        function showStatus(msg, type) {
        statusDiv.textContent = msg;
        statusDiv.className = type === 'error' ? 'status-error' : 'status-success';
        statusDiv.style.display = 'block';
    }

    async function fetchOverview() {
        try {
            const res = await fetch('/api/admin/overview', {
                headers: { 'x-veil-admin-secret': secretInput.value }
            });
            if (res.ok) {
                const data = await res.json();
                document.getElementById('stat-rooms').textContent = data.activeRooms;
                document.getElementById('stat-players').textContent = data.activePlayers;
            }
        } catch (e) {}
    }

    async function modifyResources() {
        const pid = document.getElementById('targetPlayerId').value;
        showStatus('正在发送请求...', 'success');
        
        try {
            const res = await fetch(`/api/admin/players/${pid}/resources`, {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'x-veil-admin-secret': secretInput.value 
                },
                body: JSON.stringify({
                    gold: parseInt(document.getElementById('modGold').value),
                    wood: parseInt(document.getElementById('modWood').value),
                    ore: 0
                })
            });

            const data = await res.json();
            if (res.ok) {
                showStatus(`修改成功！\n当前 Gold: ${data.resources.gold}\n同步到房间: ${data.syncedToRoom ? '✅ 是' : '❌ 否 (无活跃房间)'}`, 'success');
            } else {
                showStatus(`修改失败！\n状态码: ${res.status}\n原因: ${JSON.stringify(data.error || data)}`, 'error');
            }
        } catch (e) {
            showStatus(`网络错误: ${e.message}`, 'error');
        }
    }

    function renderCompensationHistory(items) {
        if (!items.length) {
            compensationHistoryBody.innerHTML = '<tr><td colspan="6" class="empty-state">当前玩家还没有补偿记录。</td></tr>';
            return;
        }

        compensationHistoryBody.innerHTML = items.map((item) => `
            <tr>
                <td>${escapeHtml(item.createdAt)}</td>
                <td>${item.type === 'deduct' ? '扣减' : '发放'}</td>
                <td>${escapeHtml(item.currency)}</td>
                <td>${escapeHtml(item.amount)}</td>
                <td>${escapeHtml(item.previousBalance)} -> ${escapeHtml(item.balanceAfter)}</td>
                <td>${escapeHtml(item.reason)}</td>
            </tr>
        `).join('');
    }

    async function fetchCompensationHistory() {
        const pid = document.getElementById('targetPlayerId').value.trim();
        if (!pid) {
            compensationHistoryBody.innerHTML = '<tr><td colspan="6" class="empty-state">请先输入 Player ID。</td></tr>';
            return;
        }

        try {
            const res = await fetch(`/api/admin/players/${pid}/compensation/history?limit=20`, {
                headers: { 'x-veil-admin-secret': secretInput.value }
            });
            const data = await res.json();
            if (!res.ok) {
                compensationHistoryBody.innerHTML = `<tr><td colspan="6" class="empty-state">加载失败：${escapeHtml(data.error || res.status)}</td></tr>`;
                return;
            }
            renderCompensationHistory(data.items || []);
        } catch (e) {
            compensationHistoryBody.innerHTML = `<tr><td colspan="6" class="empty-state">网络错误：${escapeHtml(e.message)}</td></tr>`;
        }
    }

    async function submitCompensation() {
        const pid = document.getElementById('targetPlayerId').value.trim();
        if (!pid) {
            showStatus('请先输入 Player ID。', 'error');
            return;
        }

        showStatus('正在提交补偿请求...', 'success');

        try {
            const res = await fetch(`/api/admin/players/${pid}/compensation`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-veil-admin-secret': secretInput.value
                },
                body: JSON.stringify({
                    type: document.getElementById('compensationType').value,
                    currency: document.getElementById('compensationCurrency').value,
                    amount: parseInt(document.getElementById('compensationAmount').value, 10),
                    reason: document.getElementById('compensationReason').value
                })
            });
            const data = await res.json();
            if (!res.ok) {
                showStatus(`补偿失败！\n状态码: ${res.status}\n原因: ${JSON.stringify(data.error || data)}`, 'error');
                return;
            }

            showStatus(
                `补偿成功！\nGems: ${data.balances.gems}\nGold: ${data.balances.resources.gold}\nWood: ${data.balances.resources.wood}\nOre: ${data.balances.resources.ore}\n同步到房间: ${data.syncedToRoom ? '✅ 是' : '❌ 否 (无活跃房间)'}`,
                'success'
            );
            await fetchCompensationHistory();
        } catch (e) {
            showStatus(`网络错误: ${e.message}`, 'error');
        }
    }

    function renderPlayerOverview(data) {
        playerOverviewBody.innerHTML = `
            <tr><td><strong>${escapeHtml(data.account.displayName || data.playerId)}</strong> · ${escapeHtml(data.playerId)}</td></tr>
            <tr><td>段位：${escapeHtml(data.account.rankDivision || '-')} · Elo：${escapeHtml(data.account.eloRating || 0)} · 战令：${escapeHtml(data.account.seasonPassTier || 0)}</td></tr>
            <tr><td>封禁状态：${escapeHtml(data.moderation.currentBan?.banStatus || 'none')} · 工单 ${escapeHtml(data.supportTickets.length)} · 举报 ${escapeHtml(data.reports.againstPlayer.length)} · 邮件 ${escapeHtml((data.mailbox || []).length)}</td></tr>
            <tr><td>最近补偿：${data.compensationHistory[0] ? `${escapeHtml(data.compensationHistory[0].currency)} ${escapeHtml(data.compensationHistory[0].amount)} (${escapeHtml(data.compensationHistory[0].reason)})` : '无'}</td></tr>
            <tr><td>最近消费：${data.purchaseHistory.items[0] ? `${escapeHtml(data.purchaseHistory.items[0].itemId)} / ${escapeHtml(data.purchaseHistory.items[0].amount)}` : '无'}</td></tr>
            <tr><td>最近战斗：${data.battleHistory[0] ? `${escapeHtml(data.battleHistory[0].battleId)} / ${escapeHtml(data.battleHistory[0].status)}` : '无'}</td></tr>
        `;
    }

    async function fetchPlayerOverview() {
        const pid = document.getElementById('targetPlayerId').value.trim();
        if (!pid) {
            playerOverviewBody.innerHTML = '<tr><td class="empty-state">请先输入 Player ID。</td></tr>';
            return;
        }
        try {
            const res = await fetch(`/api/admin/players/${pid}/overview`, {
                headers: { 'x-veil-admin-secret': secretInput.value }
            });
            const data = await res.json();
            if (!res.ok) {
                playerOverviewBody.innerHTML = `<tr><td class="empty-state">加载失败：${escapeHtml(data.error || res.status)}</td></tr>`;
                return;
            }
            renderPlayerOverview(data);
        } catch (e) {
            playerOverviewBody.innerHTML = `<tr><td class="empty-state">网络错误：${escapeHtml(e.message)}</td></tr>`;
        }
    }

    function readBatchSegment() {
        const premiumValue = document.getElementById('batchPremiumFilter').value;
        const minEloRaw = document.getElementById('batchMinElo').value.trim();
        const segment = {};
        const rankDivision = document.getElementById('batchRankDivision').value.trim();
        if (rankDivision) {
            segment.rankDivision = rankDivision;
        }
        if (minEloRaw) {
            segment.minimumEloRating = parseInt(minEloRaw, 10);
        }
        if (premiumValue === 'true') {
            segment.seasonPassPremium = true;
        } else if (premiumValue === 'false') {
            segment.seasonPassPremium = false;
        }
        return segment;
    }

    function renderBatchPreview(data) {
        if (!data.targets.length) {
            batchCompensationBody.innerHTML = '<tr><td class="empty-state">当前筛选没有命中玩家。</td></tr>';
            return;
        }
        batchCompensationBody.innerHTML = data.targets.map((target) => `
            <tr>
                <td><strong>${escapeHtml(target.displayName)}</strong> · ${escapeHtml(target.playerId)} · 段位 ${escapeHtml(target.rankDivision || '-')} · Elo ${escapeHtml(target.eloRating || 0)}</td>
            </tr>
        `).join('');
    }

    async function postBatchCompensation(previewOnly) {
        const payload = {
            type: 'add',
            currency: document.getElementById('batchCurrency').value,
            amount: parseInt(document.getElementById('batchAmount').value, 10),
            reason: document.getElementById('batchReason').value,
            previewOnly,
            segment: readBatchSegment(),
            message: {
                title: document.getElementById('batchMessageTitle').value,
                body: document.getElementById('batchMessageBody').value
            }
        };

        const res = await fetch('/api/admin/compensation/batch', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-veil-admin-secret': secretInput.value
            },
            body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (!res.ok) {
            throw new Error(data.error || `HTTP ${res.status}`);
        }
        renderBatchPreview(data);
        showStatus(previewOnly ? `预览完成，命中 ${data.matchedCount} 名玩家。` : `批量补偿已发放，送达 ${data.delivery.deliveredPlayerIds.length} 名玩家。`, 'success');
    }

    async function previewBatchCompensation() {
        try {
            await postBatchCompensation(true);
        } catch (e) {
            showStatus(`批量补偿预览失败：${e.message}`, 'error');
        }
    }

    async function submitBatchCompensation() {
        try {
            await postBatchCompensation(false);
        } catch (e) {
            showStatus(`批量补偿发放失败：${e.message}`, 'error');
        }
    }

    async function fetchAuditLog() {
        try {
            const res = await fetch('/api/admin/audit-log?limit=20', {
                headers: { 'x-veil-admin-secret': secretInput.value }
            });
            const data = await res.json();
            if (!res.ok) {
                auditLogBody.innerHTML = `<tr><td class="empty-state">加载失败：${escapeHtml(data.error || res.status)}</td></tr>`;
                return;
            }
            if (!(data.items || []).length) {
                auditLogBody.innerHTML = '<tr><td class="empty-state">当前还没有 GM 操作审计记录。</td></tr>';
                return;
            }
            auditLogBody.innerHTML = (data.items || []).map((item) => `
                <tr><td><strong>${escapeHtml(item.action)}</strong> · ${escapeHtml(item.actorPlayerId)} · ${escapeHtml(item.targetPlayerId || item.targetScope || '-')} · ${escapeHtml(item.occurredAt)}<br/>${escapeHtml(item.summary)}</td></tr>
            `).join('');
        } catch (e) {
            auditLogBody.innerHTML = `<tr><td class="empty-state">网络错误：${escapeHtml(e.message)}</td></tr>`;
        }
    }

    function renderReports(items) {
        if (!items.length) {
            reportList.innerHTML = '<div class="empty-state">当前筛选下没有举报记录。</div>';
            return;
        }

        reportList.innerHTML = items.map((report) => `
            <div class="report-row">
                <div><strong>${escapeHtml(report.reportId)}</strong> · ${escapeHtml(report.reporterId)} -> ${escapeHtml(report.targetId)}</div>
                <p>原因：${escapeHtml(report.reason)} · 房间：${escapeHtml(report.roomId)} · 状态：${escapeHtml(report.status)}</p>
                <p>创建时间：${escapeHtml(report.createdAt)}${report.description ? `\n说明：${escapeHtml(report.description)}` : ''}</p>
                ${report.status === 'pending' ? `
                    <div class="report-actions">
                        <button data-report-id="${escapeHtml(report.reportId)}" data-status="dismissed">驳回</button>
                        <button data-report-id="${escapeHtml(report.reportId)}" data-status="warned">警告</button>
                        <button data-report-id="${escapeHtml(report.reportId)}" data-status="banned">封禁</button>
                    </div>
                ` : ''}
            </div>
        `).join('');

        for (const button of reportList.querySelectorAll('[data-report-id]')) {
            button.addEventListener('click', async () => {
                const reportId = button.dataset.reportId;
                const status = button.dataset.status;
                if (!reportId || !status) {
                    return;
                }
                showStatus(`正在处理举报 ${reportId}...`, 'success');
                try {
                    const res = await fetch(`/api/admin/reports/${reportId}/resolve`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'x-veil-admin-secret': secretInput.value
                        },
                        body: JSON.stringify({ status })
                    });
                    const data = await res.json();
                    if (!res.ok) {
                        showStatus(`处理失败：${data.error || res.status}`, 'error');
                        return;
                    }
                    showStatus(`举报 ${reportId} 已更新为 ${data.report.status}`, 'success');
                    await fetchReports();
                } catch (e) {
                    showStatus(`网络错误: ${e.message}`, 'error');
                }
            });
        }
    }

    async function fetchReports() {
        try {
            const status = reportFilter.value;
            const res = await fetch(`/api/admin/reports?status=${encodeURIComponent(status)}`, {
                headers: { 'x-veil-admin-secret': secretInput.value }
            });
            if (!res.ok) {
                const data = await res.json();
                reportList.innerHTML = `<div class="empty-state">加载失败：${escapeHtml(data.error || res.status)}</div>`;
                return;
            }
            const data = await res.json();
            renderReports(data.items || []);
        } catch (e) {
            reportList.innerHTML = `<div class="empty-state">网络错误：${escapeHtml(e.message)}</div>`;
        }
    }
        document.getElementById('modifyResourcesButton').addEventListener('click', () => { void modifyResources(); });
        document.getElementById('submitCompensationButton').addEventListener('click', () => { void submitCompensation(); });
        document.getElementById('refreshCompensationHistoryButton').addEventListener('click', () => { void fetchCompensationHistory(); });
        document.getElementById('fetchPlayerOverviewButton').addEventListener('click', () => { void fetchPlayerOverview(); });
        document.getElementById('previewBatchCompensationButton').addEventListener('click', () => { void previewBatchCompensation(); });
        document.getElementById('submitBatchCompensationButton').addEventListener('click', () => { void submitBatchCompensation(); });
        document.getElementById('fetchAuditLogButton').addEventListener('click', () => { void fetchAuditLog(); });

        setInterval(fetchOverview, 5000);
    reportFilter.addEventListener('change', () => { void fetchReports(); });
    fetchOverview();
    fetchReports();
    fetchCompensationHistory();
    fetchAuditLog();

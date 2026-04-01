// Node.js 原生 fetch 联调脚本

async function testAdminSync() {
  const ADMIN_SECRET = 'veil-admin-2026';
  const baseUrl = 'http://localhost:2567';

  console.log('--- ProjectVeil Admin Sync 联调测试 ---');

  try {
    // 1. 验证 Admin Overview
    const overviewRes = await fetch(`${baseUrl}/api/admin/overview`, {
      headers: { 'x-veil-admin-secret': ADMIN_SECRET }
    });
    if (!overviewRes.ok) throw new Error(`Status ${overviewRes.status}`);
    const overview = await overviewRes.json();
    console.log('[Step 1] Server Overview:', JSON.stringify(overview, null, 2));

    // 2. 修改 player-1 的资源
    console.log('[Step 2] Modifying resources for player-1...');
    const modRes = await fetch(`${baseUrl}/api/admin/players/player-1/resources`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'x-veil-admin-secret': ADMIN_SECRET 
      },
      body: JSON.stringify({ gold: 5000, wood: 2000, ore: 0 })
    });
    const modResult = await modRes.json();
    console.log('[Step 2 Result] Modification:', JSON.stringify(modResult, null, 2));

    // 3. 发送广播测试
    console.log('[Step 3] Sending Broadcast...');
    const broadcastRes = await fetch(`${baseUrl}/api/admin/broadcast`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'x-veil-admin-secret': ADMIN_SECRET 
      },
      body: JSON.stringify({ message: 'Automation Test Message', type: 'success' })
    });
    const broadcastResult = await broadcastRes.json();
    console.log('[Step 3 Result] Broadcast:', JSON.stringify(broadcastResult, null, 2));

  } catch (error) {
    console.error('❌ 测试过程中发生错误:', error.message);
  }
}

testAdminSync();

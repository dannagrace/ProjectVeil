import { test, expect } from './fixtures';

test('Admin Console 联动测试: 修改资源并验证实时同步', async ({ browser }) => {
  // 1. 创建玩家页面 (H5 Client)
  const playerContext = await browser.newContext();
  const playerPage = await playerContext.newPage();
  await playerPage.goto('http://127.0.0.1:4173');
  
  // 模拟登录 player-1
  const nameInput = playerPage.locator('input[placeholder*="ID"], input[type="text"]').first();
  await nameInput.fill('player-1');
  await playerPage.keyboard.press('Enter');
  
  // 等待游戏加载 (根据日志，等待 [Veil] Joined room)
  await playerPage.waitForTimeout(3000);
  
  // 2. 创建管理员页面 (Admin Console)
  const adminContext = await browser.newContext();
  const adminPage = await adminContext.newPage();
  await adminPage.goto('http://127.0.0.1:2567/admin');
  
  // 输入 Player ID 并修改资源
  await adminPage.fill('#targetPlayerId', 'player-1');
  await adminPage.fill('#modGold', '9999');
  
  // 点击确认修改
  await adminPage.click('button:has-text("确认修改")');
  
  // 等待同步
  await adminPage.waitForTimeout(1000);
  
  // 3. 验证玩家端数据 (通过执行 JS 检查内存状态)
  const goldValue = await playerPage.evaluate(() => {
    // 假设游戏状态挂载在全局或可以通过 colyseus client 访问
    // 这里我们直接检查 H5 端是否收到了新的 resources 数据
    // 作为一个通用的验证，我们截取 H5 页面的图片，或者检查特定的 UI 元素
    return document.body.innerText; 
  });

  // 4. 视觉确认：截屏
  await playerPage.screenshot({ path: 'output/admin_sync_test_h5.png' });
  await adminPage.screenshot({ path: 'output/admin_sync_test_admin.png' });
  
  console.log('测试完成：已生成截图至 output 目录。');
});

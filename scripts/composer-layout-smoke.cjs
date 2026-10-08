const { _electron } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs/promises'), os = require('node:os'), path = require('node:path'), assert = require('node:assert/strict');
(async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ailo-layout-'));
  let app;
  try {
    const content = Array.from({ length: 35 }, (_, i) => `第 ${i + 1} 项检查结果：这是一段用于验证长回复滚动与输入区域布局的演示内容。`).join('\n\n') + '\n\n```text\n' + 'long_code_identifier_'.repeat(80) + '\n```\n\n| ' + ['列一', '列二', '列三', '列四', '列五'].join(' | ') + ' |\n| --- | --- | --- | --- | --- |\n| ' + Array(5).fill('long_cell_'.repeat(20)).join(' | ') + ' |\n\n最后一行应完整可见。';
    await fs.writeFile(path.join(directory, 'workspace.json'), JSON.stringify({ tasks: [{ id: 'layout', title: '长回复布局测试', request: '请整理检查结果', created: new Date().toISOString(), materials: [], messages: [{ id: 'u', role: 'user', content: '请整理检查结果 ' + 'long_user_text_'.repeat(60) }, { id: 'a', role: 'assistant', content }] }], projects: [], models: [] }));
    app = await _electron.launch({ executablePath: path.resolve('apps/desktop/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'), args: [path.resolve('apps/desktop')], env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined, AILO_DATA_DIR: directory } });
    const page = await app.firstWindow();
    await page.getByRole('button', { name: '长回复布局测试', exact: true }).click();
    async function check() {
      const state = await page.evaluate(() => {
        const thread = document.querySelector('.thread'), composer = document.querySelector('.chat-compose');
        const a = thread.getBoundingClientRect(), b = composer.getBoundingClientRect();
        return { threadBottom: a.bottom, composerTop: b.top, composerBottom: b.bottom, height: innerHeight, threadHeight: a.height, scrolls: thread.scrollHeight > thread.clientHeight, horizontalOverflow: [...document.querySelectorAll('.conversation, .thread, .bubble, .assistant-text, .assistant-text pre, .assistant-table-scroll')].filter(element => element.scrollWidth > element.clientWidth + 1).map(element => ({className:element.className,width:element.clientWidth,scrollWidth:element.scrollWidth})) };
      });
      assert.ok(state.threadHeight > 40, JSON.stringify(state));
      assert.ok(state.threadBottom <= state.composerTop + 1, JSON.stringify(state));
      assert.ok(state.composerBottom <= state.height + 1, JSON.stringify(state));
      assert.ok(state.scrolls);
      assert.deepEqual(state.horizontalOverflow, [], JSON.stringify(state.horizontalOverflow));
      await page.locator('.thread').evaluate(element => { element.scrollTop = element.scrollHeight; });
      const end = await page.locator('.assistant-text').last().evaluate(element => element.getBoundingClientRect().bottom);
      const threadBottom = await page.locator('.thread').evaluate(element => element.getBoundingClientRect().bottom);
      assert.ok(end <= threadBottom + 1, 'Last reply line must be reachable above the composer');
    }
    for (const [width, height] of [[1200, 820], [900, 650], [760, 600]]) {
      await app.evaluate(({ BrowserWindow }, dimensions) => BrowserWindow.getAllWindows()[0].setSize(...dimensions), [width, height]);
      await page.waitForTimeout(100);
      await check();
      await page.getByRole('textbox', { name: '任务需求', exact: true }).evaluate(element => { element.style.height = '200px'; });
      await check();
      await page.getByRole('textbox', { name: '任务需求', exact: true }).evaluate(element => { element.style.height = ''; });
    }
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1200, 820));
    await page.getByRole('button', { name: '查看材料', exact: true }).click();
    await check();
    await page.getByRole('button', { name: '收起材料', exact: true }).click();
    await page.getByRole('textbox', { name: '任务需求', exact: true }).fill('/');
    await page.getByRole('listbox').waitFor();
    assert.ok(await page.getByRole('option').first().isVisible());
    await page.keyboard.press('Escape');
    await check();
    await page.screenshot({ path: '.local/composer-layout-fixed.png' });
    console.log('PASS: long replies remain separate from composer at 3 window sizes, expanded input, materials panel and shortcuts. Last line is fully reachable.');
  } finally { if (app) await app.close(); await fs.rm(directory, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });

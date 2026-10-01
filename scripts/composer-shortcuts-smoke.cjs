const { _electron } = require(process.env.PLAYWRIGHT_MODULE);
const fs = require('node:fs/promises'), path = require('node:path'), assert = require('node:assert/strict'), http = require('node:http');
(async () => {
  let app, payload;
  const server = http.createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    payload = JSON.parse(raw); res.setHeader('content-type', 'application/json');
    const context = JSON.parse(payload.messages.find(message => message.role === 'user').content);
    const action = context.phase === 'route' ? { action: 'route', kind: 'chat' }
      : !JSON.stringify(context.toolResults).includes('FILE_SHORTCUT_TOKEN') ? { action: 'read_material', id: context.materials[0].id, offset: 0 }
      : { action: 'reply', text: '快捷入口测试完成' };
    res.end(JSON.stringify({ choices: [{ message: { tool_calls: [{ id: 'test-action', type: 'function', function: { name: 'ailo_action', arguments: JSON.stringify(action) } }] } }] }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const dir = await fs.mkdtemp('/private/tmp/ailo-shortcuts-');
  const extensions = [
    { id: 'expert-a', kind: 'expert', name: '测试顾问', description: '分析需求', instructions: 'EXPERT_SHORTCUT_TOKEN', enabled: true },
    { id: 'expert-b', kind: 'expert', name: '另一顾问', description: '另一视角', instructions: 'OTHER_EXPERT_TOKEN', enabled: true },
    ...Array.from({ length: 6 }, (_, i) => ({ id: `skill-${i}`, kind: 'skill', name: `测试技能${i}`, description: '整理文件', instructions: `SKILL_SHORTCUT_TOKEN_${i}`, enabled: true })),
    { id: 'hidden', kind: 'skill', name: '停用技能', instructions: 'DISABLED_TOKEN', enabled: false },
  ];
  await fs.writeFile(path.join(dir, 'workspace.json'), JSON.stringify({ tasks: [], projects: [], extensions, models: [{ id: 'm', name: '本地测试', model: 'test', baseUrl: `http://127.0.0.1:${server.address().port}/v1` }], defaultModelId: 'm' }));
  try {
    app = await _electron.launch({ executablePath: path.resolve('apps/desktop/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'), args: [path.resolve('apps/desktop')], env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined, AILO_DATA_DIR: dir } });
    await app.evaluate(({ ipcMain }) => { ipcMain.removeHandler('materials:pick'); ipcMain.handle('materials:pick', () => [{ name: '需求.txt', text: 'FILE_SHORTCUT_TOKEN', size: 19 }]); });
    const page = await app.firstWindow();
    await page.getByText('本地记录已就绪').waitFor();
    const input = page.getByRole('textbox', { name: '任务需求', exact: true });
    await input.fill('/测试顾问'); await input.press('Enter');
    await page.getByTitle('移除测试顾问', { exact: true }).waitFor();
    assert.equal(await input.inputValue(), ''); assert.equal(payload, undefined);
    await input.fill('/另一顾问'); await input.press('Tab');
    assert.equal(await page.getByTitle('移除测试顾问', { exact: true }).count(), 0);
    await input.fill('/测试顾问'); await input.press('Enter');
    for (let i = 0; i < 5; i++) { await input.fill(`/测试技能${i}`); await input.press('Enter'); }
    await input.fill('/测试技能5'); assert.equal(await page.getByRole('option').getAttribute('aria-disabled'), 'true');
    await input.press('Enter'); assert.equal(await input.inputValue(), '/测试技能5');
    await input.fill('/停用技能'); assert.equal(await page.getByRole('option').count(), 0);
    await input.press('Enter'); assert.equal(payload, undefined);
    await input.fill('/'); await input.press('ArrowDown'); assert.equal(await page.getByRole('option').nth(1).getAttribute('aria-selected'), 'true');
    await input.press('Escape'); assert.equal(await page.getByRole('listbox').count(), 0);
    for (const text of ['a@example.com', 'https://example.com/test', '/tmp/file']) { await input.fill(text); assert.equal(await page.getByRole('listbox').count(), 0); }
    await input.fill('/测试');
    await input.dispatchEvent('compositionstart'); await input.press('Enter'); assert.equal(payload, undefined);
    await input.dispatchEvent('compositionend');
    await input.fill('@'); await page.getByText('当前对话中暂无文件', { exact: true }).waitFor();
    assert.equal(await page.getByRole('option').count(), 0);
    await input.press('Enter'); assert.equal(payload, undefined); assert.equal(await input.inputValue(), '@');
    await input.press('Escape');
    await page.getByRole('button', { name: '添加文件、项目、专家、技能或应用连接', exact: true }).click();
    await page.getByRole('button', { name: /添加文件/ }).filter({ has: page.locator('.composer-add-chevron') }).click();
    await page.locator('.attachments button').filter({ hasText: '需求.txt' }).waitFor();
    await input.fill('@不存在'); await page.getByText('当前对话中没有匹配的文件', { exact: true }).waitFor();
    await input.fill('@需求'); await input.press('Enter'); assert.equal(await page.locator('.attachments button').count(), 1);
    await input.fill('/测试'); await page.screenshot({ path: '.local/composer-shortcuts.png' });
    await input.press('Escape'); await input.fill('请分析文件'); await input.press('Shift+Enter'); assert.equal(payload, undefined);
    await input.press('Enter'); await page.getByText('快捷入口测试完成', { exact: true }).waitFor();
    const request = JSON.stringify(payload);
    assert.ok(request.includes('EXPERT_SHORTCUT_TOKEN')); assert.ok(request.includes('SKILL_SHORTCUT_TOKEN_0')); assert.ok(request.includes('FILE_SHORTCUT_TOKEN'));
    assert.ok(!request.includes('OTHER_EXPERT_TOKEN')); assert.ok(!request.includes('DISABLED_TOKEN'));
    await input.fill('@需求'); await page.getByRole('option', { name: /需求.txt/ }).click();
    assert.equal(await page.locator('.attachments button').count(), 1);
    console.log('PASS: keyboard selection, expert replacement, skill limit, disabled extensions, IME, Escape, URL/email boundaries, local files, deduplication, conversation references and model request content.');
  } finally { if (app) await app.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });

// Capture real UI using an isolated workspace with synthetic data only.
const { _electron } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
(async () => {
  const root = path.resolve(__dirname, '..');
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ailo-readme-'));
  const output = path.join(root, 'docs', 'images');
  let app;
  try {
    await fs.mkdir(output, { recursive: true });
    await fs.writeFile(path.join(directory, 'workspace.json'), JSON.stringify({
      tasks: [
        { id: 'demo-outline', title: '整理产品需求与验收清单', request: '整理产品需求与验收清单', projectId: 'demo-product', materials: [], created: '2026-10-02T02:00:00.000Z', messages: [] },
        ...[2,1].map(day => ({ id: 'demo-run-'+day, title: '定时 · 每天学一点 AI', request: '整理一个 AI 架构知识点', materials: [], modelId: 'demo', created: `2026-10-0${day}T01:00:00.000Z`, scheduledTaskId: 'demo-learning', scheduledRunId: 'run-'+day, scheduledAt: `2026-10-0${day}T01:00:00.000Z`, messages: [{ id: 'reply-'+day, role: 'assistant', content: day===2 ? '今天的知识点：检索增强生成（RAG）\n\n先检索相关资料，再让模型结合资料回答。适合知识库问答、材料分析和企业内部助手。\n\n实践建议：先用一份小型知识库验证检索质量，再增加资料规模。' : '今天的知识点：工具调用\n\n模型选择工具与参数，应用负责执行，并将结果返回给模型。清晰的工具边界能让任务更容易验证。' }] }))
      ], projects: [{ id: 'demo-product', name: '产品想法', pinned: true, description: '把产品想法整理为可验证的需求，优先明确用户场景和验收标准。' }, { id: 'demo-research', name: '研究与写作' }], models: [{ id: 'demo', name: '演示模型', model: 'demo', baseUrl: 'https://example.com/v1' }], defaultModelId: 'demo',
    }));
    await fs.writeFile(path.join(directory, 'scheduled-tasks.json'), JSON.stringify([
      { id: 'demo-learning', title: '每天学一点 AI', prompt: '每天整理一个 AI 架构知识点，说明原理、应用场景和实践建议。', frequency: 'daily', time: '09:00', modelId: 'demo', enabled: true, nextAt: '2099-10-03T01:00:00.000Z', searchEnabled: true, runs: [2,1].map(day=>({id:'run-'+day, taskId:'demo-run-'+day, at:`2026-10-0${day}T01:00:00.000Z`, status:'completed'})) },
      { id: 'demo-review', title: '晚间复盘提醒', prompt: '用三个问题帮助我回顾今天的收获和明天的重点。', frequency: 'daily', time: '21:00', modelId: 'demo', enabled: true, nextAt: '2099-10-02T13:00:00.000Z', runs: [] }
    ]));
    const installed = path.join(root, 'apps/desktop/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
    const executable = await fs.access(installed).then(()=>installed).catch(()=>path.join(root,'.local/my-ailo-electron/Electron.app/Contents/MacOS/Electron'));
    app = await _electron.launch({
      executablePath: process.env.ELECTRON_PATH || executable,
      args: [path.join(root, 'apps/desktop')],
      env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined, AILO_DATA_DIR: directory },
    });
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1200, 820));
    const page = await app.firstWindow();
    await page.waitForFunction(()=>document.querySelector('.sidebar .new')&&!document.querySelector('.sidebar .new').disabled);
    await page.screenshot({ path: path.join(output, 'home.png'), animations: 'disabled', scale: 'css' });
    await page.getByRole('button', { name: '新的对话', exact: true }).click();
    const input = page.getByRole('textbox', { name: '任务需求', exact: true });
    await input.fill('/');
    await page.getByRole('listbox', { name: '专家和技能快捷选择' }).waitFor();
    await page.screenshot({ path: path.join(output, 'shortcuts.png'), animations: 'disabled', scale: 'css' });
    await input.press('Escape');
    await page.getByRole('button', { name: '扩展', exact: true }).click();
    await page.getByRole('heading', { name: '产品经理', exact: true }).waitFor();
    await page.screenshot({ path: path.join(output, 'extensions.png'), animations: 'disabled', scale: 'css' });
    await page.getByRole('button', { name: '定时任务', exact: true }).click();
    await page.locator('.schedule-list-item').filter({hasText:'每天学一点 AI'}).click();
    await page.locator('.schedule-latest .assistant-text').waitFor();
    await page.screenshot({ path: path.join(output, 'schedules.png'), animations: 'disabled', scale: 'css' });
    await page.getByRole('button', { name: '打开记录，继续讨论 ↗', exact: true }).click();
    await page.getByRole('button', { name: '历史记录', exact: true }).click();
    await page.locator('.schedule-history-focus .schedule-history-result .assistant-text').waitFor();
    await page.screenshot({ path: path.join(output, 'schedule-history.png'), animations: 'disabled', scale: 'css' });
    await page.getByRole('button', { name: '查看任务详情 ↗', exact: true }).click();
    await page.getByRole('button', { name: '编辑', exact: true }).click();
    await page.getByLabel('允许连接飞书', {exact:true}).waitFor();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1200, 1040));
    await page.screenshot({ path: path.join(output, 'schedule-settings.png'), animations: 'disabled', scale: 'css' });
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1200, 820));
    await page.locator('.project-nav-name').filter({hasText:'产品想法'}).click();
    await page.getByRole('heading', {name:'产品想法',exact:true}).waitFor();
    await page.getByRole('button', { name: '产品想法 项目操作', exact: true }).click();
    await page.getByRole('button', { name: '取消置顶', exact: true }).waitFor();
    await page.screenshot({ path: path.join(output, 'project-menu.png'), animations: 'disabled', scale: 'css' });
    console.log('Saved 7 README screenshots from an isolated demo workspace.');
  } finally {
    if (app) await app.close();
    await fs.rm(directory, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });

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
      tasks: [], projects: [{ id: 'demo-research', name: '研究与写作' }, { id: 'demo-product', name: '产品想法' }], models: [], defaultModelId: 'demo',
    }));
    app = await _electron.launch({
      executablePath: path.join(root, 'apps/desktop/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'),
      args: [path.join(root, 'apps/desktop')],
      env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined, AILO_DATA_DIR: directory },
    });
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1200, 820));
    const page = await app.firstWindow();
    await page.getByText('本地记录已就绪', { exact: true }).waitFor();
    await page.screenshot({ path: path.join(output, 'home.png'), animations: 'disabled', scale: 'css' });
    const input = page.getByRole('textbox', { name: '任务需求', exact: true });
    await input.fill('/');
    await page.getByRole('listbox', { name: '专家和技能快捷选择' }).waitFor();
    await page.screenshot({ path: path.join(output, 'shortcuts.png'), animations: 'disabled', scale: 'css' });
    await input.press('Escape');
    await page.getByRole('button', { name: '扩展', exact: true }).click();
    await page.getByRole('heading', { name: '产品经理', exact: true }).waitFor();
    await page.screenshot({ path: path.join(output, 'extensions.png'), animations: 'disabled', scale: 'css' });
    console.log('Saved 3 README screenshots from an isolated demo workspace.');
  } finally {
    if (app) await app.close();
    await fs.rm(directory, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });

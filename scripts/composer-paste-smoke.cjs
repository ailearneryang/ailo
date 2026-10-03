const { _electron } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs/promises'), path = require('node:path'), assert = require('node:assert/strict');
(async () => {
  let app;
  const dir = await fs.mkdtemp('/private/tmp/ailo-paste-smoke-');
  try {
    app = await _electron.launch({ executablePath: process.env.ELECTRON_EXECUTABLE || path.resolve('apps/desktop/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'), args: [path.resolve('apps/desktop')], env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined, AILO_DATA_DIR: dir } });
    const page = await app.firstWindow();
    await page.getByText('本地记录已就绪').waitFor();
    const input = page.getByRole('textbox', { name: '任务需求', exact: true });
    await input.fill('原有文字');
    await app.evaluate(({ clipboard }) => clipboard.writeText('普通文字'));
    await input.press('Meta+V');
    assert.equal(await input.inputValue(), '原有文字普通文字');
    await input.evaluate(el => {
      const data = new DataTransfer();
      data.items.add(new File(['PASTE_FILE_TOKEN'], '粘贴需求.txt', { type: 'text/plain' }));
      data.items.add(new File(['# 第二份材料'], '第二份.md', { type: 'text/markdown' }));
      const event = new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true });
      el.dispatchEvent(event);
      if (!event.defaultPrevented) throw Error('文件粘贴未被处理');
    });
    await page.locator('.attachments button').filter({ hasText: '粘贴需求.txt' }).waitFor();
    assert.equal(await page.locator('.attachments button').count(), 2);
    assert.equal(await input.inputValue(), '原有文字普通文字');
    await app.evaluate(({ clipboard, nativeImage }) => clipboard.writeImage(nativeImage.createFromDataURL('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=')));
    await input.press('Meta+V');
    await page.waitForFunction(() => document.querySelectorAll('.attachments button').length === 3);
    // Resolve the agent directory from the persisted imports rather than assuming its name.
    async function importedFiles(folder) {
      let found = [];
      for (const entry of await fs.readdir(folder, { withFileTypes: true })) {
        const file = path.join(folder, entry.name);
        if (entry.isDirectory()) found.push(...await importedFiles(file));
        else if (path.basename(folder) === 'imports') found.push(file);
      }
      return found;
    }
    const sources = await importedFiles(dir);
    assert.equal(sources.length, 3);
    assert.ok((await Promise.all(sources.map(file => fs.readFile(file)))).some(bytes => bytes.toString() === 'PASTE_FILE_TOKEN'));
    console.log('PASS: ordinary text paste, multiple file paste, native Command+V image paste, original input preserved and source bytes persisted.');
  } finally { if (app) await app.close(); await fs.rm(dir, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });

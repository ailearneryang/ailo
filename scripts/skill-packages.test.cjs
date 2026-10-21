const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const JSZip = require('../apps/desktop/node_modules/jszip');
const { createSkillPackages, LIMITS } = require('../apps/desktop/skill-packages.cjs');
const { createStorage } = require('../apps/desktop/storage.cjs');
const { createWorkspace } = require('../apps/desktop/agent/workspace.cjs');
const { runAgent } = require('../apps/desktop/agent/runner.cjs');
const { createChat } = require('../apps/desktop/chat.cjs');
const { execute } = require('../apps/desktop/agent/tools.cjs');
const markdown = '---\nname: zip-skill\ndescription: >\n  使用引用材料\n  生成工作结果\n---\n先读取 references/guide.md，再使用模板。';
async function setup(t) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'ailo-skill-packages-'));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const root = path.join(base, 'packages');
  return { base, root, manager: createSkillPackages(root) };
}
async function zip(entries, options = {}) {
  const archive = new JSZip();
  for (const [name, content, entryOptions] of entries) archive.file(name, content, { createFolders: false, ...entryOptions });
  return archive.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', platform: 'UNIX', ...options });
}
const importZip = (manager, buffer) => manager.importSkill({ name: 'workflow.zip', buffer });
test('Markdown import keeps editable instructions, BOM, CRLF and folded metadata', async t => {
  const { manager } = await setup(t);
  const skill = await manager.importSkill({ name: 'SKILL.md', buffer: Buffer.from('\uFEFF' + markdown.replaceAll('\n', '\r\n')) });
  assert.equal(skill.name, 'zip-skill'); assert.equal(skill.description, '使用引用材料 生成工作结果');
  assert.equal(skill.instructions, '先读取 references/guide.md，再使用模板。'); assert.equal(skill.package, undefined);
  await assert.rejects(manager.importSkill({ name: 'SKILL.md', buffer: Buffer.from([0xff]) }), /UTF-8/);
  await assert.rejects(manager.importSkill({ name: 'SKILL.md', buffer: Buffer.from('\0') }), /二进制/);
  await assert.rejects(manager.importSkill({ name: 'SKILL.md', buffer: Buffer.from('x'.repeat(20001)) }), /20000/);
  await assert.rejects(manager.importSkill({ name: 'a.exe', buffer: Buffer.from('a') }), /请选择/);
});
test('wrapped ZIP preserves references, templates, binaries and scripts without executing them', async t => {
  const { manager, base, root } = await setup(t);
  const binary = Buffer.from([0, 1, 2, 254, 255]);
  const archive = await zip([['my-skill/SKILL.md', markdown], ['my-skill/references/guide.md', 'RESOURCE_ONLY_ON_DEMAND'], ['my-skill/templates/sample.bin', binary], ['my-skill/scripts/example.sh', '#!/bin/sh\necho should-not-run\n', { unixPermissions: 0o100755 }], ['__MACOSX/._SKILL.md', 'ignore'], ['my-skill/.DS_Store', 'ignore']]);
  const item = await importZip(manager, archive);
  assert.equal(item.package.files, 4);
  assert.deepEqual(await fs.readFile(path.join(root, item.package.id, 'files/templates/sample.bin')), binary);
  assert.equal((await fs.stat(path.join(root, item.package.id, 'files/scripts/example.sh'))).mode & 0o777, 0o700);
  const workspace = { files: path.join(base, 'project') }; await fs.mkdir(workspace.files);
  const [loaded] = await manager.prepare(workspace, [{ ...item, instructions: 'EDITED_INSTRUCTIONS' }]);
  assert.match(loaded.instructions, /^EDITED_INSTRUCTIONS/);
  assert.ok(!loaded.instructions.includes('RESOURCE_ONLY_ON_DEMAND'));
  assert.equal((await execute(workspace, { action: 'read_file', path: `.runtime/ailo-skills/${item.package.id}/references/guide.md` })).text, 'RESOURCE_ONLY_ON_DEMAND');
  assert.deepEqual(await fs.readFile(path.join(workspace.files, '.runtime/ailo-skills', item.package.id, 'templates/sample.bin')), binary);
  assert.equal((await fs.readdir(workspace.files)).length, 1);
});
test('root SKILL.md and a single enclosing folder work; unrelated sibling files are excluded', async t => {
  const { manager, root } = await setup(t);
  const rootItem = await importZip(manager, await zip([['SKILL.md', 'root instructions'], ['references/example/SKILL.md', 'nested example']]));
  assert.equal(rootItem.name, 'workflow'); assert.equal(rootItem.package.files, 2);
  const wrapped = await importZip(manager, await zip([['wrapper/SKILL.md', 'wrapped'], ['outside.txt', 'not in skill']]));
  assert.equal(wrapped.name, 'wrapper'); assert.equal(wrapped.package.files, 1);
  assert.deepEqual(await fs.readdir(path.join(root, wrapped.package.id, 'files')), ['SKILL.md']);
  await assert.rejects(importZip(manager, await zip([['README.md', 'not skill']])), /未找到 SKILL.md/);
  await assert.rejects(importZip(manager, await zip([['a/SKILL.md', 'a'], ['b/SKILL.md', 'b']])), /多个技能/);
  await assert.rejects(importZip(manager, Buffer.from('not zip')), /无法读取/);
});
test('archive traversal, absolute paths, backslashes, links and case collisions are rejected without writes', async t => {
  const { manager, root } = await setup(t);
  const cases = [
    ['../escape.txt', 'x'], ['/escape.txt', 'x'], ['C:/escape.txt', 'x'], ['a\\escape.txt', 'x'],
    ['references/link', 'target', { unixPermissions: 0o120777 }], ['a/../escape.txt', 'x'],
  ];
  for (const entry of cases) await assert.rejects(importZip(manager, await zip([['SKILL.md', markdown], entry])));
  await assert.rejects(importZip(manager, await zip([['SKILL.md', markdown], ['REF.md', 'a'], ['ref.md', 'b']])), /重复/);
  await assert.rejects(importZip(manager, await zip([['SKILL.md', markdown], ['a', 'a'], ['a/b', 'b']])), /冲突/);
  await assert.rejects(importZip(manager, await zip([['SKILL.md', markdown], ['a/b', 'b'], ['a', 'a']])), /冲突/);
  await assert.rejects(fs.access(root), { code: 'ENOENT' });
});
test('encrypted, truncated and checksum-damaged ZIP entries are rejected', async t => {
  const { manager } = await setup(t);
  const original = await zip([['SKILL.md', markdown]], { compression: 'STORE' });
  const encrypted = await zip([['SKILL.md', markdown]]), central = encrypted.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  encrypted.writeUInt16LE(encrypted.readUInt16LE(central + 8) | 1, central + 8);
  await assert.rejects(importZip(manager, encrypted), /解密/);
  const damaged = Buffer.from(original); damaged[30 + Buffer.byteLength('SKILL.md')] ^= 1;
  await assert.rejects(importZip(manager, damaged), /校验失败/);
  await assert.rejects(importZip(manager, original.subarray(0, original.length - 30)), /无法读取/);
});
test('compressed upload, uncompressed file, Markdown and entry count limits are enforced', async t => {
  const { manager } = await setup(t);
  await assert.rejects(importZip(manager, Buffer.alloc(LIMITS.archive + 1)), /20 MB/);
  await assert.rejects(manager.importSkill({ name: 'SKILL.md', buffer: Buffer.alloc(LIMITS.markdown + 1) }), /80 KB/);
  const archive = await zip([['SKILL.md', markdown], ['large.bin', 'small']]);
  const central = archive.lastIndexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  archive.writeUInt32LE(LIMITS.file + 1, central + 24);
  await assert.rejects(importZip(manager, archive), /解压内容过大/);
  await assert.rejects(importZip(manager, await zip([['SKILL.md', markdown], ...Array.from({ length: 1000 }, (_, i) => [`refs/${i}.txt`, ''])])), /1000/);
});
test('package persistence survives restart and edited instructions; arbitrary package IDs cannot be saved', async t => {
  const { base } = await setup(t), storage = createStorage(base, {});
  const item = await importZip(storage.skillPackages, await zip([['SKILL.md', markdown], ['references/guide.md', 'reference']]));
  await storage.saveWorkspace({ ...(await storage.readWorkspace()), extensions: [{ ...item, instructions: 'EDITED' }] });
  const restarted = createStorage(base, {}), state = await restarted.readWorkspace();
  assert.deepEqual(state.extensions[0].package, item.package); assert.equal(state.extensions[0].instructions, 'EDITED');
  await assert.rejects(restarted.saveWorkspace({ ...state, extensions: [{ ...item, id: 'forged', package: { id: 'f'.repeat(64), files: 1 } }] }), /缺失或损坏/);
  await assert.rejects(restarted.saveWorkspace({ ...state, extensions: [{ ...item, package: { id: '../outside', files: 1 } }] }), /配置无效/);
  await fs.rm(path.join(base, 'skill-packages', item.package.id), { recursive: true });
  await restarted.saveWorkspace({ ...state, extensions: state.extensions.map(e => ({ ...e, enabled: false })) });
  assert.equal((await restarted.readWorkspace()).extensions[0].enabled, false);
  const repaired = await importZip(restarted.skillPackages, await zip([['SKILL.md', markdown]]));
  assert.notEqual(repaired.package.id, item.package.id);
});
test('selection changes clear owned mounted resources and never touch an unowned directory or symlink', async t => {
  const { manager, base } = await setup(t);
  const item = await importZip(manager, await zip([['SKILL.md', markdown]]));
  const workspace = { files: path.join(base, 'project') }; await fs.mkdir(workspace.files);
  await manager.prepare(workspace, [item]);
  await manager.prepare(workspace, [{ ...item, enabled: false }]);
  assert.deepEqual(await fs.readdir(path.join(workspace.files, '.runtime/ailo-skills')), ['.ailo-owned']);
  await fs.rm(path.join(workspace.files, '.runtime/ailo-skills/.ailo-owned'));
  await fs.writeFile(path.join(workspace.files, '.runtime/ailo-skills/user-file'), 'keep');
  await assert.rejects(manager.prepare(workspace, []), /冲突/);
  assert.equal(await fs.readFile(path.join(workspace.files, '.runtime/ailo-skills/user-file'), 'utf8'), 'keep');
  const other = { files: path.join(base, 'other') }; await fs.mkdir(other.files);
  await fs.symlink(workspace.files, path.join(other.files, '.runtime'));
  await assert.rejects(manager.prepare(other, [item]), /符号链接/);
});
test('corrupted or linked package files are refused before replacing mounted resources', async t => {
  const { manager, base, root } = await setup(t);
  const item = await importZip(manager, await zip([['SKILL.md', markdown], ['ref.txt', 'original']]));
  const workspace = { files: path.join(base, 'project') }; await fs.mkdir(workspace.files);
  await manager.prepare(workspace, [item]);
  const source = path.join(root, item.package.id, 'files/ref.txt');
  await fs.writeFile(source, 'modified');
  await assert.rejects(manager.prepare(workspace, [item]), /损坏/);
  assert.equal(await fs.readFile(path.join(workspace.files, '.runtime/ailo-skills', item.package.id, 'ref.txt'), 'utf8'), 'original');
  await fs.rm(source); await fs.symlink(path.join(root, item.package.id, 'files/SKILL.md'), source);
  await assert.rejects(manager.prepare(workspace, [item]), /符号链接/);
});
test('agent model receives resource paths and can read a selected ZIP reference on demand', async t => {
  const { manager, base } = await setup(t);
  const item = await importZip(manager, await zip([['SKILL.md', markdown], ['references/guide.md', 'COMPLETE_REFERENCE']]));
  const resource = `.runtime/ailo-skills/${item.package.id}/references/guide.md`;
  const task = { id: 'skill-task', projectId: 'skill-project', request: '使用技能材料', messages: [{ role: 'user', content: '使用技能材料' }] };
  let turn = 0;
  const result = await runAgent({ base: path.join(base, 'agent'), task, model: { contextWindow: 32768 }, extensions: [item], skillPackages: manager, signal: new AbortController().signal,
    ask: async messages => {
      assert.match(messages[0].content, /\.runtime\/ailo-skills/);
      assert.ok(!messages[0].content.includes('COMPLETE_REFERENCE'));
      const state = JSON.parse(messages.at(-1).content);
      const actions = [{ action: 'route', kind: 'task' }, { action: 'read_file', path: resource }];
      if (turn >= 2) { assert.ok(JSON.stringify(state.toolResults).includes('COMPLETE_REFERENCE')); return { content: JSON.stringify({ action: 'pause', text: '已读取技能引用材料' }) }; }
      return { content: JSON.stringify(actions[turn++]) };
    } });
  assert.match(result.content, /已读取/);
  const workspace = await createWorkspace(path.join(base, 'agent'), task);
  assert.equal((await execute(workspace, { action: 'list_files', path: `.runtime/ailo-skills/${item.package.id}/references` }))[0].name, resource);
});
test('chat main-process path loads ZIP resources only for the explicitly selected skill', async t => {
  const { base } = await setup(t), storage = createStorage(base, {});
  storage.agentDirectory = path.join(base, 'agent');
  const item = await importZip(storage.skillPackages, await zip([['SKILL.md', markdown], ['ref.md', 'CHAT_RESOURCE']]));
  const task = { id: 'chat-skill', title: '使用技能', request: '读取技能材料', created: new Date().toISOString(), materials: [], messages: [{ id: 'user', role: 'user', content: '读取技能材料' }] };
  await storage.saveWorkspace({ ...(await storage.readWorkspace()), extensions: [item], tasks: [task], models: [{ id: 'm', name: '测试模型', model: 'test', baseUrl: 'https://example.com/v1', contextWindow: 32768 }] });
  let turn = 0;
  const chat = createChat(storage, async (_url, options) => {
    const payload = JSON.parse(options.body);
    assert.match(payload.messages[0].content, /技能配套文件根目录/);
    const action = turn++ ? { action: 'pause', text: '技能已加载' } : { action: 'route', kind: 'task' };
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(action) } }] }));
  });
  await chat.complete({ id: 'request', taskId: task.id, modelId: 'm', extensionIds: [item.id], messages: task.messages });
  const workspace = await createWorkspace(storage.agentDirectory, task);
  assert.equal((await execute(workspace, { action: 'read_file', path: `.runtime/ailo-skills/${item.package.id}/ref.md` })).text, 'CHAT_RESOURCE');
  // A normal chat response after route may use plain prose. Avoid a route loop.
  let plainTurn = 0;
  const withoutSkill = createChat(storage, async (_url, options) => {
    assert.ok(!JSON.parse(options.body).messages[0].content.includes('技能配套文件根目录'));
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(plainTurn++ ? { action: 'reply', text: '普通对话' } : { action: 'route', kind: 'chat' }) } }] }));
  });
  await withoutSkill.complete({ id: 'plain-request', taskId: task.id, modelId: 'm', messages: task.messages });
  await assert.rejects(fs.access(path.join(workspace.files, '.runtime/ailo-skills', item.package.id)), { code: 'ENOENT' });
});
test('deleting an imported skill persists and clears selections while retaining conversation history', async t => {
  const { base } = await setup(t), storage = createStorage(base, {});
  const item = await importZip(storage.skillPackages, await zip([['SKILL.md', markdown]]));
  const task = { id: 'delete-skill', request: '保留历史', materials: [], extensionIds: [item.id], messages: [{role:'user',content:'保留历史'}] };
  await storage.saveWorkspace({ ...(await storage.readWorkspace()), extensions: [item], projects: [{id:'project',name:'项目',extensionIds:[item.id]}], tasks: [task] });
  const before = await storage.readWorkspace();
  await storage.saveWorkspace({...before, extensions: []});
  const state = await createStorage(base, {}).readWorkspace();
  assert.deepEqual(state.extensions, []);
  assert.deepEqual(state.projects[0].extensionIds, []);
  assert.deepEqual(state.tasks[0].extensionIds, []);
  assert.deepEqual(state.tasks[0].messages, task.messages);
});

const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const yauzl = require('yauzl');
const { resolveFile } = require('./agent/workspace.cjs');

const LIMITS = { archive: 20 * 1024 * 1024, total: 50 * 1024 * 1024, file: 10 * 1024 * 1024, entries: 1000, markdown: 80000 };
const digest = data => createHash('sha256').update(data).digest('hex');
const packageId = id => typeof id === 'string' && /^[a-f0-9]{64}$/.test(id);
const OWNED = 'Ailo skill resources v1';
const crcTable = Uint32Array.from({ length: 256 }, (_, n) => { for (let i = 0; i < 8; i++) n = (n & 1) ? 0xedb88320 ^ (n >>> 1) : n >>> 1; return n >>> 0; });
function crc32(data) { let value = 0xffffffff; for (const byte of data) value = crcTable[(value ^ byte) & 255] ^ (value >>> 8); return (value ^ 0xffffffff) >>> 0; }
function safePath(value, directory = false) {
  const name = directory ? value.replace(/\/$/, '') : value;
  if (typeof name !== 'string' || !name || name.length > 500 || /^[A-Za-z]:/.test(name) || /[\\\x00-\x1f\x7f]/.test(name) || name.split('/').some(p => !p || p === '.' || p === '..')) throw Error('技能 ZIP 包含不安全的文件路径。');
  return name;
}
function parseMarkdown(buffer, fallback) {
  if (buffer.length > LIMITS.markdown) throw Error('SKILL.md 不能超过 80 KB。');
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(buffer).replace(/^\uFEFF/, ''); }
  catch { throw Error('请使用 UTF-8 编码的 SKILL.md。'); }
  if (text.includes('\0')) throw Error('SKILL.md 不能包含二进制内容。');
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  const metadata = match?.[1] || '';
  function field(name) {
    const lines = metadata.split(/\r?\n/), index = lines.findIndex(line => line.startsWith(name + ':'));
    if (index < 0) return '';
    const value = lines[index].slice(name.length + 1).trim();
    if (/^[>|][-+]?\s*$/.test(value)) {
      const body = [];
      for (const line of lines.slice(index + 1)) { if (line && !/^\s/.test(line)) break; body.push(line.trim()); }
      return body.join(value[0] === '>' ? ' ' : '\n').trim();
    }
    return value.replace(/^(['"])([\s\S]*)\1$/, '$2');
  }
  const instructions = text.slice(match?.[0].length || 0).trim();
  if (!instructions || instructions.length > 20000) throw Error('技能正文需要包含 1–20000 个字符。');
  return { id: randomUUID(), kind: 'skill', name: (field('display_name') || field('name') || fallback).slice(0, 60), description: field('description').slice(0, 300), instructions, enabled: true };
}
function unpack(buffer) {
  return new Promise((resolve, reject) => {
    let zip, ended = false, total = 0, count = 0;
    const files = [], names = new Set(), fileNames = new Set();
    const timer = setTimeout(() => finish(Error('技能 ZIP 解压超时，请检查压缩包。')), 15000);
    function finish(error) { if (ended) return; ended = true; clearTimeout(timer); zip?.close(); error ? reject(error) : resolve(files); }
    yauzl.fromBuffer(buffer, { lazyEntries: true, strictFileNames: true, validateEntrySizes: true }, (error, opened) => {
      if (error) return finish(Error('无法读取技能 ZIP：' + error.message));
      zip = opened;
      if (ended) return zip.close();
      zip.on('error', e => finish(Error('无法读取技能 ZIP：' + e.message)));
      zip.on('end', () => finish());
      zip.on('entry', async entry => {
        try {
          const directory = entry.fileName.endsWith('/'), name = safePath(entry.fileName, directory), lower = name.toLowerCase();
          if (++count > LIMITS.entries) throw Error('技能 ZIP 最多包含 1000 个条目。');
          const mode = entry.externalFileAttributes >>> 16, type = mode & 0xf000;
          if (type && type !== (directory ? 0x4000 : 0x8000)) throw Error('技能 ZIP 不支持符号链接或特殊文件。');
          if (entry.generalPurposeBitFlag & 1) throw Error('请先解密技能 ZIP，再导入。');
          if (names.has(lower) || lower.split('/').slice(0, -1).some((_, i, parts) => fileNames.has(parts.slice(0, i + 1).join('/'))) || (!directory && [...names].some(n => n.startsWith(lower + '/')))) throw Error('技能 ZIP 包含重复或冲突的文件路径。');
          names.add(lower); if (!directory) fileNames.add(lower);
          if (entry.uncompressedSize > LIMITS.file || total + entry.uncompressedSize > LIMITS.total) throw Error('技能 ZIP 解压内容过大（单文件最多 10 MB，总计 50 MB）。');
          total += entry.uncompressedSize;
          if (directory || name.split('/').some(p => p === '__MACOSX' || p === '.DS_Store')) { zip.readEntry(); return; }
          const stream = await new Promise((resolveStream, rejectStream) => zip.openReadStream(entry, (e, s) => e ? rejectStream(e) : resolveStream(s)));
          const chunks = []; let size = 0;
          for await (const chunk of stream) { size += chunk.length; if (ended || size > LIMITS.file || size > entry.uncompressedSize) { stream.destroy(); throw Error('技能 ZIP 文件大小无效。'); } chunks.push(chunk); }
          if (size !== entry.uncompressedSize) throw Error('技能 ZIP 文件不完整。');
          const data = Buffer.concat(chunks);
          if (crc32(data) !== entry.crc32) throw Error('技能 ZIP 校验失败，文件可能已损坏。');
          files.push({ path: name, data, executable: !!(mode & 0o111) });
          if (!ended) zip.readEntry();
        } catch (e) { finish(e); }
      });
      zip.readEntry();
    });
  });
}

function createSkillPackages(root) {
  async function manifest(id) {
    if (!packageId(id)) throw Error('技能包标识无效，请重新导入。');
    try {
      const file = await resolveFile(root, id + '/manifest.json');
      const data = JSON.parse(await fs.readFile(file, 'utf8'));
      if (data.id !== id || !Array.isArray(data.files) || !data.files.length || data.files.length > LIMITS.entries) throw Error('manifest');
      const names = new Set(); let total = 0;
      for (const f of data.files) {
        safePath(f.path);
        if (names.has(f.path.toLowerCase()) || !packageId(f.sha256) || !Number.isSafeInteger(f.size) || f.size < 0 || f.size > LIMITS.file || typeof f.executable !== 'boolean') throw Error('manifest');
        names.add(f.path.toLowerCase()); total += f.size;
      }
      if (total > LIMITS.total || !names.has('skill.md')) throw Error('manifest');
      return data;
    } catch { throw Error('技能包已缺失或损坏，请重新导入 ZIP。'); }
  }
  async function importSkill(input) {
    if (!input || typeof input.name !== 'string' || !input.name || input.name.length > 255 || !/\.(md|zip)$/i.test(input.name) || !(input.buffer instanceof ArrayBuffer || ArrayBuffer.isView(input.buffer))) throw Error('请选择 SKILL.md、Markdown 或 ZIP 技能包。');
    const max = /\.zip$/i.test(input.name) ? LIMITS.archive : LIMITS.markdown;
    if (!input.buffer.byteLength || input.buffer.byteLength > max) throw Error(/\.zip$/i.test(input.name) ? '技能 ZIP 不能超过 20 MB。' : 'SKILL.md 不能超过 80 KB。');
    const buffer = input.buffer instanceof ArrayBuffer ? Buffer.from(input.buffer) : Buffer.from(input.buffer.buffer, input.buffer.byteOffset, input.buffer.byteLength);
    const fallback = path.basename(input.name).replace(/\.(md|zip)$/i, '');
    if (/\.md$/i.test(input.name)) return parseMarkdown(buffer, fallback);
    const all = await unpack(buffer);
    const candidates = all.filter(f => /(^|\/)SKILL\.md$/i.test(f.path)).sort((a, b) => a.path.split('/').length - b.path.split('/').length);
    if (!candidates.length) throw Error('技能 ZIP 中未找到 SKILL.md。');
    const entry = candidates[0];
    if (candidates[1]?.path.split('/').length === entry.path.split('/').length) throw Error('ZIP 中有多个技能，请将每个技能分别打包导入。');
    const prefix = entry.path.slice(0, -path.posix.basename(entry.path).length);
    const files = all.filter(f => f.path.startsWith(prefix)).map(f => ({ ...f, path: f.path.slice(prefix.length) }));
    const skill = parseMarkdown(entry.data, prefix ? prefix.split('/').filter(Boolean).at(-1) : fallback);
    // Each import can repair a missing/damaged prior package without replacing
    // files used by an already running task.
    const id = digest(Buffer.concat([buffer, Buffer.from(randomUUID())]));
    await fs.mkdir(root, { recursive: true, mode: 0o700 });
    const temp = await fs.mkdtemp(path.join(root, '.import-'));
    try {
      for (const file of files) {
        const target = await resolveFile(temp, 'files/' + file.path, true);
        await fs.writeFile(target, file.data, { mode: file.executable ? 0o700 : 0o600, flag: 'wx' });
      }
      await fs.writeFile(path.join(temp, 'manifest.json'), JSON.stringify({ id, files: files.map(f => ({ path: f.path, size: f.data.length, sha256: digest(f.data), executable: f.executable })) }), { mode: 0o600 });
      await fs.rename(temp, path.join(root, id));
    } finally { await fs.rm(temp, { recursive: true, force: true }); }
    return { ...skill, package: { id, files: files.length } };
  }
  async function validate(items, previous = []) {
    for (const item of items) if (item.package) {
      const known = previous.find(e => e.id === item.id && e.package?.id === item.package.id);
      if (known) { item.package = { id: known.package.id, files: known.package.files }; continue; }
      const saved = await manifest(item.package.id);
      item.package = { id: saved.id, files: saved.files.length };
    }
    return items;
  }
  async function prepare(workspace, items) {
    // Only our marked cache can be replaced. Resolve every path before touching
    // a project, including restored projects containing symlinks.
    const relative = '.runtime/ailo-skills';
    const marker = await resolveFile(workspace.files, relative + '/.ailo-owned', true);
    const mount = path.dirname(marker);
    const existing = await fs.readdir(mount);
    if (existing.length && await fs.readFile(marker, 'utf8').catch(() => '') !== OWNED) throw Error('技能资源目录与现有项目文件冲突，请调整 .runtime/ailo-skills 后重试。');
    const selected = items.filter(e => e.enabled && e.package);
    const bundles = await Promise.all(selected.map(async item => {
      const saved = await manifest(item.package.id), files = [];
      for (const f of saved.files) {
        const source = await resolveFile(root, saved.id + '/files/' + f.path);
        const stat = await fs.stat(source);
        if (!stat.isFile() || stat.size !== f.size) throw Error('技能包文件已损坏，请重新导入 ZIP。');
        const data = await fs.readFile(source);
        if (digest(data) !== f.sha256) throw Error('技能包文件已损坏，请重新导入 ZIP。');
        files.push({ ...f, data });
      }
      return { id: saved.id, files };
    }));
    // Removal cannot follow links, and the marker prevents deleting user files.
    for (const name of existing) if (name !== '.ailo-owned') await fs.rm(path.join(mount, name), { recursive: true, force: true });
    await fs.writeFile(marker, OWNED, { mode: 0o600 });
    for (const bundle of bundles) for (const f of bundle.files) {
      const target = await resolveFile(workspace.files, relative + '/' + bundle.id + '/' + f.path, true);
      await fs.writeFile(target, f.data, { mode: f.executable ? 0o700 : 0o600 });
    }
    return items.filter(e => e.enabled).map(item => {
      if (!item.package) return item;
      const bundle = bundles.find(b => b.id === item.package.id), base = relative + '/' + bundle.id;
      const listing = bundle.files.map(f => f.path).join('\n');
      return { ...item, instructions: item.instructions + '\n\n技能配套文件根目录（项目相对路径）：' + base + '\n文件清单：\n' + listing.slice(0, 3000) + (listing.length > 3000 ? '\n清单已截断，可用 list_files 查看完整目录。' : '') + '\n按需用 read_file 读取引用文档；SKILL.md 的相对链接均相对此目录。执行配套脚本时须使用此根目录解析路径，并遵守当前任务的工具权限；导入不会自动执行脚本。以上编辑后的工作指令优先于包内 SKILL.md。' };
    });
  }
  return { importSkill, validate, prepare };
}
module.exports = { createSkillPackages, LIMITS };

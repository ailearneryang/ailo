const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { readMaterial } = require("../apps/desktop/materials.cjs");
async function setup() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ailo-archive-test-"));
  const src = path.join(dir, "source");
  await fs.mkdir(src);
  return { dir, src };
}
function pack(dir, src, name, format = "zip") {
  const file = path.join(dir, name);
  execFileSync("/usr/bin/tar", [
    "-cf",
    file,
    ...(name.endsWith(".gz") || name.endsWith(".tgz") ? ["-z"] : []),
    "--format=" + format,
    "-C",
    src,
    ".",
  ]);
  return file;
}
test("ZIP, 7z, TAR and gzip TAR import readable Unicode contents and mark skipped entries", async () => {
  const { dir, src } = await setup();
  try {
    await fs.writeFile(path.join(src, "需求.md"), "# 需求\n做一个番茄钟");
    await fs.writeFile(path.join(src, "config.json"), "{}");
    await fs.writeFile(path.join(src, "image.png"), Buffer.from([0, 1, 2]));
    await fs.writeFile(path.join(src, "nested.zip"), "nested");
    for (const [name, format] of [
      ["test.zip", "zip"],
      ["test.7z", "7zip"],
      ["test.tar", "pax"],
      ["test.tar.gz", "pax"],
      ["test.tgz", "pax"],
    ]) {
      const result = await readMaterial(pack(dir, src, name, format));
      assert.ok(result.text.includes("做一个番茄钟"));
      assert.equal(
        result.archive.entries.filter((e) => e.status === "已读取").length,
        2,
      );
      assert.equal(
        result.archive.entries.filter((e) => e.status.startsWith("跳过"))
          .length,
        2,
      );
    }
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
test("never follows archived links to external files", async () => {
  const { dir, src } = await setup();
  try {
    await fs.writeFile(path.join(dir, "outside.txt"), "outside-only-secret");
    await fs.symlink("../outside.txt", path.join(src, "link.txt"));
    await fs.writeFile(path.join(src, "ok.md"), "safe");
    const result = await readMaterial(pack(dir, src, "links.tar", "pax"));
    assert.ok(!result.text.includes("outside-only-secret"));
    assert.ok(result.text.includes("safe"));
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
test("caps expansion, rejects corrupt/empty archives, skips dependencies and non-UTF8", async () => {
  const { dir, src } = await setup();
  try {
    await fs.writeFile(path.join(src, "large.md"), "a".repeat(1100000));
    await fs.writeFile(path.join(src, "ok.md"), "usable");
    await fs.writeFile(path.join(src, "binary.txt"), Buffer.from([0xff, 0xfe]));
    await fs.mkdir(path.join(src, "node_modules"));
    await fs.writeFile(path.join(src, "node_modules", "skip.js"), "ignored");
    const result = await readMaterial(pack(dir, src, "limits.zip"));
    assert.ok(result.text.includes("usable"));
    assert.ok(
      result.archive.entries.some((e) => e.status.includes("超过 1 MB")),
    );
    assert.ok(
      result.archive.entries.some((e) => e.status.includes("非 UTF-8")),
    );
    assert.ok(result.archive.entries.some((e) => e.status.includes("依赖")));
    await fs.writeFile(path.join(dir, "bad.zip"), "invalid");
    await assert.rejects(readMaterial(path.join(dir, "bad.zip")), /压缩包/);
    const empty = path.join(dir, "empty");
    await fs.mkdir(empty);
    await assert.rejects(
      readMaterial(pack(dir, empty, "empty.zip")),
      /没有可读取/,
    );
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
test('DOCX reads paragraphs, tables and entities, including DOCX inside ZIP', async () => {
  const { dir, src } = await setup();
  try {
    const word = path.join(dir, 'word'); await fs.mkdir(word);
    const xml = `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>需求 &amp; 方案</w:t><w:br/><w:t>做一个番茄钟</w:t></w:r><w:del><w:r><w:delText>已删除内容</w:delText></w:r></w:del></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>功能</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>计时</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>`;
    await fs.writeFile(path.join(word, 'document.xml'), xml);
    const docx = path.join(src, '需求.docx');
    execFileSync('/usr/bin/tar', ['-cf',docx,'--format=zip','-C',dir,'word']);
    const result = await readMaterial(docx);
    assert.equal(result.text, '需求 & 方案\n做一个番茄钟\n功能\t计时');
    assert.match(result.summary, /正文和表格/);
    const zipped = await readMaterial(pack(dir, src, 'documents.zip'));
    assert.ok(zipped.text.includes(result.text));
    const { extractDocxXml } = require('../apps/desktop/docx.cjs');
    assert.equal(extractDocxXml(Buffer.from('\ufeff' + xml, 'utf16le')), result.text);
    assert.throws(() => extractDocxXml(Buffer.from('<!DOCTYPE x [<!ENTITY x SYSTEM "file:///etc/passwd">]>' + xml)), /格式无效/);
    assert.throws(() => extractDocxXml(Buffer.from(xml.replace('</w:body>', ''))), /格式无效/);
    assert.throws(() => extractDocxXml(Buffer.from(xml.replace(/<w:t>.*?<\/w:t>/g, ''))), /没有可读取/);
    await fs.writeFile(path.join(word,'document.xml'), 'a'.repeat(4 * 1024 * 1024 + 1));
    execFileSync('/usr/bin/tar', ['-cf',docx,'--format=zip','-C',dir,'word']);
    await assert.rejects(readMaterial(docx), /正文超过 4 MB/);
    await fs.writeFile(docx, 'broken');
    await assert.rejects(readMaterial(docx), /DOCX 无法读取/);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('archive source resolves unique suffixes, reports ambiguity and rejects unsafe paths', async () => {
  const { readSource } = require('../apps/desktop/materials.cjs');
  const { dir, src } = await setup();
  try {
    await fs.mkdir(path.join(src, 'mcp-materials'));
    await fs.mkdir(path.join(src, 'other'));
    await fs.writeFile(path.join(src, 'mcp-materials', 'extractSvg-3-43379.json'), '{"ok":true}');
    await fs.writeFile(path.join(src, 'mcp-materials', 'same.json'), 'first');
    await fs.writeFile(path.join(src, 'other', 'same.json'), 'second');
    const archive = pack(dir, src, 'test.zip');
    const result = await readSource(archive, 'test.zip', 'extractSvg-3-43379.json');
    assert.equal(result.text, '{"ok":true}');
    assert.match(result.entry, /mcp-materials\/extractSvg-3-43379.json$/);
    assert.equal((await readSource(archive, 'test.zip', result.entry)).text, result.text);
    assert.equal((await readSource(archive, 'test.zip', 'other/same.json')).text, 'second');
    await assert.rejects(readSource(archive, 'test.zip', 'same.json'), /不唯一.*mcp-materials.*other/);
    await assert.rejects(readSource(archive, 'test.zip', 'missing.json'), /条目不存在.*可用路径/);
    for (const entry of ['../same.json', '/same.json', 'C:/same.json', '*.json', 'node_modules/x.json']) {
      await assert.rejects(readSource(archive, 'test.zip', entry), /路径无效/);
    }
    await fs.writeFile(archive, 'broken');
    await assert.rejects(readSource(archive, 'test.zip', 'same.json'), /无法读取压缩包/);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { importPastedMaterials } = require('../apps/desktop/materials.cjs');
test('pasted files retain names, parsed text and private source bytes', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ailo-paste-test-'));
  try {
    const entries = [{ name: '需求.txt', bytes: Buffer.from('需求正文') }, { name: 'image.png', bytes: Buffer.from([137, 80, 78, 71]) }];
    const materials = await importPastedMaterials(entries, dir);
    assert.equal(materials[0].text, '需求正文');
    assert.equal(materials[1].text, null);
    for (const [index, material] of materials.entries()) {
      assert.equal(material.name, entries[index].name);
      const filename = path.join(dir, material.sourceId);
      assert.deepEqual(await fs.readFile(filename), entries[index].bytes);
      assert.equal((await fs.stat(filename)).mode & 0o777, 0o600);
    }
    await assert.rejects(importPastedMaterials([{ name: 'valid.txt', bytes: Buffer.from('text') }, { name: 'unsupported.rar', bytes: Buffer.from('archive') }], dir));
    assert.equal((await fs.readdir(dir)).length, 2, 'failed batches roll back their imports');
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
test('pasted material limits are validated before writing', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ailo-paste-test-'));
  try {
    for (const input of [null, [], Array.from({ length: 11 }, () => ({ name: 'a.txt', bytes: Buffer.from('a') })), [{ name: 'large.txt', bytes: new Uint8Array(20 * 1024 * 1024 + 1) }], [{ name: 'invalid.txt', bytes: 'text' }]]) {
      await assert.rejects(importPastedMaterials(input, dir));
    }
    assert.deepEqual(await fs.readdir(dir), []);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

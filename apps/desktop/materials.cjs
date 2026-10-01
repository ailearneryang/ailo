const fs = require("node:fs/promises");
const os = require("node:os");
const { extractDocxXml } = require("./docx.cjs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const ARCHIVE = /\.(zip|7z|tar|tgz|tar\.gz)$/i;
const TEXT =
  /\.(txt|md|markdown|csv|tsv|json|jsonl|ya?ml|toml|xml|html?|css|scss|less|js|jsx|ts|tsx|mjs|cjs|py|java|kt|kts|swift|go|rs|c|h|cpp|hpp|cs|rb|php|sql|sh|bash|zsh|vue|svelte|ini|conf|log)$/i;
const MAX_FILE = 20 * 1024 * 1024;
const MAX_TEXT = 100000;
const extensions = [
  "docx",
  "txt",
  "md",
  "csv",
  "json",
  "yaml",
  "yml",
  "pdf",
  "png",
  "jpg",
  "jpeg",
  "zip",
  "7z",
  "tar",
  "tgz",
  "gz",
];
function tar(args, maxBytes, timeout) {
  return new Promise((resolve, reject) => {
    const child = spawn("/usr/bin/tar", args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, COPYFILE_DISABLE: "1" },
    });
    let stderr = "";
    child.stderr.on("data", chunk => { stderr = (stderr + chunk.toString("utf8")).slice(0, 8192); });
    let length = 0,
      failure,
      chunks = [];
    function stop(message) {
      if (!failure) {
        failure = Error(message);
        child.kill("SIGKILL");
      }
    }
    const timer = setTimeout(
      () => stop("读取压缩包超时，请缩小压缩包后重试。"),
      timeout,
    );
    child.stdout.on("data", (chunk) => {
      length += chunk.length;
      if (length > maxBytes) stop("文件内容超过读取上限");
      else if (!failure) chunks.push(chunk);
    });
    child.on("error", () => {
      clearTimeout(timer);
      reject(Error("无法启动压缩包读取工具。"));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (failure) reject(failure);
      else if (code !== 0)
        reject(
          Error(
            /not found in archive/i.test(stderr)
              ? "压缩包内条目不存在，请省略 entry 读取目录，再使用完整路径。"
              : "无法读取压缩包或条目：可能损坏、加密或格式不受支持。请使用未加密的 ZIP、7z 或 TAR 压缩包。",
          ),
        );
      else resolve(Buffer.concat(chunks));
    });
  });
}
async function readDocx(filename, timeout = 8000) {
  let buffer;
  try {
    buffer = await tar(["-xOf", filename, "word/document.xml"], 4 * 1024 * 1024, timeout);
  } catch {
    throw Error("DOCX 无法读取：文件损坏、加密或正文超过 4 MB，请解密或缩小文档后重试。");
  }
  return extractDocxXml(buffer);
}
async function readEmbeddedDocx(buffer, timeout) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ailo-docx-"));
  try {
    const filename = path.join(dir, "material.docx");
    await fs.writeFile(filename, buffer, { mode: 0o600 });
    return await readDocx(filename, timeout);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}
function decode(buffer) {
  if (buffer.includes(0)) return null;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    return null;
  }
}
function readable(name) {
  return (
    TEXT.test(name) ||
    /^(readme|license|dockerfile|makefile|gitignore)$/i.test(
      path.posix.basename(name).replace(/^\./, ""),
    )
  );
}
function excluded(name) {
  return /(^|\/)(node_modules|\.git|__MACOSX|\.DS_Store)(\/|$)/.test(name);
}
async function readArchive(filename, size) {
  const deadline = Date.now() + 20000;
  const listing = (await tar(["-tf", filename], 128 * 1024, 8000)).toString(
    "utf8",
  );
  const names = listing.split("\n").filter(Boolean);
  if (names.length > 1000)
    throw Error("压缩包条目超过 1000 个，请移除依赖目录或拆分压缩包。");
  const entries = [],
    seen = new Set();
  let remaining = MAX_TEXT,
    reads = 0;
  for (const name of names) {
    if (name.endsWith("/")) continue;
    const entry = { name, status: "" };
    entries.push(entry);
    if (
      name.length > 500 ||
      name.startsWith("/") ||
      /^[A-Za-z]:/.test(name) ||
      name.split("/").includes("..") ||
      /[\\*?\[\]\x00-\x1f]/.test(name)
    ) {
      entry.status = "跳过：文件路径不受支持";
      continue;
    }
    if (seen.has(name)) {
      entry.status = "跳过：重复路径";
      continue;
    }
    seen.add(name);
    if (excluded(name)) {
      entry.status = "跳过：依赖或系统文件";
      continue;
    }
    const isDocx = /\.docx$/i.test(name);
    if (!readable(name) && !isDocx) {
      entry.status = ARCHIVE.test(name)
        ? "跳过：嵌套压缩包"
        : "跳过：非文本文件或暂不支持的格式";
      continue;
    }
    if (remaining <= 0 || reads >= 64) {
      entry.status = "跳过：已达到读取上限";
      continue;
    }
    if (Date.now() >= deadline)
      throw Error("读取压缩包超时，请缩小压缩包后重试。");
    reads++;
    let content;
    try {
      const buffer = await tar(
          ["-xOf", filename, "--", name],
          isDocx ? MAX_FILE : 1024 * 1024,
          Math.max(1, Math.min(3000, deadline - Date.now())),
        );
      content = isDocx ? await readEmbeddedDocx(buffer, Math.max(1, Math.min(3000, deadline - Date.now()))) : decode(buffer);
    } catch (error) {
      if (error.message === "文件内容超过读取上限") {
        entry.status = `跳过：单个文件超过 ${isDocx ? 20 : 1} MB`;
        continue;
      }
      if (isDocx) { entry.status = `跳过：${error.message}`; continue; }
      throw error;
    }
    if (content === null) {
      entry.status = "跳过：二进制内容或非 UTF-8 文本";
      continue;
    }
    const truncated = content.length > remaining;
    entry.status = truncated ? "已读取（内容已截断）" : "已读取";
    entry.text = content.slice(0, remaining);
    remaining -= entry.text.length;
  }
  const loaded = entries.filter((e) => e.text !== undefined);
  if (!loaded.length)
    throw Error(
      "压缩包中没有可读取的 UTF-8 文本。支持 DOCX、文本、Markdown、代码和配置文件；PDF、图片和嵌套压缩包暂不解析。",
    );
  const skipped = entries.length - loaded.length;
  const summary = `已读取 ${loaded.length} 个文件${skipped ? `，跳过 ${skipped} 个` : ""}${loaded.some((e) => e.status.includes("截断")) ? "，部分内容已截断" : ""}`;
  const manifest = entries
    .map((e) => `${JSON.stringify(e.name)}：${e.status}`)
    .join("\n");
  return {
    name: path.basename(filename),
    size,
    summary,
    archive: { entries: entries.map(({ text, ...entry }) => entry) },
    text: `压缩包 ${path.basename(filename)}\n${summary}\n文件清单（跳过的文件没有提供正文）：\n${manifest}\n\n${loaded.map((e) => `--- 文件 ${JSON.stringify(e.name)} ---\n${e.text}\n--- 文件结束 ---`).join("\n\n")}`,
  };
}
async function readMaterial(filename) {
  const info = await fs.stat(filename);
  if (!info.isFile()) throw Error("请选择文件。");
  if (info.size > MAX_FILE) throw Error("单个材料文件请小于 20 MB。");
  if (/\.docx$/i.test(filename)) {
    const content = await readDocx(filename);
    return { name: path.basename(filename), size: info.size, text: content.slice(0, MAX_TEXT),
      summary: `已读取 DOCX 正文和表格${content.length > MAX_TEXT ? "（前 100000 字符，内容已截断）" : ""}；图片暂不识别` };
  }
  if (ARCHIVE.test(filename)) return readArchive(filename, info.size);
  if (/\.(rar|gz)$/i.test(filename))
    throw Error(
      "请使用 ZIP、7z、TAR 或 TAR.GZ/TGZ 格式；不支持 RAR 和单文件 GZ。",
    );
  const content = readable(filename)
    ? decode(await fs.readFile(filename))
    : null;
  return {
    name: path.basename(filename),
    size: info.size,
    text: content?.slice(0, MAX_TEXT) ?? null,
    ...(content && content.length > MAX_TEXT
      ? { summary: "已读取前 100000 字符，内容已截断" }
      : {}),
  };
}
function safeArchiveEntry(entry) {
  return typeof entry === 'string' && entry.length > 0 && entry.length <= 500 &&
    !entry.startsWith('/') && !/^[A-Za-z]:/.test(entry) &&
    !entry.split('/').includes('..') && !/[\\*?\[\]\x00-\x1f]/.test(entry) && !excluded(entry);
}
function resolveArchiveEntry(listing, requested) {
  if (!safeArchiveEntry(requested)) throw Error('压缩包路径无效');
  const names = listing.split('\n').filter(name => !name.endsWith('/') && safeArchiveEntry(name));
  const normalize = name => name.replace(/^(\.\/)+/, '');
  const exact = names.filter(name => normalize(name) === normalize(requested));
  const matches = exact.length ? exact : names.filter(name => normalize(name).endsWith('/' + normalize(requested)));
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) throw Error(`压缩包内路径匹配不唯一，请指定完整路径：${JSON.stringify(matches.slice(0, 10))}。省略 entry 可读取完整目录。`);
  const candidates = names.filter(name => readable(name) || /\.docx$/i.test(name));
  throw Error(`压缩包内条目不存在：${JSON.stringify(requested)}。可用路径（最多 10 项）：${JSON.stringify(candidates.slice(0, 10))}。请省略 entry 读取完整目录，修正路径后再试，不要重复相同参数。`);
}
async function readSource(filename, name, entry) {
  if (ARCHIVE.test(name)) {
    if (entry !== undefined && entry !== '' && !safeArchiveEntry(entry)) throw Error('压缩包路径无效');
    const listing = (await tar(['-tf',filename],128*1024,8000)).toString('utf8');
    if (!entry) return {text:listing,kind:'archive_manifest'};
    entry = resolveArchiveEntry(listing, entry);
    const isDocx=/\.docx$/i.test(entry);
    if(!readable(entry)&&!isDocx)throw Error('此条目不支持文本解析');
    const buffer=await tar(['-xOf',filename,'--',entry],isDocx?MAX_FILE:2*1024*1024,8000);
    const text=isDocx?await readEmbeddedDocx(buffer,8000):decode(buffer);
    if(text===null)throw Error('条目不是 UTF-8 文本');
    return {text,kind:'archive_entry',entry};
  }
  if (/\.docx$/i.test(name)) return {text:await readDocx(filename),kind:'docx_text'};
  if(!readable(name))throw Error('此文件暂不支持文本解析');
  const text=decode(await fs.readFile(filename));if(text===null)throw Error('文件不是 UTF-8 文本');
  return {text,kind:'text'};
}
module.exports = { readMaterial, readSource, extensions };

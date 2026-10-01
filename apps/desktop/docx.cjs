const { DOMParser } = require('@xmldom/xmldom');
const NS = new Set(['http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'http://purl.oclc.org/ooxml/wordprocessingml/main']);
function extractDocxXml(buffer) {
  let xml;
  try {
    const encoding = buffer[0] === 0xff && buffer[1] === 0xfe ? 'utf-16le' : buffer[0] === 0xfe && buffer[1] === 0xff ? 'utf-16be' : 'utf-8';
    xml = new TextDecoder(encoding, { fatal: true }).decode(buffer);
    if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw Error('DTD');
    const doc = new DOMParser({ onError: () => { throw Error('XML'); } }).parseFromString(xml, 'application/xml');
    const root = doc.documentElement;
    if (root.localName !== 'document' || !NS.has(root.namespaceURI)) throw Error('document');
    const output = [];
    // Iterative traversal avoids stack overflow for deeply nested input.
    const stack = [{ node: root, end: false }];
    while (stack.length) {
      const { node, end } = stack.pop();
      const word = NS.has(node.namespaceURI);
      const tag = word ? node.localName : '';
      if (end) {
        if (tag === 'p' || tag === 'tr') output.push('\n');
        if (tag === 'tc') output.push('\t');
        continue;
      }
      if (tag === 'del' || tag === 'moveFrom') continue;
      if (tag === 't') { output.push(node.textContent); continue; }
      if (tag === 'tab') output.push('\t');
      if (tag === 'br' || tag === 'cr') output.push('\n');
      stack.push({ node, end: true });
      for (let child = node.lastChild; child; child = child.previousSibling) {
        if (child.nodeType === 1) stack.push({ node: child, end: false });
      }
    }
    const text = output.join('').replace(/\n\t/g, '\t').replace(/\t\n/g, '\n').trim();
    if (!text) throw Error('empty');
    return text;
  } catch (error) {
    if (error.message === 'empty') throw Error('DOCX 中没有可读取的正文；图片和扫描内容暂不识别。');
    throw Error('DOCX 正文格式无效或已损坏，请重新保存为 .docx 后添加。');
  }
}
module.exports = { extractDocxXml };

// Build an offline, static preview. Never give the renderer file:// access.
const fs = require('node:fs/promises');
const path = require('node:path');
const {DOMParser, XMLSerializer} = require('@xmldom/xmldom');
const {resolveFile, normalizeProjectPath} = require('./agent/workspace.cjs');
const mime = {'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.gif':'image/gif','.webp':'image/webp','.avif':'image/avif','.svg':'image/svg+xml','.ico':'image/x-icon','.woff':'font/woff','.woff2':'font/woff2','.ttf':'font/ttf','.otf':'font/otf'};
const MAX_ASSET_BYTES = 10 * 1024 * 1024, MAX_TOTAL_BYTES = 40 * 1024 * 1024, MAX_RESOURCES = 300;

async function htmlPreview(content, root, relative) {
  relative = normalizeProjectPath(relative);
  const issues = new Set(), cache = new Map();
  let totalBytes = 0, expandedBytes = 0, loaded = 0, scriptsBlocked = 0, parseWarnings = false;
  const issue = (ref, reason) => issues.add(`${String(ref).slice(0,160)}：${reason}`);
  // xmldom accepts HTML void elements, but fragments need a document wrapper.
  const source = /<html[\s>]/i.test(content) ? content : '<html><head></head><body>' + content.replace(/^\s*<!doctype[^>]*>/i, '') + '</body></html>';
  let doc;
  try {
    doc = new DOMParser({onError:()=>{parseWarnings=true;}}).parseFromString(source, 'text/html');
  } catch {
    return {content, htmlResources:{loaded:0, issues:['HTML 结构无法完整解析，资源未加载；请在文件夹中查看完整文件。'], scriptsBlocked:0}};
  }
  function locate(ref, base) {
    if (!root) throw Error('缺少项目资源目录');
    // Remote URLs, filesystem URLs and absolute paths are never read here.
    if (/^[a-z][a-z\d+.-]*:|^\/|[\\\x00-\x1f]/i.test(ref)) throw Error('预览不加载项目外资源');
    let decoded;
    try {decoded = decodeURIComponent(ref.split(/[?#]/,1)[0]);} catch {throw Error('资源路径编码无效');}
    if (!decoded || /^[a-z][a-z\d+.-]*:|^\/|[\\\x00-\x1f]/i.test(decoded)) throw Error('资源路径无效');
    const joined = path.posix.normalize(path.posix.join(path.posix.dirname(base), decoded));
    if (joined === '..' || joined.startsWith('../')) throw Error('资源超出当前项目');
    const result = normalizeProjectPath(joined);
    if (result.split('/').some(part=>part.startsWith('.'))) throw Error('预览不加载隐藏文件');
    return result;
  }
  async function read(ref, base, css = false, ancestors = []) {
    ref = ref.trim();
    if (/^data:/i.test(ref)) {
      if (css || !/^data:(image\/(png|jpeg|gif|webp|avif|svg\+xml|x-icon)|font\/(woff2?|ttf|otf));/i.test(ref)) {issue('内嵌资源','不支持此类型');return null;}
      return ref;
    }
    if (ref.startsWith('#')) return ref;
    let name;
    try {name=locate(ref,base);} catch(e) {issue(ref,e.message);return null;}
    if (ancestors.includes(name) || ancestors.length>=5) {issue(ref,'样式循环引用或嵌套过深');return null;}
    const key = (css?'css:':'asset:')+name;
    const embed=async pending=>{const value=await pending;if(value!==null){expandedBytes+=Buffer.byteLength(value);if(expandedBytes>60*1024*1024){issue(ref,'资源重复引用超过预览大小上限');return null;}}return value;};
    if (cache.has(key)) return embed(cache.get(key));
    if (cache.size>=MAX_RESOURCES) {issue(ref,'资源数量超过预览上限');return null;}
    const pending = (async()=>{
      try {
        const ext=path.extname(name).toLowerCase(),type=mime[ext];
        if (css ? ext!=='.css' : !type) throw Error('不支持此资源类型');
        const file=await resolveFile(root,name),stat=await fs.stat(file);
        if (!stat.isFile()) throw Error('不是普通文件');
        if (stat.size>MAX_ASSET_BYTES || totalBytes+stat.size>MAX_TOTAL_BYTES) throw Error('资源超过预览大小上限');
        totalBytes+=stat.size;
        const data=await fs.readFile(file);
        if (data.length!==stat.size) throw Error('文件正在变化，请刷新预览');
        const value=css ? await styles(data.toString('utf8'), name, [...ancestors,name]) : `data:${type};base64,${data.toString('base64')}`;
        loaded++;
        return value;
      } catch(e) {issue(ref,e.code==='ENOENT'?'资源文件不存在':e.message);return null;}
    })();
    cache.set(key,pending);
    return embed(pending);
  }
  async function replaceAsync(text, regex, convert) {
    let out='',cursor=0;
    for(const match of text.matchAll(regex)) {out+=text.slice(cursor,match.index)+await convert(match);cursor=match.index+match[0].length;}
    return out+text.slice(cursor);
  }
  async function styles(css, base, ancestors=[]) {
    // Ignore comments while resolving references; keep ordinary CSS intact.
    css=css.replace(/\/\*[\s\S]*?\*\//g,'');
    css=await replaceAsync(css, /@import\s+(?:url\(\s*)?(?:"([^"]+)"|'([^']+)'|([^\s;)]+))\s*\)?\s*([^;]*);/gi, async m=>{
      const nested=await read(m[1]||m[2]||m[3],base,true,ancestors);
      return nested===null?'':m[4].trim()?`@media ${m[4]} {${nested}}`:nested;
    });
    return replaceAsync(css,/url\(\s*(?:"([^"]*)"|'([^']*)'|([^\s)]*))\s*\)/gi,async m=>{
      const value=await read(m[1]??m[2]??m[3],base,false,ancestors);
      return value===null?'url("data:,")':`url("${value.replace(/"/g,'%22')}")`;
    });
  }
  const elements=Array.from(doc.getElementsByTagName('*'));
  // The app adds its own restrictive CSP; original CSPs could block bundled data URLs.
  for(const node of elements) {
    const tag=node.tagName.toLowerCase();
    if(tag==='base'||tag==='meta'&&/^(content-security-policy|refresh)$/i.test(node.getAttribute('http-equiv')||'')) node.parentNode?.removeChild(node);
    if(tag==='script') {scriptsBlocked++;node.parentNode?.removeChild(node);}
  }
  for(const node of elements) {
    if(!node.parentNode) continue;
    const tag=node.tagName.toLowerCase();
    if(tag==='link') {
      if((node.getAttribute('rel')||'').toLowerCase()==='stylesheet') {
        const css=await read(node.getAttribute('href')||'',relative,true);
        if(css!==null){const style=doc.createElement('style');if(node.hasAttribute('media'))style.setAttribute('media',node.getAttribute('media'));style.appendChild(doc.createTextNode(css));node.parentNode.replaceChild(style,node);}
        else node.parentNode.removeChild(node);
      } else node.parentNode.removeChild(node);
      continue;
    }
    if(tag==='style') node.textContent=await styles(node.textContent,relative);
    if(node.hasAttribute('style')) node.setAttribute('style',await styles(node.getAttribute('style'),relative));
    if(['iframe','object','embed','video','audio'].includes(tag)) {issue(tag,'静态预览不运行嵌入内容');node.parentNode.removeChild(node);continue;}
    for(const attr of ['src','poster', ...(tag==='image'?['href','xlink:href']:[])]) if(node.hasAttribute(attr)) {
      const original=node.getAttribute(attr),value=await read(original,relative);
      node.setAttribute(attr,value===null?'data:,':value);
    }
    if(node.hasAttribute('srcset')) {
      const set=node.getAttribute('srcset');
      // Preserve embedded sources without splitting their data-URL commas.
      if(!/^\s*data:/i.test(set)) {
        const parts=[];
        for(const part of set.split(',')) {
          const match=part.trim().match(/^(\S+)(?:\s+(\d+(?:\.\d+)?[wx]))?$/);
          if(!match){issue('srcset','无法解析图片候选路径');continue;}
          const value=await read(match[1],relative);if(value!==null)parts.push(value+(match[2]?' '+match[2]:''));
        }
        if(parts.length)node.setAttribute('srcset',parts.join(', '));else node.removeAttribute('srcset');
      }
    }

  }
  if(parseWarnings) issue('HTML','结构不规范，预览可能与浏览器不同');
  return {content:new XMLSerializer().serializeToString(doc),htmlResources:{loaded,issues:Array.from(issues).slice(0,20),scriptsBlocked}};
}
module.exports={htmlPreview};

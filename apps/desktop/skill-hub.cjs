const { createHash } = require('node:crypto');
const { LIMITS } = require('./skill-packages.cjs');
const BASE = 'https://api.skillhub.cn';
function identity(value, label) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,149}$/.test(value)) throw Error(label + '无效。');
  return value;
}
function createSkillHub({ packages, imageData, fetch: request = globalThis.fetch } = {}) {
  async function read(route, limit, binary = false, image = false) {
    const signal = AbortSignal.timeout(30000);
    let url = new URL(route, BASE);
    try {
      for (let hop = 0; hop < 5; hop++) {
        if (url.protocol !== 'https:' || url.username || url.password || url.port || !(url.hostname === 'api.skillhub.cn' || (image && url.hostname === 'cloudcache.tencent-cloud.com') || /^[a-z0-9.-]+\.myqcloud\.com$/.test(url.hostname))) throw Error('SkillHub 下载地址不受支持。');
        const response = await request(url.href, { signal, redirect: 'manual', credentials: 'omit' });
        if ([301,302,303,307,308].includes(response.status)) {
          await response.body?.cancel();
          const next = response.headers.get('location');
          if (!next) throw Error('SkillHub 下载地址缺失。');
          url = new URL(next, url); continue;
        }
        if (!response.ok) {
          await response.body?.cancel();
          throw Error(({401:'SkillHub 需要接入授权。',403:'SkillHub 拒绝访问此技能。',404:'技能或版本不存在，或未公开。',429:'SkillHub 请求过于频繁，请稍后重试。'})[response.status] || 'SkillHub 暂时不可用（HTTP '+response.status+'）。');
        }
        if (Number(response.headers.get('content-length')) > limit) { await response.body?.cancel(); throw Error('SkillHub 返回内容过大。'); }
        const chunks = []; let size = 0;
        if (!response.body) throw Error('SkillHub 返回空内容。');
        const reader = response.body.getReader();
        try { for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > limit) { await reader.cancel(); throw Error('SkillHub 返回内容过大。'); } chunks.push(Buffer.from(value)); } } finally { reader.releaseLock(); }
        const data = Buffer.concat(chunks);
        return binary ? data : JSON.parse(data.toString('utf8'));
      }
      throw Error('SkillHub 下载重定向次数过多。');
    } catch (error) {
      if (signal.aborted) throw Error('SkillHub 请求超时，请重试。');
      if (error instanceof SyntaxError) throw Error('SkillHub 返回格式无效。');
      if (error instanceof TypeError) throw Error('无法连接 SkillHub，请检查网络后重试。');
      throw error;
    }
  }
  const count = value => Number.isFinite(value) && value >= 0 ? Math.floor(value) : null;
  function item(raw, index = 0) {
    const slug = identity(raw?.slug, '技能标识');
    return { slug, rowKey: index + ':' + slug, iconUrl: typeof raw.iconUrl === 'string' ? raw.iconUrl.slice(0,2000) : '', category: String(raw.category || '').slice(0,150), downloads: count(raw.downloads ?? raw.stats?.downloads), stars: count(raw.stars ?? raw.stats?.stars), name: String(raw.name || raw.displayName || slug).slice(0,150), description: String(raw.description_zh || raw.summary_zh || raw.description || raw.summary || '').slice(0,3000), version: String(raw.version || '').slice(0,150), owner: String(raw.ownerName || '').slice(0,150), requiresKey: raw.labels?.requires_api_key === 'true', paid: raw.labels?.pricing_type === 'paid' };
  }
  async function search(input = {}) {
    if (typeof input.keyword !== 'string' || input.keyword.length > 200 || !Number.isSafeInteger(input.page) || input.page < 1 || input.page > 10000) throw Error('搜索参数无效。');
    const category = input.category ?? '', sortBy = input.sortBy ?? 'downloads';
    if (typeof category !== 'string' || (category && !/^[a-z0-9-]{1,100}$/.test(category)) || !['downloads','stars','score','updated_at'].includes(sortBy)) throw Error('筛选参数无效。');
    const query = new URLSearchParams({ category, keyword: input.keyword.trim(), page: String(input.page), pageSize:'20', sortBy, order:'desc' });
    const result = await read('/api/skills?' + query, 2 * 1024 * 1024);
    if (result.code !== 0 || !Array.isArray(result.data?.skills) || !Number.isSafeInteger(result.data.total) || result.data.total < 0) throw Error('SkillHub 搜索结果无效。');
    return { total: result.data.total, skills: result.data.skills.slice(0,20).map(item) };
  }
  async function detail(slug) {
    identity(slug, '技能标识');
    const result = await read('/api/v1/skills/' + encodeURIComponent(slug), 2 * 1024 * 1024);
    const skill = item(result.skill);
    if (skill.slug !== slug) throw Error('SkillHub 返回的技能标识不一致。');
    return { ...skill, version: identity(result.latestVersion?.version, '技能版本'), owner: String(result.owner?.displayName || result.owner?.handle || '').slice(0,150) };
  }
  async function install(input) {
    const slug = identity(input?.slug, '技能标识'), version = identity(input?.version, '技能版本');
    const buffer = await read('/api/v1/download?' + new URLSearchParams({slug,version}), LIMITS.archive, true);
    const skill = await packages.importSkill({ name: slug + '.zip', buffer });
    return { ...skill, id: 'skillhub-' + createHash('sha256').update(slug).digest('hex'), source: { provider:'skillhub', slug, version, sha256:createHash('sha256').update(buffer).digest('hex') } };
  }
  async function categories() {
    const result = await read('/api/v1/categories', 256 * 1024);
    if (!Array.isArray(result.items)) throw Error('SkillHub 分类结果无效。');
    return result.items.filter(c => c.active !== false && c.level === 1 && typeof c.key === 'string' && /^[a-z0-9-]{1,100}$/.test(c.key) && typeof c.name === 'string').sort((a,b)=>(a.sortOrder||0)-(b.sortOrder||0)).slice(0,50).map(c=>({key:c.key,name:c.name.slice(0,60)}));
  }
  const icons = new Map();
  async function icon(url) {
    if (typeof url !== 'string' || url.length > 2000) return '';
    if (icons.has(url)) return icons.get(url);
    const pending = (async()=>{
      try {
        const parsed = new URL(url);
        if (!(parsed.hostname === 'cloudcache.tencent-cloud.com' || /^[a-z0-9.-]+\.myqcloud\.com$/.test(parsed.hostname))) return '';
        const bytes = await read(url, 2 * 1024 * 1024, true, true);
        const mime = bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) ? 'image/png' : bytes[0]===255 && bytes[1]===216 && bytes[2]===255 ? 'image/jpeg' : bytes.toString('ascii',0,4)==='RIFF' && bytes.toString('ascii',8,12)==='WEBP' ? 'image/webp' : '';
        return mime ? (imageData ? imageData(bytes) : 'data:'+mime+';base64,'+bytes.toString('base64')) : '';
      } catch { return ''; }
    })();
    if (icons.size >= 40) icons.delete(icons.keys().next().value);
    icons.set(url,pending);return pending;
  }
  return { search, detail, install, categories, icon };
}
module.exports = { createSkillHub };

export const CLARIFICATION_PROMPT = `当确实需要用户做选择或补充材料才能继续时，使用可交互澄清卡片。每轮只问最关键的 1–3 题；能自行确定的非阻塞事项放入 defaults，不要重复询问已确认信息。先简短说明，然后在回复末尾输出且仅输出一个如下格式的代码块（合法 JSON，无注释）：
\`\`\`ailo-questions
{"title":"确认后继续","questions":[{"id":"forecast","kind":"choice","title":"预报展示几天？","options":[{"id":"actual","label":"按实际天数","description":"跟随接口返回","recommended":true},{"id":"seven","label":"固定七天"}]},{"id":"api","kind":"attachment","title":"请提供接口定义","description":"可添加 swagger 或源文件，也可稍后提供。"}],"defaults":["先保留现有界面风格"]}
\`\`\`
choice 每题提供 2–4 个互斥选项，最多一个 recommended:true；推荐只会预选，必须等用户点击提交才视为确认。每题界面自动提供自定义输入，无需生成“其他”选项。attachment 会显示添加材料和稍后提供，不要要求用户填写文件路径来假装读取。id 为简短英文字母/数字/下划线/连字符。不要使用卡片请求密码、密钥等凭据。一般聊天或已能直接完成的请求正常回复，不要输出卡片。用户提交答案后依据已确认选项继续，不要再重复同一轮问题。`;
const marker = '```ailo-questions';
const string = (v, max) => typeof v === 'string' && v.trim().length > 0 && v.length <= max;
const id = v => typeof v === 'string' && !v.startsWith('__') && /^[a-zA-Z0-9_-]{1,40}$/.test(v);
export function validateClarification(value) {
  if (!value || !string(value.title, 100) || !Array.isArray(value.questions) || value.questions.length < 1 || value.questions.length > 3) return undefined;
  const ids = new Set(), questions = [];
  for (const q of value.questions) {
    if (!q || !id(q.id) || ids.has(q.id) || !string(q.title, 300) || !['choice','attachment'].includes(q.kind) || (q.description !== undefined && !string(q.description, 500))) return undefined;
    ids.add(q.id);
    const question = { id:q.id, kind:q.kind, title:q.title, ...(q.description ? {description:q.description} : {}) };
    if (q.kind === 'choice') {
      if (!Array.isArray(q.options) || q.options.length < 2 || q.options.length > 4) return undefined;
      const options = new Set(); let recommendations = 0;
      question.options = [];
      for (const o of q.options) {
        if (!o || !id(o.id) || options.has(o.id) || !string(o.label,120) || (o.description !== undefined && !string(o.description,300)) || (o.recommended !== undefined && typeof o.recommended !== 'boolean')) return undefined;
        options.add(o.id); if (o.recommended) recommendations++;
        question.options.push({id:o.id,label:o.label,...(o.description ? {description:o.description} : {}),recommended:!!o.recommended});
      }
      if (recommendations > 1) return undefined;
    }
    questions.push(question);
  }
  if (value.defaults !== undefined && (!Array.isArray(value.defaults) || value.defaults.length > 8 || value.defaults.some(d => !string(d,300)))) return undefined;
  return { title:value.title, questions, defaults:value.defaults || [] };
}
export function parseClarification(content) {
  const start = content.indexOf(marker);
  if (start < 0 || (start > 0 && content[start-1] !== '\n')) return {content};
  const tail = content.slice(start);
  const match = /^```ailo-questions\s*\n([\s\S]*?)\n```\s*$/.exec(tail);
  if (!match || match[1].length > 16000) return {content};
  try {
    const clarification = validateClarification(JSON.parse(match[1]));
    return clarification ? {content:content.slice(0,start).trim() || '请确认以下问题后继续。',clarification} : {content};
  } catch { return {content}; }
}
// Avoid flashing an unfinished protocol block during streaming. Invalid blocks
// remain available as normal text once the final reply is received.
export function visibleReply(content) {
  const start = content.indexOf(marker);
  if (start >= 0 && (start === 0 || content[start-1] === '\n')) return content.slice(0,start).trimEnd();
  for (let n = marker.length - 1; n > 0; n--) {
    if (content.endsWith(marker.slice(0,n)) && (content.length === n || content[content.length-n-1] === '\n')) return content.slice(0,-n).trimEnd();
  }
  return content;
}
export function questionContext(clarification) {
  const valid = validateClarification(clarification);
  return valid ? `\n\n${marker}\n${JSON.stringify(valid)}\n\`\`\`` : '';
}
export function formatAnswers(clarification, answers) {
  const valid = validateClarification(clarification);
  if (!valid || !Array.isArray(answers) || answers.length !== valid.questions.length) throw Error('请完成每个问题后再提交。');
  const lines = valid.questions.map(q => {
    const answer = answers.find(a => a.questionId === q.id);
    if (!answer || !string(answer.answer,3000)) throw Error('请完成每个问题后再提交。');
    return `${q.title}\n答：${answer.answer.trim()}`;
  });
  return `我对「${valid.title}」的回答：\n\n${lines.join('\n\n')}\n\n请依据以上回答继续；“稍后提供”的材料仍未提供。`;
}

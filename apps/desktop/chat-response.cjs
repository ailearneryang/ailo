// Decode OpenAI-compatible SSE without exposing provider errors or reasoning text.
async function readCompletion(response, { signal, onActivity, onText, onThinking, onToolActivity }) {
  const reader = response.body?.getReader();
  if (!reader) throw Error('模型未返回内容，请重试。');
  const streaming = /text\/event-stream/i.test(response.headers.get('content-type') || '');
  const decoder = new TextDecoder();
  const calls = new Map();
  let buffer = '', content = '', usage, finish, doneEvent = false, size = 0, reasoningChars = 0, completionTokens, reasoningTokens;
  const abort = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', abort, { once: true });
  const textOf = value => typeof value === 'string' ? value : Array.isArray(value) ? value.filter(x => x.type === 'text' && typeof x.text === 'string').map(x => x.text).join('') : '';
  function consume(data) {
    if (data.trim() === '[DONE]') { doneEvent = true; return; }
    let result;
    try { result = JSON.parse(data); } catch { throw Error('服务未返回有效的 JSON，请确认使用 OpenAI 兼容接口。'); }
    if (result.error) throw Error('模型服务在生成过程中返回错误，请稍后重试。');
    if (Number.isSafeInteger(result.usage?.prompt_tokens) && result.usage.prompt_tokens >= 0) usage = result.usage.prompt_tokens;
    if(Number.isSafeInteger(result.usage?.completion_tokens))completionTokens=result.usage.completion_tokens;
    if(Number.isSafeInteger(result.usage?.completion_tokens_details?.reasoning_tokens))reasoningTokens=result.usage.completion_tokens_details.reasoning_tokens;
    const choice = result.choices?.find(c => c.index === 0) || result.choices?.[0];
    if (!choice) return;
    if (choice.finish_reason) finish = choice.finish_reason;
    const message = streaming ? choice.delta : choice.message;
    for (const [position, call] of (message?.tool_calls || []).entries()) {
      const index = streaming ? call.index : position;
      if (!Number.isInteger(index) || index < 0 || index > 7) throw Error('模型工具调用序号无效。');
      const current = calls.get(index) || {id:'',type:'function',function:{name:'',arguments:''}};
      if (call.type && call.type !== 'function') throw Error('模型返回了不支持的工具类型。');
      // Providers may repeat complete metadata on every delta. Arguments remain
      // true deltas: repeated argument text must never be silently discarded.
      const metadata=(previous,next)=>!next||next===previous?previous:next.startsWith(previous)?next:previous+next;
      if (typeof call.id==='string') current.id=metadata(current.id,call.id);
      if (typeof call.function?.name === 'string') current.function.name=metadata(current.function.name,call.function.name);
      if (typeof call.function?.arguments === 'string') current.function.arguments += call.function.arguments;
      const diagnostics={toolArgumentChars:current.function.arguments.length,toolNameChars:current.function.name.length,toolIdChars:current.id.length,argumentLimit:250000};
      if(current.function.name.length>200||current.id.length>1000)throw Object.assign(Error('模型工具元数据无效，请重试。'),{code:'AGENT_PROTOCOL',reason:'tool_metadata_too_long',diagnostics});
      if(current.function.arguments.length>250000)throw Object.assign(Error('单次工具参数超过 250000 字符，请拆分为更小的动作。'),{code:'MODEL_TOOL_ARGUMENT_LIMIT',diagnostics});
      calls.set(index,current);
      onActivity(); onToolActivity?.();
    }
    const text = textOf(message?.content);
    if (text) {
      content += text;
      if (content.length > 250000) throw Error('模型回复过长，请缩小问题范围后重试。');
      onActivity(); onText?.(content);
    } else if (message?.reasoning_content || message?.reasoning) {
      reasoningChars += textOf(message.reasoning_content || message.reasoning).length;
      onActivity(); onThinking?.(reasoningChars);
    }
  }
  function events(final = false) {
    let match;
    while ((match = /\r?\n\r?\n/.exec(buffer))) {
      const frame = buffer.slice(0, match.index);
      buffer = buffer.slice(match.index + match[0].length);
      const data = frame.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).replace(/^ /, '')).join('\n');
      if (data) consume(data);
      if (doneEvent) return;
    }
    if (final && buffer.trim()) throw Error('模型回复流意外中断，请重试。');
  }
  try {
    if (signal.aborted) throw Error('aborted');
    while (!doneEvent) {
      const { value, done } = await reader.read();
      if (signal.aborted) throw Error('aborted');
      if (done) break;
      size += value.byteLength;
      if (size > 8388608) throw Error('模型回复过长，请缩小问题范围后重试。');
      buffer += decoder.decode(value, { stream: true });
      if (streaming) events();
    }
    buffer += decoder.decode();
    if (streaming) {
      if (!doneEvent) events(true);
      if (!doneEvent && !finish) throw Error('模型回复流意外中断，请重试。');
    } else consume(buffer);
    if (finish === 'content_filter') throw Object.assign(Error('模型服务过滤了本次响应，未执行动作。请检查输入或服务商策略。'),{code:'MODEL_CONTENT_FILTER'});
    if (finish === 'length') throw Object.assign(Error('模型输出达到长度上限，请要求更简短的回复后重试。'), { code: 'MODEL_OUTPUT_LIMIT', partialContent: content, diagnostics:{finishReason:finish,promptTokens:usage,completionTokens,reasoningTokens,reasoningChars,contentChars:content.length,toolCalls:calls.size,toolArgumentChars:[...calls.values()].reduce((n,c)=>n+c.function.arguments.length,0)} });
    if (!content.trim() && !calls.size) throw Object.assign(Error(reasoningChars ? '模型只返回了思考数据，没有返回正文或可执行动作。任务和材料已保留，可重试。' : '模型本次返回空响应，没有正文或可执行动作。任务和材料已保留，可重试。'),{code:'MODEL_EMPTY_RESPONSE',diagnostics:{finishReason:finish||'missing',promptTokens:usage,completionTokens,reasoningTokens,reasoningChars,contentChars:content.length,toolCalls:0}});
    return { content, usage, providerUsage:{inputTokens:usage,outputTokens:completionTokens,reasoningTokens}, ...(calls.size ? {toolCalls:[...calls.entries()].sort((a,b)=>a[0]-b[0]).map(([,call])=>call)} : {}) };
  } finally {
    signal.removeEventListener('abort', abort);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
module.exports = { readCompletion };

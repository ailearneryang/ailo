const { selectedExtensions } = require("./extensions.cjs");
// Requests run in the main process. Credentials never enter the renderer.
function createChat(storage, fetchImpl = fetch, timeouts = {}) {
  const { readCompletion } = require("./chat-response.cjs");
  const limits = typeof timeouts === "number" ? { first: timeouts, idle: timeouts, text: timeouts, decision: timeouts, total: timeouts * 10 } : { first: 180000, idle: 90000, text: 180000, decision: 600000, total: 900000, ...timeouts };
  const pending = new Map();
  const scheduler=require('./chat-scheduler.cjs').createScheduler(3);
  const steering = new Map();
  return {
    sessions(){return [...steering.entries()].map(([id,s])=>({id,taskId:s.taskId,status:s.status||'等待执行…',content:s.content||''}));},
    async steer({id, taskId, content}) {
      const session=steering.get(id);
      if(!session || session.taskId!==taskId || !session.accepting || pending.get(id)?.signal.aborted)throw Error('当前任务已停止，请作为新消息发送。');
      if(typeof content!=='string'||!content.trim()||content.length>20000)throw Error('补充指令须为 1–20000 字符');
      const message={id:require('node:crypto').randomUUID(),role:'user',content:content.trim()};
      const save=session.saving.then(async()=>{
        const state=await storage.readWorkspace();
        const task=state.tasks.find(t=>t.id===taskId);
        if(!task)throw Error('任务不存在');
        task.messages=[...(task.messages||[{role:'user',content:task.request}]),message];
        if(storage.patchTask)await storage.patchTask(taskId,{},[message]);
        else await storage.saveWorkspace(state);
        session.queue.push(message);
      });
      session.saving=save.catch(()=>{});
      await save;return message;
    },
    cancel(id) {
      pending.get(id)?.abort();
    },
    cancelAll() { for (const controller of pending.values()) controller.abort(); },
    async complete(input) {
      if (
        !input ||
        typeof input.id !== "string" ||
        typeof input.modelId !== "string" ||
        !Array.isArray(input.messages) ||
        !input.messages.length ||
        input.messages.length > 10000 ||
        JSON.stringify(input.messages).length > 1000000 ||
        input.messages.some(
          (m) =>
            !m ||
            !["user", "assistant"].includes(m.role) ||
            typeof m.content !== "string" ||
            !m.content.trim(),
        )
      )
        throw Error("对话内容无效或过长，请新建对话。");
      if (pending.has(input.id)||[...steering.values()].some(s=>s.taskId && s.taskId===input.taskId)) throw Error('此会话正在执行或排队，请补充消息或等待完成。');
      const controller = new AbortController();
      pending.set(input.id, controller);
      const session={taskId:input.taskId,queue:[],saving:Promise.resolve(),accepting:false};
      steering.set(input.id,session);
      const callbacks=input;
      input={...input,onStatus:message=>{session.status=message;callbacks.onStatus?.(message);},onText:content=>{session.content=content;callbacks.onText?.(content);}};
      let timeoutMessage = "";
      let timer, totalTimer, textTimer;
      let replyStartedAt;
      let phase = "连接模型服务";
      function armTimer(ms, reason) {
        clearTimeout(timer);
        timer = setTimeout(() => {
          timeoutMessage = `${phase}超时：${reason}（${Math.round(ms / 1000)} 秒）。可以重试或检查模型服务。`;
          controller.abort();
        }, ms);
      }
      let release;
      try {
        const schedulingState=input.taskId && storage.readWorkspace ? await storage.readWorkspace() : {tasks:[]};
        const schedulingTask=schedulingState.tasks?.find(t=>t.id===input.taskId);
        release=await scheduler.acquire(schedulingTask?.projectId || input.taskId || input.id,controller.signal,input.onStatus);
        input.onStatus?.('正在执行…');
        armTimer(limits.first, "未收到模型内容");
        const selected = input.extensionIds?.length ? selectedExtensions((await storage.readWorkspace()).extensions || [], input.extensionIds) : [];
        const model = await storage.modelCredentials(input.modelId);
        const url = new URL(model.baseUrl);
        if (
          url.username ||
          url.password ||
          url.search ||
          url.hash ||
          (url.protocol !== "https:" &&
            !(
              url.protocol === "http:" &&
              ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
            ))
        )
          throw Error("模型 API 地址无效，请检查配置。");
        if (!url.pathname.replace(/\/$/, "").endsWith("/chat/completions"))
          url.pathname = url.pathname.replace(/\/$/, "") + "/chat/completions";
        async function ask(messages, maxTokens, showReply = false, prefix = "", requestPhase, format = {}) {
          if (controller.signal.aborted) throw Error("已停止回复。");
          phase = requestPhase || (showReply ? "等待模型回复" : "整理历史");
          const startedAt = Date.now();
          if (showReply) replyStartedAt ??= startedAt;
          const isDecision = requestPhase === '任务决策';
          const outputWait = isDecision ? limits.decision : limits.text;
          let hasText = false, lastThinkingStatus = -Infinity;
          // Reasoning deltas count as network activity, but must not postpone
          // visible output forever. Empty-output retries share this deadline.
          const textStartedAt = showReply && !prefix ? replyStartedAt : startedAt;
          textTimer = setTimeout(() => {
            timeoutMessage = isDecision
              ? `任务决策超时：${Math.round(outputWait / 1000)} 秒内未开始返回下一步动作。任务进度、项目文件和材料已保留，可重试当前步骤。`
              : `${phase}超时：${Math.round(outputWait / 1000)} 秒内未生成正文（思考数据不算正文）。可重试或切换模型；原始对话和材料已保留。`;
            controller.abort();
          }, Math.max(0, outputWait - (Date.now() - textStartedAt)));
          armTimer(limits.first, "未收到模型内容");
          clearTimeout(totalTimer);
          totalTimer = setTimeout(() => {
            timeoutMessage = `${phase}超时：已达到单次请求最长等待时间（${Math.round(limits.total / 60000)} 分钟）。`;
            controller.abort();
          }, limits.total);
          try {
          const response = await fetchImpl(url, {
            method: "POST",
            redirect: "error",
            signal: controller.signal,
            headers: {
              "Content-Type": "application/json",
              ...(model.apiKey
                ? { Authorization: `Bearer ${model.apiKey}` }
                : {}),
            },
            body: JSON.stringify({
              model: model.model,
              stream: true,
              max_tokens: Math.min(maxTokens,model.maxOutputTokens || maxTokens),
              messages,
              ...format,
            }),
          }).catch(error=>{throw require('./network-error.cjs').networkError(error,true);});
          if (!response.ok) {
            if ([400,422].includes(response.status) && (format.tools || format.response_format)) {
              let detail = '';
              const reader = response.body?.getReader();
              try {
                while (reader && detail.length < 8192) {
                  const {value,done} = await reader.read();
                  if (done) break;
                  detail += new TextDecoder().decode(value).slice(0,8192-detail.length);
                }
              } finally { await reader?.cancel().catch(()=>{}); reader?.releaseLock(); }
              if(format.parallel_tool_calls===false && /parallel_tool_calls/i.test(detail) && /not.support|unsupported|not.allowed|unknown|unrecognized|不支持/i.test(detail))
                throw Object.assign(Error('模型接口不支持并行动作开关。'),{code:'MODEL_PARALLEL_UNSUPPORTED'});
              const feature = format.tools ? /tools|tool_choice|function.call/i : /response_format|json_object/i;
              if (feature.test(detail) && /not.support|unsupported|not.allowed|unknown|unrecognized|不支持/i.test(detail))
                throw Object.assign(Error('模型接口不支持所请求的结构化能力。'),{code:'MODEL_FORMAT_UNSUPPORTED'});
            }
            await response.body?.cancel();
            const messages = {
              401: "API Key 无效或已过期，请检查模型配置。",
              403: "服务商拒绝访问，请检查密钥权限和模型权限。",
              404: "未找到接口或模型，请检查 API 地址和模型 ID。",
              429: "请求限流或额度不足，请稍后重试并检查服务商额度。",
            };
            throw Error(
              messages[response.status] ||
                `模型服务返回错误（HTTP ${response.status}），请稍后重试。`,
            );
          }
          return await readCompletion(response, {
            signal: controller.signal,
            onActivity: () => armTimer(limits.idle, "模型内容已停止更新"),
            onToolActivity: () => {
              hasText = true; clearTimeout(textTimer);
              if (isDecision && Date.now()-lastThinkingStatus>=1000) {
                lastThinkingStatus=Date.now();
                input.onStatus?.('模型正在生成下一步动作，接收完成后执行…');
              }
            },
            onText: (content) => {
              hasText = true;
              clearTimeout(textTimer);
              if (showReply) input.onText?.(prefix + content);
            },
            onThinking: showReply || isDecision ? (chars) => {
              const now = Date.now();
              if (hasText || now - lastThinkingStatus < 1000) return;
              lastThinkingStatus = now;
              if(isDecision) { input.onStatus?.(`正在决定下一步 · 模型仍在思考 · 已等待 ${Math.floor((now-startedAt)/1000)} 秒（最长 ${Math.round(outputWait/60000)} 分钟）`); return; }
              input.onStatus?.(`模型正在思考 · 已等待 ${Math.floor((now - replyStartedAt) / 1000)} 秒 · 已收到 ${chars.toLocaleString()} 字思考数据，尚未生成正文…`);
            } : undefined,
          });
          } finally {
            clearTimeout(timer);
            clearTimeout(totalTimer);
            clearTimeout(textTimer);
          }
        }
        const { parseClarification } = await import("./clarification.mjs");
        if (storage.agentDirectory && input.taskId) {
          const state = await storage.readWorkspace();
          const task = state.tasks.find(t => t.id === input.taskId);
          if (!task) throw Error("任务不存在。");
          const { runAgent } = require("./agent/runner.cjs");
          const { tool,allowedActions } = require("./agent/protocol.cjs");
          let formatMode = 'tools', parallelControl = true;
          async function askAgent(messages,budget,onContext) {
            const state=JSON.parse(messages.at(-1).content);
            const currentTool=structuredClone(tool);
            currentTool.function.parameters.properties.action.enum=allowedActions(state);
            for (;;) {
              const format = formatMode === 'tools' ? {tools:[currentTool],tool_choice:{type:'function',function:{name:'ailo_action'}},...(parallelControl?{parallel_tool_calls:false}:{})}
                : formatMode === 'json' ? {response_format:{type:'json_object'}} : {};
              const instructions = formatMode === 'tools'
                ? '\n本次通过 ailo_action 原生工具调用提交动作，参数对应上述 action 协议，不要在 content 中输出动作或代码。'
                : '\n本次接口采用兼容模式，只返回一个合法 JSON 动作对象。';
              const wireMessages=[{...messages[0],content:messages[0].content+instructions},...messages.slice(1)];
              const {requestContextUsage}=await import('./context.mjs');
              const stats={...requestContextUsage(wireMessages,format,model,Math.min(budget,model.maxOutputTokens||budget)),requestId:require('node:crypto').randomUUID()};
              await onContext?.(stats);
              try {
                const result=await ask(wireMessages,budget,false,"","任务决策",format);
                await onContext?.({...stats,status:'completed',completedAt:new Date().toISOString(),providerUsage:result.providerUsage});
                return result;
              }
              catch(error) {
                const d=error.diagnostics;
                const providerUsage=d?{inputTokens:d.promptTokens,outputTokens:d.completionTokens,reasoningTokens:d.reasoningTokens}:undefined;
                await onContext?.({...stats,status:'failed',completedAt:new Date().toISOString(),providerUsage});
                if(error.code==='MODEL_PARALLEL_UNSUPPORTED' && parallelControl){parallelControl=false;continue;}
                if (error.code !== 'MODEL_FORMAT_UNSUPPORTED' || formatMode === 'text') throw error;
                formatMode = formatMode === 'tools' ? 'json' : 'text';
                input.onStatus?.('正在适配模型接口，请稍候…');
              }
            }
          }
          session.accepting=true;
          const result = await runAgent({ getSteering:async()=>{await session.saving;return session.queue.splice(0);}, base: storage.agentDirectory, task, model, webSearch:input.searchEnabled===true?storage.webSearch:undefined, android:storage.androidManager, authorizeBuild:storage.authorizeBuild,feishuCli:input.feishuEnabled===false?{execute:async()=>{throw Object.assign(Error('当前对话已关闭飞书，请在输入框 ＋ → 应用连接中开启后再试。'),{code:'FEISHU_DECLINED'});}}:storage.feishuCli,
            signal: controller.signal, ask: askAgent, extensions: selected,
            onStatus: input.onStatus, onRun: input.onRun });
          return { ...result, modelName: model.name };
        }
        const { prepareContext, countMessages, capacity } = await import("./context.mjs");
        const prepared = await prepareContext(input.messages, selected, model, input.contextCheckpoint, async (messages, budget, { attempt }) => {
          input.onStatus?.(attempt ? `正在自动调整摘要长度并重试（${attempt + 1}/3）…` : "正在整理较早对话，保留关键信息…");
          try { return (await ask(messages, budget)).content; }
          catch (error) {
            if (error.code === "MODEL_OUTPUT_LIMIT") throw error;
            throw Error("整理历史失败，原始记录已保留。" + error.message);
          }
        });
        if (controller.signal.aborted) throw Error("已停止回复。");
        if (prepared.compacted && input.taskId && storage.saveContextCheckpoint)
          await storage.saveContextCheckpoint(input.taskId, prepared.checkpoint);
        input.onStatus?.(prepared.compacted ? "历史已整理，正在等待模型回复…" : "正在等待模型回复…");
        let accumulated = "";
        for (let attempt = 0; attempt < 3; attempt++) {
          const messages = accumulated ? [...prepared.messages,
            { role: "assistant", content: accumulated },
            { role: "user", content: "上一条回复因输出长度限制中断。请紧接末尾继续，只输出剩余内容，不重复已有内容，不加开场白；尽量简洁地完成答案。" },
          ] : prepared.messages;
          const available = capacity(model) - countMessages(messages) - 128;
          if (available < 256) throw Error("回复尚未完成，剩余上下文不足以继续。已保留收到的正文，请分段提问或选择更大容量的模型。");
          const budget = Math.min(available, Math.max(prepared.reserve, Math.min(16384, 8192 * (2 ** attempt))));
          try {
            const result = await ask(messages, budget, true, accumulated);
            const content = accumulated + result.content;
            if (content.length > 250000) throw Error("累计回复过长，请分段提问。");
            return { ...parseClarification(content), modelName: model.name, contextCheckpoint: prepared.checkpoint, promptTokens: result.usage };
          } catch (error) {
            if (error.code !== "MODEL_OUTPUT_LIMIT") throw error;
            accumulated += error.partialContent || "";
            if (accumulated.length > 250000) throw Error("累计回复过长，请分段提问。");
            if (attempt === 2) throw Object.assign(Error("已自动续写或调整额度 2 次，回复仍达到输出上限。已收到的正文会保留，请分段提问或换用其他模型。"), { code: "MODEL_OUTPUT_LIMIT" });
            input.onStatus?.(accumulated ? "回复达到单次输出上限，正在自动续写…" : "模型尚未生成正文，正在增加生成额度重试…");
          }
        }
      } catch (error) {
        if (controller.signal.aborted)
          throw Error(
            timeoutMessage
              ? timeoutMessage
              : "已停止回复，可重新发送。",
          );
        throw require('./network-error.cjs').networkError(error);
      } finally {
        clearTimeout(timer);
        clearTimeout(totalTimer);
        clearTimeout(textTimer);
        session.accepting=false;
        await session.saving;
        steering.delete(input.id);
        pending.delete(input.id);
        release?.();
      }
    },
  };
}
module.exports = { createChat };

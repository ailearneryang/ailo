const {reasoningParameters} = require("./reasoning.cjs");
const { selectedExtensions } = require("./extensions.cjs");
// Requests run in the main process. Credentials never enter the renderer.
function createChat(storage, fetchImpl = fetch, timeouts = {}) {
  const { readCompletion } = require("./chat-response.cjs");
  const {abortable,recoverRequest,requestId,cancelBody}=require('./model-request.cjs');
  const limits = typeof timeouts === "number" ? { connect: timeouts, headerStep:0, retryDelay:0, first: timeouts, idle: timeouts, text: timeouts, decision: timeouts, total: timeouts * 10 } : { connect:60000, headerStep:timeouts.connect===undefined?30000:0, first:60000, retries:2, retryDelay:500, idle: 90000, text: 180000, decision: 600000, total: 900000, ...timeouts };
  const pending = new Map();
  const scheduler=require('./chat-scheduler.cjs').createScheduler(3);
  const steering = new Map();
  return {
    sessions(){return [...steering.entries()].map(([id,s])=>({id,taskId:s.taskId,status:s.status||'等待执行…',content:s.content||'',updatedAt:s.updatedAt,startedAt:s.startedAt,inputId:s.inputId,phase:s.phase,run:s.run}));},
    async steer({id, taskId, content}) {
      const session=steering.get(id);
      if(!session || session.taskId!==taskId || !session.accepting || pending.get(id)?.signal.aborted)throw Error('当前任务已停止，请作为新消息发送。');
      if(typeof content!=='string'||!content.trim()||content.length>20000)throw Error('补充指令须为 1–20000 字符');
      const message={id:require('node:crypto').randomUUID(),role:'user',content:content.trim(),createdAt:new Date().toISOString()};
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
      // Reserve synchronously so a stop immediately after complete() is not lost
      // while loading attachment validation or credentials.
      if(!input||typeof input.id!=="string")throw Error("对话内容无效或过长，请新建对话。");
      if (pending.has(input.id)||[...steering.values()].some(s=>s.taskId && s.taskId===input.taskId)) throw Error('此会话正在执行或排队，请补充消息或等待完成。');
      const controller = new AbortController();
      pending.set(input.id, controller);
      const session={taskId:input.taskId,startedAt:new Date().toISOString(),phase:'preparing',queue:[],saving:Promise.resolve(),accepting:false};
      steering.set(input.id,session);
      const callbacks=input;
      input={...input,onStatus:message=>{session.status=message;session.updatedAt=new Date().toISOString();if(message.startsWith('等待执行'))session.phase='queued';callbacks.onStatus?.(message);},onText:content=>{session.content=content;session.updatedAt=new Date().toISOString();callbacks.onText?.(content);}};
      let timeoutMessage = "", timeoutCode;
      let timer, totalTimer, textTimer;
      let replyStartedAt;
      let phase = "连接模型服务";
      function armTimer(ms, onTimeout) {
        clearTimeout(timer);
        timer = setTimeout(onTimeout, ms);
      }
      let release,executionStarted,executionExtensions=[],requestUsage=true;
      try {
        const {hasMessageContent}=await import('./attachments.mjs');
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
              !hasMessageContent(m.content,m.role==='user'?m.materials:[]),
          )
        )
          throw Error("对话内容无效或过长，请新建对话。");
        const schedulingState=input.taskId && storage.readWorkspace ? await storage.readWorkspace() : {tasks:[]};
        const schedulingTask=schedulingState.tasks?.find(t=>t.id===input.taskId);session.inputId=schedulingTask?.messages?.findLast(m=>m.role==='user')?.id;
        release=await scheduler.acquire(schedulingTask?.projectId || (schedulingTask?.scheduledTaskId?'schedule:'+schedulingTask.scheduledTaskId:input.taskId) || input.id,controller.signal,input.onStatus);
        executionStarted=Date.now();session.phase='preparing';
        input.onStatus?.('正在执行…');
        const selected = input.extensionIds?.length ? selectedExtensions((await storage.readWorkspace()).extensions || [], input.extensionIds) : [];
        executionExtensions=selected;
        const model = await storage.modelCredentials(input.modelId);
        const reasoning = reasoningParameters(model,input.reasoningEffort);
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
        async function askOnce(messages, maxTokens, showReply = false, prefix = "", requestPhase, format = {}, attempt=0) {
          if (controller.signal.aborted) throw Error("已停止回复。");
          phase = requestPhase || (showReply ? "等待模型回复" : "整理历史");
          const startedAt = Date.now();
          if (showReply) replyStartedAt ??= startedAt;
          const isDecision = requestPhase === '任务决策';
          // An idle decision aborts only its request, leaving the task available
          // for recovery. User cancellation still aborts every request.
          const requestController = new AbortController();
          const cancelRequest = () => requestController.abort();
          controller.signal.addEventListener('abort', cancelRequest, {once:true});
          let requestFailure;
          const diagnostic={id:require('node:crypto').randomUUID(),modelId:input.modelId,taskId:input.taskId,attempt,phase,startedAt:new Date(startedAt).toISOString(),transport:fetchImpl.transport||'node-fetch',chunks:0,bytes:0,maxChunkGapMs:0};
          let lastChunkAt;
          let proxyTimer;
          const networkContext=Promise.race([Promise.resolve().then(()=>storage.modelNetworkContext?.(url)).catch(()=>undefined),new Promise(resolve=>{proxyTimer=setTimeout(()=>resolve(undefined),250);})]).then(context=>{clearTimeout(proxyTimer);if(['direct','configured','unknown'].includes(context?.systemProxyMode))diagnostic.systemProxyMode=context.systemProxyMode;});
          const requestTimeout=(code,message)=>{requestFailure=Object.assign(Error(message),{code});requestController.abort(requestFailure);};
          const outputWait = isDecision ? limits.decision : limits.text;
          let hasText = false, lastThinkingStatus = -Infinity;
          // Reasoning deltas count as network activity, but must not postpone
          // visible output forever. Empty-output retries share this deadline.
          const textStartedAt = showReply && !prefix ? replyStartedAt : startedAt;
          textTimer = setTimeout(() => {
            timeoutMessage = isDecision
              ? `任务决策超时：${Math.round(outputWait / 1000)} 秒内未开始返回下一步动作。任务进度、项目文件和材料已保留，可重试当前步骤。`
              : `${phase}超时：${Math.round(outputWait / 1000)} 秒内未生成正文（思考数据不算正文）。可重试或切换模型；原始对话和材料已保留。`;
            timeoutCode='MODEL_OUTPUT_TIMEOUT';controller.abort();
          }, Math.max(0, outputWait - (Date.now() - textStartedAt)));
          // Response headers can be delayed by gateway queueing or model prefill;
          // this is not a TCP/TLS connection timer. Retries allow more queue time.
          const headerWait=Math.min(limits.connect+attempt*limits.headerStep,Math.max(limits.connect,120000));
          diagnostic.responseHeadersTimeoutMs=headerWait;
          armTimer(headerWait,()=>{diagnostic.timeoutStage='response_headers';requestTimeout('MODEL_CONNECT_TIMEOUT',`${phase}超时：模型服务尚未返回响应头（已等待 ${Math.round(headerWait/1000)} 秒，可能仍在排队或处理上下文）。`);});
          clearTimeout(totalTimer);
          totalTimer = setTimeout(() => {
            timeoutMessage = `${phase}超时：已达到单次请求最长等待时间（${Math.round(limits.total / 60000)} 分钟）。`;
            timeoutCode='MODEL_TOTAL_TIMEOUT';controller.abort();
          }, limits.total);
          try {
          const requestBody=JSON.stringify({model:model.model,stream:true,max_tokens:Math.min(maxTokens,model.maxOutputTokens||maxTokens),messages,...format,...reasoning,...(requestUsage?{stream_options:{include_usage:true}}:{})});
          diagnostic.requestBytes=Buffer.byteLength(requestBody);
          diagnostic.messageCount=messages.length;
          diagnostic.requestedOutputTokens=Math.min(maxTokens,model.maxOutputTokens||maxTokens);
          const response = await abortable(fetchImpl(url, {
            method: "POST",
            redirect: "error",
            signal: requestController.signal,
            headers: {
              "Content-Type": "application/json",
              "X-Ailo-Request-Id": diagnostic.id,
              ...(model.apiKey
                ? { Authorization: `Bearer ${model.apiKey}` }
                : {}),
            },
            body: requestBody,
          }),requestController.signal,response=>response.body?.cancel()).catch(error=>{throw require('./network-error.cjs').networkError(error,true);});
          diagnostic.headersMs=Date.now()-startedAt;diagnostic.providerRequestId=requestId(response.headers);diagnostic.httpStatus=response.status;
          if(model.apiKey&&diagnostic.providerRequestId?.includes(model.apiKey))delete diagnostic.providerRequestId;
          armTimer(limits.first,()=>requestTimeout('MODEL_FIRST_CONTENT_TIMEOUT',`${phase}超时：未收到模型内容（${Math.round(limits.first/1000)} 秒；已收到响应头）。`));
          if (!response.ok) {
            if ([400,422].includes(response.status) && (format.tools || format.response_format || requestUsage)) {
              let detail = '';
              const reader = response.body?.getReader();
              try {
                while (reader && detail.length < 8192) {
                  const {value,done} = await abortable(reader.read(),requestController.signal);
                  if (done) break;
                  detail += new TextDecoder().decode(value).slice(0,8192-detail.length);
                }
              } finally { await cancelBody(reader); try{reader?.releaseLock();}catch{} }
              if(requestUsage && /stream_options|include_usage/i.test(detail) && /not.support|unsupported|not.allowed|unknown|unrecognized|unexpected|not.permitted|不支持/i.test(detail))throw Object.assign(Error('模型接口不支持流式用量统计。'),{code:'MODEL_USAGE_UNSUPPORTED'});
              if(format.parallel_tool_calls===false && /parallel_tool_calls/i.test(detail) && /not.support|unsupported|not.allowed|unknown|unrecognized|不支持/i.test(detail))
                throw Object.assign(Error('模型接口不支持并行动作开关。'),{code:'MODEL_PARALLEL_UNSUPPORTED'});
              const feature = format.tools ? /tools|tool_choice|function.call/i : /response_format|json_object/i;
              if (feature.test(detail) && /not.support|unsupported|not.allowed|unknown|unrecognized|不支持/i.test(detail))
                throw Object.assign(Error('模型接口不支持所请求的结构化能力。'),{code:'MODEL_FORMAT_UNSUPPORTED'});
            }
            await cancelBody(response.body);
            const messages = {
              401: "API Key 无效或已过期，请检查模型配置。",
              403: "服务商拒绝访问，请检查密钥权限和模型权限。",
              404: "未找到接口或模型，请检查 API 地址和模型 ID。",
              429: "请求限流或额度不足，请稍后重试并检查服务商额度。",
            };
            throw Object.assign(Error(
              messages[response.status] ||
                `模型服务返回错误（HTTP ${response.status}），请稍后重试。`,
            ),{code:[502,503,504].includes(response.status)?'MODEL_HTTP_TRANSIENT':'MODEL_HTTP_ERROR'});
          }
          const result=await readCompletion(response, {
            signal: requestController.signal,
            onChunk: bytes=>{const now=Date.now();diagnostic.chunks++;diagnostic.bytes+=bytes;if(lastChunkAt!==undefined)diagnostic.maxChunkGapMs=Math.max(diagnostic.maxChunkGapMs,now-lastChunkAt);lastChunkAt=now;diagnostic.firstByteMs??=now-startedAt;},
            onCleanup: cancelled=>{diagnostic.streamCancelled=cancelled;},
            onActivity: () => {diagnostic.firstContentMs??=Date.now()-startedAt;armTimer(limits.idle,()=>requestTimeout(isDecision?'MODEL_DECISION_IDLE_TIMEOUT':'MODEL_STREAM_IDLE_TIMEOUT',`${phase}超时：模型内容已停止更新（${Math.round(limits.idle/1000)} 秒）。`));},
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
          diagnostic.providerUsage=result.providerUsage;diagnostic.outcome='completed';return result;
          } catch (error) {
            diagnostic.providerUsage=error.providerUsage;
            const failure=requestFailure||require('./network-error.cjs').networkError(error);
            failure.hasVisibleOutput=showReply&&hasText;
            if(showReply&&error.partialContent)failure.partialContent=(error.code==='MODEL_OUTPUT_LIMIT'?'':prefix)+error.partialContent;
            else delete failure.partialContent;
            diagnostic.outcome=controller.signal.aborted?'cancelled':'failed';diagnostic.errorCode=controller.signal.aborted?(timeoutCode||'MODEL_CANCELLED'):(failure.code||'MODEL_RESPONSE_ERROR');
            if(failure.networkCode)diagnostic.networkCode=failure.networkCode;
            failure.requestDiagnostics=diagnostic;
            if(diagnostic.providerRequestId)failure.message+=` 请求标识：${diagnostic.providerRequestId}。`;
            throw failure;
          } finally {
            diagnostic.abortRequested=true;
            requestController.abort();
            diagnostic.durationMs=Date.now()-startedAt;
            controller.signal.removeEventListener('abort', cancelRequest);
            clearTimeout(timer);
            clearTimeout(totalTimer);
            clearTimeout(textTimer);
            await networkContext;
            try{await storage.recordModelRequest?.(diagnostic);}catch{}
          }
        }
        async function ask(messages,maxTokens,showReply=false,prefix='',requestPhase,format={}){
          for(;;){try{return await recoverRequest(attempt=>askOnce(messages,maxTokens,showReply,prefix,requestPhase,format,attempt),{signal:controller.signal,retries:limits.retries??2,retryDelay:limits.retryDelay??500,onRetry:(attempt,total)=>input.onStatus?.(`模型响应暂时停顿，正在自动重试当前${requestPhase==='任务决策'?'决策':'请求'}（${attempt}/${total}）…`)});}catch(error){if(error.code==='MODEL_USAGE_UNSUPPORTED'&&requestUsage){requestUsage=false;continue;}throw error;}}
        }
        const { parseClarification } = await import("./clarification.mjs");
        if (storage.agentDirectory && input.taskId && !storage.isTemporary?.(input.taskId) && !schedulingTask?.responseOnly) {
          const state = await storage.readWorkspace();
          let task = state.tasks.find(t => t.id === input.taskId);
          if (!task) throw Error("任务不存在。");
          let memory;
          if(storage.personalMemory){
            const owner=await storage.personalMemory.owner();
            if(!task.memoryOwner&&storage.patchTask)task=await storage.patchTask(task.id,{memoryOwner:owner,memorySince:task.messages?.findLast(m=>m.role==='user')?.createdAt||new Date().toISOString()});
            memory=await storage.personalMemory.scope({task,owner});
          }
          if(storage.permissions&&!task.permissionMode&&storage.patchTask){const policy=await storage.permissions.read(task.id);task=await storage.patchTask(task.id,{permissionMode:policy.currentMode});}
          const scheduledContext=await require('./schedule-context.cjs').prepareScheduleContext(storage.agentDirectory,task,state.tasks||[]);
          const { runAgent } = require("./agent/runner.cjs");
          const { tool,allowedActions,actionTools } = require("./agent/protocol.cjs");
          let formatMode = 'tools', parallelControl = true, namedActions = false;
          async function askAgent(messages,budget,onContext) {
            const state=JSON.parse(messages.at(-1).content);
            if(state.protocolRecovery && formatMode==='tools') {
              if(!namedActions){namedActions=true;input.onStatus?.('正在适配模型动作格式，改用具名工具…');}
              else {formatMode='json';input.onStatus?.('模型未遵循工具格式，正在切换 JSON 动作模式…');}
            }
            const currentTool=structuredClone(tool);
            currentTool.function.parameters.properties.action.enum=allowedActions(state);
            for (;;) {
              const format = formatMode === 'tools' ? {tools:namedActions?actionTools(state):[currentTool],tool_choice:namedActions?'required':{type:'function',function:{name:'ailo_action'}},...(parallelControl?{parallel_tool_calls:false}:{})}
                : formatMode === 'json' ? {response_format:{type:'json_object'}} : {};
              const instructions = formatMode === 'tools'
                ? namedActions ? '\n本次使用具名原生工具（例如 run_command、plan）。直接调用当前提供的一个工具，工具名就是动作，参数无需填写 action；不要调用 ailo_action，不要在 content 中输出动作或代码。' : '\n本次通过 ailo_action 原生工具调用提交动作，参数对应上述 action 协议，不要在 content 中输出动作或代码。'
                : '\n本次接口采用兼容模式，只返回一个合法 JSON 动作对象。';
              const wireState=structuredClone(state);
              if(wireState.protocolRecovery)wireState.protocolRecovery.instruction=formatMode==='tools'
                ? '上次返回未执行。只调用当前提供的一个具名工具，工具名表示动作，参数无需 action。禁止解释文字、工具定义和动作数组。'
                : '上次返回未执行。只返回一个完整 JSON 对象，必须包含字符串 action，取值来自 allowedActions。禁止解释文字、工具定义和动作数组。';
              wireState.responseContract=formatMode==='tools'
                ? {mode:namedActions?'named_tools':'ailo_action',allowedActions:allowedActions(state),instruction:namedActions?'工具名就是动作；只调用一个工具，参数不需要 action。':'只调用 ailo_action，参数必须包含 action。'}
                : {mode:'json',allowedActions:allowedActions(state),instruction:'完整响应必须是一个 JSON 动作对象，必填 action。不要 Markdown 或解释文字。',example:{action:allowedActions(state).includes('route')?'route':'pause',...(allowedActions(state).includes('route')?{kind:'task'}:{text:'任务进度已保留'})}};
              const wireMessages=[{...messages[0],content:messages[0].content+instructions},...messages.slice(1,-1),{...messages.at(-1),content:JSON.stringify(wireState)}];
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
          let savedTitle=task.titleGenerated?task.title:'';
          const executeAgent=async permissionScope=>runAgent({permissions:permissionScope,getSteering:async()=>{await session.saving;return session.queue.splice(0);}, base: storage.agentDirectory, task, model, scheduledContext,memory, projectMemoryContext:task.projectId?await require('./project-memory.cjs').readMemory(storage.agentDirectory,state.projects?.find(p=>p.id===task.projectId)||{id:task.projectId},state.tasks||[]):null, projectContext:require('./project-context.cjs').projectContext(state.projects?.find(p=>p.id===task.projectId)), personalAssistant:task.id===require('./personal-assistant.cjs').ASSISTANT_ID?storage.personalAssistant:undefined, knowledge:storage.knowledge?.scope(task.knowledgeIds||[]),mcp:storage.mcpConnections?.scope(input.mcpConnectionIds||[]),amap:input.amapEnabled===false?undefined:storage.amap, webSearch:input.searchEnabled===true?storage.webSearch:undefined, android:storage.androidManager, authorizeBuild:storage.authorizeBuild,directoryAccess:permissionScope?.directoryAccess||storage.directoryAccess,feishuCli:input.feishuEnabled===false?{execute:async()=>{throw Object.assign(Error('当前对话已关闭飞书，请在输入框 ＋ → 应用连接中开启后再试。'),{code:'FEISHU_DECLINED'});}}:storage.feishuCli,
            signal:permissionScope?.signal||controller.signal, ask: askAgent, extensions: selected, skillPackages: storage.skillPackages,
            onStatus: input.onStatus, onRun: async run=>{
              session.run=run;session.phase='running';
              if(run.conversationTitle&&run.conversationTitle!==savedTitle&&storage.setGeneratedTitle){
                const title=await storage.setGeneratedTitle(task.id,run.conversationTitle);
                if(title)savedTitle=title;
                run={...run,conversationTitle:title||undefined};
              }
              if(task.scheduledTaskId||task.id===require("./personal-assistant.cjs").ASSISTANT_ID)run={...run,conversationTitle:undefined};
              input.onRun?.(run);
            } });
          const scopedAgent=async scope=>{const cancel=()=>controller.abort();scope.signal.addEventListener('abort',cancel,{once:true});try{return await executeAgent(scope);}finally{scope.signal.removeEventListener('abort',cancel);}};
          const result=storage.permissions?await storage.permissions.run(task,controller.signal,scopedAgent):await executeAgent();
          session.run=result.agentRun;session.phase='settling';
          if(task.scheduledTaskId)await require('./schedule-context.cjs').archiveScheduleRun(storage.agentDirectory,task,result);
          return { ...result, modelName: model.name };
        }
        const { prepareContext, countMessages, capacity } = await import("./context.mjs");
        const replyExtensions=[...selected];
        if(schedulingTask?.responseOnly){
          const context={project:require('./project-context.cjs').projectContext(schedulingState.projects?.find(p=>p.id===schedulingTask.projectId))};
          if(storage.personalMemory){const scope=await storage.personalMemory.scope({task:schedulingTask,owner:await storage.personalMemory.owner()});context.memory=await scope.context(input.messages.at(-1)?.content||'');}
          replyExtensions.push({id:'reply-context',name:'当前项目与记忆（仅作参考）',kind:'expert',instructions:JSON.stringify(context)});
        }
        const prepared = await prepareContext(input.messages, replyExtensions, model, input.contextCheckpoint, async (messages, budget, { attempt }) => {
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
          throw Object.assign(Error(
            timeoutMessage
              ? timeoutMessage
              : "已停止回复，可重新发送。",
          ),{code:timeoutCode||'MODEL_CANCELLED',requestDiagnostics:error.requestDiagnostics,partialContent:error.partialContent});
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
        if(executionStarted!==undefined)try{await storage.recordExecution?.({id:input.id,durationMs:Date.now()-executionStarted,reasoningEffort:input.reasoningEffort,skills:executionExtensions.filter(e=>e.kind==='skill').map(e=>e.id),connections:[...(input.mcpConnectionIds||[]),...(input.feishuEnabled?['feishu']:[]),...(input.amapEnabled?['amap']:[]),...(input.searchEnabled?['search']:[])]});}catch{}
      }
    },
  };
}
module.exports = { createChat };

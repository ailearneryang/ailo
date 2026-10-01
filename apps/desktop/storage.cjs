const { builtins, validateExtensions } = require("./extensions.cjs");
const fs = require("node:fs/promises");
const path = require("node:path");
const {
  randomUUID,
  randomBytes,
  scrypt: scryptCallback,
  timingSafeEqual,
} = require("node:crypto");
const { promisify } = require("node:util");
const scrypt = promisify(scryptCallback);

function createStorage(directory, safeStorage) {
  let writes = Promise.resolve();
  const attempts = new Map();
  const file = (name) => path.join(directory, name + ".json");
  async function read(name, fallback) {
    try {
      return JSON.parse(await fs.readFile(file(name), "utf8"));
    } catch (error) {
      if (error.code === "ENOENT") return fallback;
      throw error;
    }
  }
  async function write(name, data) {
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(file(name) + ".tmp", JSON.stringify(data), {
      mode: 0o600,
    });
    await fs.rename(file(name) + ".tmp", file(name));
  }
  function queue(action) {
    const result = writes.catch(() => {}).then(action);
    writes = result;
    return result;
  }
  const publicUser = (user) =>
    user ? { id: user.id, name: user.name, email: user.email } : null;
  function credentials(input) {
    if (
      !input ||
      typeof input.email !== "string" ||
      typeof input.password !== "string"
    )
      throw Error("请输入邮箱和密码。");
    const email = input.email.trim().toLowerCase();
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      throw Error("请输入有效的邮箱地址。");
    if (input.password.length > 128) throw Error("密码不能超过 128 位。");
    return { email, password: input.password };
  }
  return {
    async modelCredentials(id) {
      await writes.catch(() => {});
      const state = await read("workspace", { models: [] });
      const model = (state.models || []).find((m) => m.id === id);
      if (!model) throw Error("请先选择或配置一个可用模型。");
      let apiKey;
      if (model.encryptedKey) {
        try {
          apiKey = safeStorage.decryptString(
            Buffer.from(model.encryptedKey, "base64"),
          );
        } catch {
          throw Error("无法解密模型密钥，请在模型设置中重新填写。");
        }
      }
      return {
        id: model.id,
        name: model.name,
        model: model.model,
        baseUrl: model.baseUrl,
        apiKey,
        contextWindow: model.contextWindow,
        maxOutputTokens: model.maxOutputTokens,
      };
    },
    async readWorkspace() {
      await writes.catch(() => {});
      const state = await read("workspace", { tasks: [] });
      return {
        ...state,
        extensions: state.extensions ?? builtins,
        projects: state.projects || [],
        defaultModelId: state.defaultModelId || "demo",
        models: (state.models || []).map(
          ({ encryptedKey, apiKey, ...model }) => ({
            ...model,
            hasKey: !!encryptedKey,
          }),
        ),
      };
    },
    addLocalProject(folder){return queue(async()=>{
      const root=await fs.realpath(folder);if(!(await fs.stat(root)).isDirectory())throw Error('请选择文件夹');
      const state=await read('workspace',{tasks:[],projects:[],models:[]});state.projects ||= [];
      const existing=state.projects.find(p=>p.localPath===root);if(existing)return existing;
      const project={id:randomUUID(),name:path.basename(root).slice(0,60)||'本地项目',localPath:root,source:'local',extensionIds:[]};
      await require('./agent/workspace-path.cjs').bindLocalRoot(path.join(directory,'agent'),project.id,root);
      state.projects.push(project);await write('workspace',state);return project;
    });},
    patchTask(id, patch, append=[]) {
      return queue(async()=>{
        if(typeof id!=='string'||!patch||!Array.isArray(append))throw Error('会话更新无效');
        const state=await read('workspace',{tasks:[],projects:[],models:[]});
        const previous=state.tasks.find(t=>t.id===id);
        const {agentRun,messages,...fields}=patch;

        if(previous && Object.hasOwn(fields,'projectId') && (fields.projectId||'')!==(previous.projectId||''))throw Error('不能更改会话所属项目');
        const merged=[...(previous?.messages || messages || (previous?.request?[{id:id+'-original',role:'user',content:previous.request}]:[]))];
        for(const m of [...(messages||[]),...append])if(!merged.some(old=>old.id===m.id))merged.push(m);
        const task={...previous,...fields,id,messages:merged};
        if(!task.request||!Array.isArray(task.materials)||(!!task.projectId&&!state.projects.some(p=>p.id===task.projectId))||merged.some(m=>!m||!['user','assistant'].includes(m.role)||typeof m.content!=='string'))throw Error('任务数据无效');
        state.tasks=previous?state.tasks.map(t=>t.id===id?task:t):[task,...state.tasks];
        if(JSON.stringify(state).length>2000000)throw Error('工作空间超过容量限制');
        await write('workspace',state);return task;
      });
    },
    saveWorkspace(state, preserveTasks=false) {
      return queue(async () => {
        if (
          !state ||
          !Array.isArray(state.tasks) ||
          !Array.isArray(state.projects) ||
          !Array.isArray(state.models) ||
          JSON.stringify(state).length > 2000000
        )
          throw Error("工作空间数据格式不正确或超过容量限制。");
        const previous = await read("workspace", { models: [] });
        const ids = new Set();
        const models = state.models.map((model) => {
          if (
            !model ||
            typeof model.id !== "string" ||
            model.id === "demo" ||
            ids.has(model.id) ||
            typeof model.name !== "string" ||
            !model.name.trim() ||
            typeof model.model !== "string" ||
            !model.model.trim()
          )
            throw Error("模型配置无效。");
          if (model.contextWindow !== undefined && (!Number.isInteger(model.contextWindow) || model.contextWindow < 4096 || model.contextWindow > 2000000))
            throw Error("上下文容量须为 4096–2000000 之间的整数。");
          if(model.maxOutputTokens !== undefined && (!Number.isInteger(model.maxOutputTokens)||model.maxOutputTokens<256||model.maxOutputTokens>2000000||(model.contextWindow && model.maxOutputTokens>=model.contextWindow)))throw Error('最大输出额度须为256–2000000之间的整数，且小于上下文容量；请按服务商限制填写。');
          ids.add(model.id);
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
            throw Error("API 地址无效。");
          let encryptedKey = (previous.models || []).find(
            (m) => m.id === model.id,
          )?.encryptedKey;
          if (model.apiKey !== undefined) {
            if (typeof model.apiKey !== "string" || model.apiKey.length > 8192)
              throw Error("API Key 无效。");
            if (model.apiKey.trim()) {
              if (!safeStorage.isEncryptionAvailable())
                throw Error("系统加密不可用，无法安全保存 API Key。");
              encryptedKey = safeStorage
                .encryptString(model.apiKey.trim())
                .toString("base64");
            }
          }
          return {
            id: model.id,
            name: model.name.trim(),
            ...(model.contextWindow !== undefined ? { contextWindow: model.contextWindow } : {}),
            ...(model.maxOutputTokens !== undefined ? {maxOutputTokens:model.maxOutputTokens} : {}),
            model: model.model.trim(),
            baseUrl: url.href.replace(/\/$/, ""),
            ...(encryptedKey ? { encryptedKey } : {}),
          };
        });
        const extensions = validateExtensions(state.extensions ?? previous.extensions ?? builtins);
        const projectIds = new Set();
        const projects = state.projects.map((project) => {
          if (
            !project ||
            typeof project.id !== "string" ||
            projectIds.has(project.id) ||
            typeof project.name !== "string" ||
            !project.name.trim() ||
            project.name.length > 60
          )
            throw Error("项目配置无效。");
          projectIds.add(project.id);
          const registered=previous.projects?.find(p=>p.id===project.id);
          return { id: project.id, name: project.name.trim(), ...(registered?.localPath?{localPath:registered.localPath,source:'local'}:{}), extensionIds: Array.isArray(project.extensionIds) ? project.extensionIds.filter(id => extensions.some(e => e.id === id)).slice(0,6) : [] };
        });
        if (
          state.tasks.some(
            (t) =>
              !t ||
              !t.id ||
              !t.request ||
              !Array.isArray(t.materials) ||
              (t.projectId && !projectIds.has(t.projectId)),
          )
        )
          throw Error("任务数据无效。");
        await write("workspace", {
          extensions,
          tasks: preserveTasks ? (previous.tasks || []) : state.tasks,
          projects,
          models,
          defaultModelId: ids.has(state.defaultModelId)
            ? state.defaultModelId
            : "demo",
        });
      });
    },
    saveContextCheckpoint(taskId, contextCheckpoint) {
      return queue(async () => {
        const state = await read("workspace", { tasks: [] });
        const task = state.tasks.find(t => t.id === taskId);
        if (!task) throw Error("对话不存在，无法保存摘要。");
        task.contextCheckpoint = contextCheckpoint;
        await write("workspace", state);
      });
    },
    async account() {
      await writes.catch(() => {});
      const accounts = await read("accounts", { users: [] });
      return publicUser(
        accounts.users.find((u) => u.id === accounts.currentUserId),
      );
    },
    register(input) {
      return queue(async () => {
        const { email, password } = credentials(input);
        if (
          typeof input.name !== "string" ||
          !input.name.trim() ||
          input.name.trim().length > 40
        )
          throw Error("请填写 1–40 字的昵称。");
        if (password.length < 8) throw Error("密码至少需要 8 位字符。");
        const accounts = await read("accounts", { users: [] });
        if (accounts.users.some((u) => u.email === email))
          throw Error("这个邮箱已在本机注册，请直接登录。");
        const salt = randomBytes(16).toString("hex");
        const hash = (await scrypt(password, salt, 64)).toString("hex");
        const user = {
          id: randomUUID(),
          name: input.name.trim(),
          email,
          salt,
          hash,
        };
        accounts.users.push(user);
        accounts.currentUserId = user.id;
        await write("accounts", accounts);
        return publicUser(user);
      });
    },
    login(input) {
      return queue(async () => {
        const { email, password } = credentials(input);
        const attempt = attempts.get(email);
        if (attempt && attempt.count >= 5 && Date.now() - attempt.at < 60000)
          throw Error("尝试次数过多，请一分钟后重试。");
        const accounts = await read("accounts", { users: [] });
        const user = accounts.users.find((u) => u.email === email);
        const hash = await scrypt(
          password,
          user?.salt || "ailo-missing-account",
          64,
        );
        if (!user || !timingSafeEqual(hash, Buffer.from(user.hash, "hex"))) {
          attempts.set(email, {
            count:
              attempt && Date.now() - attempt.at < 60000
                ? attempt.count + 1
                : 1,
            at: Date.now(),
          });
          throw Error("邮箱或密码不正确。请确认已在这台电脑注册。");
        }
        attempts.delete(email);
        accounts.currentUserId = user.id;
        await write("accounts", accounts);
        return publicUser(user);
      });
    },
    logout() {
      return queue(async () => {
        const accounts = await read("accounts", { users: [] });
        delete accounts.currentUserId;
        await write("accounts", accounts);
      });
    },
  };
}
module.exports = { createStorage };

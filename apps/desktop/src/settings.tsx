import { Pet } from "./pet";
import React, { useState } from "react";
import type { Model, User, Workspace } from "./types";

type SettingsProps = {
  data: Workspace;
  saving: boolean;
  commit: (data: Workspace) => Promise<boolean>;
};
export function ModelSettings({ data, saving, commit }: SettingsProps) {
  const [editing, setEditing] = useState<Model | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [removing, setRemoving] = useState<string | null>(null);
  function edit(model?: Model) {
    setEditing(
      model
        ? { ...model, apiKey: "" }
        : {
            id: crypto.randomUUID(),
            name: "",
            model: "",
            baseUrl: "",
            apiKey: "",
          },
    );
    setError("");
    setNotice("");
    setRemoving(null);
  }
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!editing || saving) return;
    let url: URL;
    try {
      url = new URL(editing.baseUrl.trim());
    } catch {
      setError("请输入完整的 API 地址，例如 https://example.com/v1");
      return;
    }
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
    ) {
      setError(
        "请使用 HTTPS 地址；本地服务可使用 HTTP。地址中不要包含密钥、参数或用户名。",
      );
      return;
    }
    const model = {
      ...editing,
      name: editing.name.trim(),
      model: editing.model.trim(),
      baseUrl: url.href.replace(/\/$/, ""),
      apiKey: editing.apiKey?.trim() || undefined,
    };
    if (!model.name || !model.model) {
      setError("请填写显示名称和模型 ID。");
      return;
    }
    if (
      data.models.some(
        (m) =>
          m.id !== model.id &&
          m.name.toLowerCase() === model.name.toLowerCase(),
      )
    ) {
      setError("这个显示名称已存在，请换一个名称。");
      return;
    }
    const exists = data.models.some((m) => m.id === model.id);
    if (
      await commit({
        ...data,
        models: exists
          ? data.models.map((m) => (m.id === model.id ? model : m))
          : [...data.models, model],
        defaultModelId:
          data.models.length === 0 ? model.id : data.defaultModelId,
      })
    ) {
      setEditing(null);
      setError("");
      setNotice("模型配置已保存，返回对话即可使用。");
    }
  }
  async function remove(id: string) {
    if (
      await commit({
        ...data,
        models: data.models.filter((m) => m.id !== id),
        defaultModelId:
          data.defaultModelId === id
            ? data.models.find((m) => m.id !== id)?.id || "demo"
            : data.defaultModelId,
      })
    ) {
      setRemoving(null);
      if (editing?.id === id) setEditing(null);
      setNotice("模型已移除，已有对话保留原模型名称。");
    }
  }
  return (
    <div className="settings-page">
      <div className="page-heading">
        <div>
          <div className="eyebrow">PERSONALIZE AILO</div>
          <h1>模型设置</h1>
          <p className="muted">添加你自己的模型，在每次新对话中自由选择。</p>
        </div>
        <button className="primary" disabled={saving} onClick={() => edit()}>
          ＋ 添加模型
        </button>
      </div>
      <div className="info-banner">
        支持 OpenAI 兼容的 Chat Completions
        接口。发送消息时，对话上下文和文本附件会发送到你配置的服务商。
      </div>
      <div className="model-list">
        {data.models.map((m) => (
          <article className="model-card" key={m.id}>
            <span className="model-icon">◇</span>
            <div className="model-description">
              <strong>{m.name}</strong>
              <small>
                {m.model} · {m.hasKey ? "已保存密钥" : "未配置密钥"}
              </small>
              <small>{m.baseUrl}</small>
            </div>
            <div className="model-actions">
              {data.defaultModelId === m.id ? (
                <span className="badge">默认</span>
              ) : (
                <button
                  disabled={saving}
                  onClick={() => void commit({ ...data, defaultModelId: m.id })}
                >
                  设为默认
                </button>
              )}
              <button disabled={saving} onClick={() => edit(m)}>
                编辑<span className="sr-only"> {m.name}</span>
              </button>
              <button disabled={saving} onClick={() => setRemoving(m.id)}>
                移除<span className="sr-only"> {m.name}</span>
              </button>
            </div>
            {removing === m.id && (
              <div className="remove-confirm">
                <span>移除「{m.name}」及保存的密钥？</span>
                <button disabled={saving} onClick={() => setRemoving(null)}>
                  取消
                </button>
                <button
                  className="danger"
                  disabled={saving}
                  onClick={() => void remove(m.id)}
                >
                  确认移除
                </button>
              </div>
            )}
          </article>
        ))}
      </div>
      {!data.models.length && !editing && (
        <div className="empty-models">
          <h3>让 Ailo 使用你熟悉的模型</h3>
          <p className="muted">
            准备好服务商的 API 地址、模型 ID 和 API Key，即可添加配置。
          </p>
          <button onClick={() => edit()}>添加第一个模型 ↗</button>
        </div>
      )}
      {editing && (
        <form className="settings-form" onSubmit={save}>
          <h2>
            {data.models.some((m) => m.id === editing.id)
              ? "编辑模型"
              : "添加模型"}
          </h2>
          <div className="form-grid">
            <label>
              显示名称
              <input
                autoFocus
                required
                maxLength={60}
                value={editing.name}
                onChange={(e) =>
                  setEditing({ ...editing, name: e.target.value })
                }
                placeholder="例如：我的工作模型"
              />
            </label>
            <label>
              模型 ID
              <input
                required
                maxLength={150}
                value={editing.model}
                onChange={(e) =>
                  setEditing({ ...editing, model: e.target.value })
                }
                placeholder="服务商提供的模型 ID"
              />
            </label>
          </div>
          <label>
            上下文容量（tokens）
            <input type="number" min={4096} max={2000000} step={1}
              value={editing.contextWindow ?? ""}
              onChange={e => setEditing({ ...editing, contextWindow: e.target.value ? Number(e.target.value) : undefined })}
              placeholder="未配置时按 32768 估算" />
            <span className="muted">按服务商公布的总上下文容量填写，包含输入与输出；留空使用默认估算。</span>
          </label>
          <label>
            单次最大输出额度（tokens）
            <input type="number" min={256} max={2000000} step={1}
              value={editing.maxOutputTokens ?? ""}
              onChange={e => setEditing({ ...editing, maxOutputTokens: e.target.value ? Number(e.target.value) : undefined })}
              placeholder="Agent 未配置时使用 8192" />
            <span className="muted">按服务商支持的最大输出额度填写，与上下文容量不同。Agent 从最多 8192 开始，截断后最多重试两次并逐步增加额度，始终不超过此值及上下文余量。</span>
          </label>
          <label>
            API 地址
            <input
              required
              type="url"
              value={editing.baseUrl}
              onChange={(e) =>
                setEditing({ ...editing, baseUrl: e.target.value })
              }
              placeholder="https://example.com/v1"
            />
          </label>
          <label>
            API Key <span className="optional">可选 · 本地服务可留空</span>
            <input
              type="password"
              autoComplete="off"
              value={editing.apiKey || ""}
              onChange={(e) =>
                setEditing({ ...editing, apiKey: e.target.value })
              }
              placeholder={
                editing.hasKey
                  ? "已保存；留空保留原密钥"
                  : "输入服务商提供的密钥"
              }
            />
          </label>
          <p className="muted">
            密钥由系统加密后保存在本机，不会显示在对话中。
          </p>
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          <div className="form-actions">
            <button
              type="button"
              disabled={saving}
              onClick={() => setEditing(null)}
            >
              取消
            </button>
            <button className="primary" disabled={saving}>
              {saving ? "正在保存…" : "保存模型"}
            </button>
          </div>
        </form>
      )}
      {notice && (
        <p role="status" className="success">
          {notice}
        </p>
      )}
    </div>
  );
}

export function AccountPage({
  user,
  onUser,
  onBack,
}: {
  user: User | null;
  onUser: (user: User | null) => void;
  onBack: () => void;
}) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const next =
        mode === "login"
          ? await window.ailo.login({ email, password })
          : await window.ailo.register({ name, email, password });
      onUser(next);
      setPassword("");
    } catch (e) {
      setError(String(e).replace(/^.*Error: /, ""));
    } finally {
      setBusy(false);
    }
  }
  async function logout() {
    setBusy(true);
    setError("");
    try {
      await window.ailo.logout();
      onUser(null);
    } catch {
      setError("退出失败，请重试。");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="account-page">
      <button className="back-link" onClick={onBack}>
        ← 返回对话
      </button>
      <div className="account-card">
        <Pet size="brand" interactive />
        {user ? (
          <>
            <h1>你好，{user.name}</h1>
            <p className="muted">欢迎回到你的 Ailo 工作空间。</p>
            <div className="account-details">
              <span className="avatar large-avatar">
                {Array.from(user.name)[0]?.toUpperCase()}
              </span>
              <div>
                <strong>{user.name}</strong>
                <p>{user.email}</p>
                <span className="badge">本机账号</span>
              </div>
            </div>
            <p className="account-note">
              此账号仅在当前电脑使用。项目和对话属于本机共享工作空间，退出登录后仍会保留。
            </p>
            <button className="primary full-width" onClick={onBack}>
              开始对话
            </button>
            <button
              className="full-width"
              disabled={busy}
              onClick={() => void logout()}
            >
              退出登录
            </button>
          </>
        ) : (
          <>
            <div className="eyebrow">WELCOME TO AILO</div>
            <h1>{mode === "login" ? "欢迎回来" : "创建你的账号"}</h1>
            <p className="muted">
              {mode === "login"
                ? "登录，继续和 Ailo 一起完成每件事。"
                : "让每一次开始，都更熟悉。"}
            </p>
            <div className="auth-tabs">
              <button
                className={mode === "login" ? "active" : ""}
                disabled={busy}
                onClick={() => {
                  setMode("login");
                  setError("");
                  setPassword("");
                }}
              >
                登录
              </button>
              <button
                className={mode === "register" ? "active" : ""}
                disabled={busy}
                onClick={() => {
                  setMode("register");
                  setError("");
                  setPassword("");
                }}
              >
                注册
              </button>
            </div>
            <form onSubmit={submit}>
              {mode === "register" && (
                <label>
                  昵称
                  <input
                    required
                    maxLength={40}
                    value={name}
                    autoComplete="nickname"
                    onChange={(e) => setName(e.target.value)}
                    placeholder="怎么称呼你？"
                  />
                </label>
              )}
              <label>
                邮箱
                <input
                  required
                  type="email"
                  value={email}
                  autoComplete="email"
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                />
              </label>
              <label>
                密码
                <input
                  required
                  type="password"
                  minLength={mode === "register" ? 8 : 1}
                  maxLength={128}
                  value={password}
                  autoComplete={
                    mode === "login" ? "current-password" : "new-password"
                  }
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={
                    mode === "register" ? "至少 8 位字符" : "输入密码"
                  }
                />
              </label>
              <button className="primary full-width" disabled={busy}>
                {busy
                  ? "请稍候…"
                  : mode === "login"
                    ? "登录 Ailo"
                    : "创建账号并登录"}
              </button>
            </form>
            <p className="account-note">
              当前为本机账号，不验证邮箱，不支持跨设备同步。项目和对话保存在本机共享工作空间。
            </p>
          </>
        )}
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { demoModel, type Model } from "./types";

export function ModelPicker({
  models,
  value,
  defaultId,
  disabled,
  onSelect,
  onConfigure,
  reasoningSupported, reasoningEffort, onReasoningChange,
}: {
  reasoningSupported?: boolean;
  reasoningEffort?: 'low'|'medium'|'high';
  onReasoningChange?: (effort:'low'|'medium'|'high')=>void;
  models: Model[];
  value: string;
  defaultId: string;
  disabled: boolean;
  onSelect: (id: string) => void;
  onConfigure: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [quick, setQuick] = useState(false);
  const [query, setQuery] = useState("");
  const [position, setPosition] = useState({
    left: 0,
    top: 0,
    width: 360,
    maxHeight: 420,
  });
  const trigger = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const current = models.find((m) => m.id === value) || models[0] || demoModel;
  const filtered = models.filter((m) =>
    `${m.name} ${m.model}`
      .toLocaleLowerCase()
      .includes(query.trim().toLocaleLowerCase()),
  );
  function close(focus = false) {
    setOpen(false);
    if (focus) trigger.current?.focus();
  }
  useLayoutEffect(() => {
    if (!open) return;
    function place() {
      if (!trigger.current || !popup.current) return;
      const rect = trigger.current.getBoundingClientRect();
      const below = innerHeight - rect.bottom - 16,
        above = rect.top - 16;
      const maxHeight = Math.min(420, Math.max(below, above)),
        width = Math.min(360, innerWidth - 32);
      const down =
        below >= Math.min(420, popup.current.scrollHeight) || below >= above;
      setPosition({
        left: Math.max(
          16,
          Math.min(rect.right - width, innerWidth - width - 16),
        ),
        top: down
          ? rect.bottom + 8
          : Math.max(
              16,
              rect.top - Math.min(popup.current.scrollHeight, maxHeight) - 8,
            ),
        width,
        maxHeight,
      });
    }
    place();
    const observer = new ResizeObserver(place);
    if (popup.current) observer.observe(popup.current);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, quick, query, models.length]);
  useEffect(() => {
    if (!open) return;
    if(quick) popup.current?.querySelector<HTMLButtonElement>('[aria-pressed="true"]')?.focus();
    else search.current?.focus();
    function outside(e: PointerEvent) {
      if (
        !popup.current?.contains(e.target as Node) &&
        !trigger.current?.contains(e.target as Node)
      )
        close();
    }
    function escape(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        close(true);
      }
    }
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open, quick]);
  return (
    <div className="composer-model">
      <button
        ref={trigger}
        type="button"
        className={"model-trigger " + (open ? "is-open" : "")}
        disabled={disabled}
        aria-label={reasoningSupported ? `切换思考强度：${current.name}` : `选择模型：${current.name}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? "model-picker" : undefined}
        title={current.name}
        onClick={() => {
          if (open) close();
          else {
            setQuery("");
            setQuick(!!reasoningSupported);
            setOpen(true);
          }
        }}
      >
        <span aria-hidden="true">{current.id === "demo" ? "✳" : "◇"}</span>
        <span className="model-trigger-name">{current.name}{reasoningSupported ? ` · ${{low:"轻度",medium:"标准",high:"深度"}[reasoningEffort||"medium"]}` : ""}</span>
        <svg
          width="12"
          height="12"
          viewBox="0 0 12 12"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          aria-hidden="true"
        >
          <path d={open ? "m3 4 3 3 3-3" : "m3 7 3-3 3 3"} />
        </svg>
      </button>
      {open &&
        createPortal(
          <div
            ref={popup}
            role="dialog"
            aria-label={quick ? "切换思考强度" : "选择模型"}
            id="model-picker"
            className={"model-popover"+(quick?" model-quick-popover":"")}
            style={position}
            onBlur={(e) => {
              if (
                e.relatedTarget &&
                !e.currentTarget.contains(e.relatedTarget as Node) &&
                e.relatedTarget !== trigger.current
              )
                close();
            }}
            onKeyDown={(e) => {
              if (!["ArrowDown", "ArrowUp"].includes(e.key)) return;
              const buttons = Array.from(
                popup.current?.querySelectorAll<HTMLButtonElement>(
                  "button:not(:disabled)",
                ) || [],
              );
              if (!buttons.length) return;
              e.preventDefault();
              const index = buttons.indexOf(
                document.activeElement as HTMLButtonElement,
              );
              buttons[
                index < 0
                  ? e.key === "ArrowDown"
                    ? 0
                    : buttons.length - 1
                  : (index +
                      (e.key === "ArrowDown" ? 1 : -1) +
                      buttons.length) %
                    buttons.length
              ]?.focus();
            }}
          >
            {quick ? <>
              <button type="button" className="model-quick-heading" onClick={()=>{setQuick(false);setQuery("");}} aria-label="打开模型列表"><strong>{current.name}</strong><span>更换模型 ›</span></button>
              <div className="model-quick-levels" role="group" aria-label="思考强度">{([['low','轻度'],['medium','标准'],['high','深度']] as const).map(([effort,label])=><button key={effort} type="button" disabled={disabled} aria-pressed={(reasoningEffort||'medium')===effort} onClick={()=>{onReasoningChange?.(effort);close(true);}}><span className="model-quick-dot" aria-hidden="true"/><span>{label}</span></button>)}</div>
              <p className="model-quick-hint">轻度更快，深度适合复杂任务</p>
            </> : <>
            <div className="model-popover-heading">
              选择模型<span>用于下一条消息</span>
            </div>
            {reasoningSupported&&<fieldset className="model-reasoning"><legend>思考强度</legend><div>{([['low','轻度'],['medium','标准'],['high','深度']] as const).map(([effort,label])=><button key={effort} type="button" disabled={disabled} aria-pressed={reasoningEffort===effort} onClick={()=>onReasoningChange?.(effort)}>{label}</button>)}</div><p>更高强度适合复杂任务，通常耗时和消耗更多。用于当前会话后续消息。</p></fieldset>}
            <div className="project-search model-search">
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                aria-hidden="true"
              >
                <circle cx="10.5" cy="10.5" r="7.5" />
                <path d="m16 16 5 5" />
              </svg>
              <input
                ref={search}
                aria-label="搜索模型"
                placeholder="搜索模型"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <div className="model-options">
              {filtered.map((m) => (
                <button
                  type="button"
                  className={
                    "model-option " + (m.id === value ? "is-selected" : "")
                  }
                  key={m.id}
                  aria-label={m.name}
                  aria-pressed={m.id === value}
                  disabled={disabled}
                  onClick={() => {
                    onSelect(m.id);
                    close(true);
                  }}
                >
                  <span className="model-option-icon" aria-hidden="true">
                    {m.id === "demo" ? "✳" : "◇"}
                  </span>
                  <span className="model-option-copy">
                    <span>{m.name}</span>
                    <small>{m.id === "demo" ? "内置交互演示" : m.model}</small>
                  </span>
                  {m.id === defaultId && <span className="badge">默认</span>}
                  {m.id === value && (
                    <span className="project-check" aria-hidden="true">
                      ✓
                    </span>
                  )}
                </button>
              ))}
              {!filtered.length && (
                <p className="project-empty">
                  {models.length
                    ? "没有找到匹配的模型"
                    : "还没有模型，请先配置自定义模型"}
                </p>
              )}
            </div>
            <div className="model-configure">
              <button
                type="button"
                onClick={() => {
                  close();
                  onConfigure();
                }}
              >
                <svg
                  width="19"
                  height="19"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="m15 4 5 5M4 20l5-1L21 7a2 2 0 0 0-5-5L4 14l-1 7 7-1" />
                </svg>
                配置自定义模型<span aria-hidden="true">↗</span>
              </button>
              <p>使用你配置的服务商接口回复</p>
            </div>
            </>}
          </div>,
          document.body,
        )}
    </div>
  );
}

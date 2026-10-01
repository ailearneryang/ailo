import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Project } from "./types";

function FolderIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 7V5a2 2 0 0 1 2-2h5l3 3h6a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" />
      <path d="M3 8h18" />
    </svg>
  );
}
export function ProjectPicker({
  menuAnchor, onMenuClose, hideEmptyTrigger=false,
  projects,
  value,
  disabled,
  onSelect,
  onCreate,
  onOpenLocal,
}: {
  menuAnchor?:HTMLButtonElement|null;
  onMenuClose?:()=>void;
  hideEmptyTrigger?:boolean;
  projects: Project[];
  value: string;
  disabled: boolean;
  onSelect: (id: string) => void;
  onOpenLocal:()=>Promise<void>;
  onCreate: (name: string) => Promise<string | null>;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [position, setPosition] = useState({
    left: 0,
    top: 0,
    width: 340,
    maxHeight: 380,
  });
  const trigger = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const selected = projects.find((p) => p.id === value);
  const filtered = projects.filter((p) =>
    p.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
  );
  useEffect(()=>{if(menuAnchor){setQuery("");setCreating(false);setError("");setOpen(true);}},[menuAnchor]);
  function close(restoreFocus = false) {
    setOpen(false);
    if (restoreFocus) (menuAnchor || trigger.current)?.focus();
    onMenuClose?.();
  }
  useLayoutEffect(() => {
    if (!open) return;
    function place() {
      if (!trigger.current || !popup.current) return;
      const rect = (menuAnchor || trigger.current).getBoundingClientRect();
      const below = innerHeight - rect.bottom - 16;
      const above = rect.top - 16;
      const height = Math.min(380, Math.max(below, above));
      const width = Math.min(340, innerWidth - 32);
      const down =
        below >= Math.min(380, popup.current.scrollHeight) || below >= above;
      setPosition({
        left: Math.max(16, Math.min(rect.left, innerWidth - width - 16)),
        top: down
          ? rect.bottom + 8
          : Math.max(
              16,
              rect.top - Math.min(popup.current.scrollHeight, height) - 8,
            ),
        width,
        maxHeight: height,
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
  }, [open, creating, query, error, projects.length, menuAnchor]);
  useEffect(() => {
    if (!open) return;
    search.current?.focus();
    function outside(e: PointerEvent) {
      if (
        !popup.current?.contains(e.target as Node) &&
        !trigger.current?.contains(e.target as Node) &&
        !menuAnchor?.contains(e.target as Node)
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
  }, [open, menuAnchor]);
  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || busy || disabled) return;
    setBusy(true);
    setError("");
    try {
      const message = await onCreate(name.trim());
      if (message) setError(message);
      else close(true);
    } catch {
      setError("创建失败，请重试。");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="project-toolbar">
      <button
        ref={trigger}
        hidden={hideEmptyTrigger && !selected}
        style={hideEmptyTrigger && !selected?{display:"none"}:undefined}
        type="button"
        className={"project-trigger " + (open ? "is-open" : "")}
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? "project-picker" : undefined}
        aria-label={selected ? `选择项目：${selected.name}` : "选择项目"}
        title={selected?.name}
        onClick={() => {
          if (open) close();
          else {
            setQuery("");
            setCreating(false);
            setError("");
            setOpen(true);
          }
        }}
      >
        <FolderIcon />
        <span>{selected?.name || "选择项目"}</span>
      </button>
      {open &&
        createPortal(
          <div
            ref={popup}
            id="project-picker"
            role="dialog"
            aria-label={creating ? "新建项目" : "选择项目"}
            className="project-popover"
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
              if (creating || !["ArrowDown", "ArrowUp"].includes(e.key)) return;
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
              const nextIndex =
                index < 0
                  ? e.key === "ArrowDown"
                    ? 0
                    : buttons.length - 1
                  : (index +
                      (e.key === "ArrowDown" ? 1 : -1) +
                      buttons.length) %
                    buttons.length;
              buttons[nextIndex]?.focus();
            }}
          >
            {creating ? (
              <form className="project-create" onSubmit={create}>
                <h3>
                  <FolderIcon />
                  新建项目
                </h3>
                <label htmlFor="project-name">项目名称</label>
                <input
                  id="project-name"
                  autoFocus
                  required
                  maxLength={60}
                  value={name}
                  disabled={busy}
                  onChange={(e) => {
                    setName(e.target.value);
                    setError("");
                  }}
                  placeholder="给项目起个名字"
                />
                <p className="muted">Ailo 自动管理项目文件；已有文件可通过“打开本地文件夹”使用。</p>
                {error && (
                  <p role="alert" className="error">
                    {error}
                  </p>
                )}
                <div className="form-actions">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      setCreating(false);
                      setError("");
                      requestAnimationFrame(() => search.current?.focus());
                    }}
                  >
                    取消
                  </button>
                  <button
                    className="primary"
                    disabled={busy || disabled || !name.trim()}
                  >
                    {busy ? "正在创建…" : "创建项目"}
                  </button>
                </div>
              </form>
            ) : (
              <>
                <div className="project-search">
                  <svg
                    width="19"
                    height="19"
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
                    aria-label="搜索项目"
                    placeholder="搜索项目"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                </div>
                <div className="project-options" aria-label="项目列表"><button type="button" className={"project-option "+(!value?"is-selected":"")} aria-pressed={!value} disabled={disabled} onClick={()=>{onSelect("");close(true);}}>不选择项目{!value&&<span className="project-check">✓</span>}</button>
                  {filtered.map((project) => (
                    <button
                      type="button"
                      key={project.id}
                      className={
                        "project-option " +
                        (value === project.id ? "is-selected" : "")
                      }
                      aria-pressed={value === project.id}
                      disabled={disabled}
                      onClick={() => {
                        onSelect(project.id);
                        close(true);
                      }}
                    >
                      <FolderIcon />
                      <span title={project.localPath}>{project.name}<small className="project-path">{project.localPath || "Ailo 托管项目"}</small></span>
                      {value === project.id && (
                        <span className="project-check" aria-hidden="true">
                          ✓
                        </span>
                      )}
                    </button>
                  ))}
                  {!filtered.length && (
                    <p className="project-empty">
                      {projects.length
                        ? "没有找到匹配的项目"
                        : "暂无项目，也可以直接开始对话"}
                    </p>
                  )}
                </div>
                <div className="project-popover-footer"><button type="button" disabled={busy||disabled} onClick={async()=>{setBusy(true);setError("");try{await onOpenLocal();close(true);}catch(e){setError(String(e));}finally{setBusy(false);}}}>打开本地文件夹</button>{error&&<p role="alert">{error}</p>}
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => {
                      setName(query.trim().slice(0, 60));
                      setCreating(true);
                    }}
                  >
                    <span className="project-plus" aria-hidden="true">
                      ＋
                    </span>
                    新建项目
                  </button>
                </div>
              </>
            )}
          </div>,
          document.body,
        )}
    </div>
  );
}

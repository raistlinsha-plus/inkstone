import { useEffect, useRef, useState } from "react";
import { MoreHorizontal } from "lucide-react";
import ContentBlock from "../preview/ContentBlock";
import { blockTypes, type BlockKind } from "./blocks";
interface Props {
  language: string;
  source: string;
  viewKey?: string;
  sourceReveal?: { request: number; line: number; showCode: boolean };
  apply: (base: string, next: string, structure?: boolean) => void;
  action: (
    name: "delete" | "duplicate" | "up" | "down" | "after" | "select",
  ) => void;
}
export default function InlineBlock({
  language,
  source,
  viewKey,
  sourceReveal,
  apply,
  action,
}: Props) {
  const kind = language.toLowerCase(),
    known = Object.hasOwn(blockTypes, kind),
    raw = language.startsWith("inkstone-raw-");
  const [editing, setEditing] = useState(!known && !raw && !source),
    [large, setLarge] = useState(false),
    [error, setError] = useState(""),
    [deleting, setDeleting] = useState(false);
  const [visible, setVisible] = useState(
    typeof IntersectionObserver === "undefined",
  );
  const [placeholderHeight, setPlaceholderHeight] = useState(300);
  const [activeInteraction, setActiveInteraction] = useState(false);
  const [codeLine, setCodeLine] = useState<number>();
  const ref = useRef<HTMLElement>(null),
    preview = useRef<HTMLDivElement>(null),
    code = useRef<HTMLTextAreaElement>(null),
    menu = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (!sourceReveal?.showCode) return;
    setEditing(true);
    setCodeLine(undefined);
    const frame = requestAnimationFrame(() => setCodeLine(sourceReveal.line));
    return () => cancelAnimationFrame(frame);
  }, [sourceReveal]);
  useEffect(() => {
    if (!ref.current || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      ([entry]) => setVisible(entry.isIntersecting),
      { rootMargin: "200px" },
    );
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!preview.current || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry.contentRect.height > 0)
        setPlaceholderHeight(
          Math.max(120, Math.ceil(entry.contentRect.height)),
        );
    });
    observer.observe(preview.current);
    return () => observer.disconnect();
  }, [visible, large, activeInteraction]);
  useEffect(() => {
    if (!editing || codeLine === undefined || !code.current) return;
    const lines = source.split("\n"),
      line = Math.max(0, Math.min(lines.length - 1, codeLine - 1));
    const offset = lines.slice(0, line).reduce((n, s) => n + s.length + 1, 0);
    code.current.focus({ preventScroll: true });
    code.current.setSelectionRange(offset, offset + (lines[line]?.length ?? 0));
    code.current.scrollTop = Math.max(0, (line - 2) * 22);
  }, [editing, codeLine]);
  const locate = (line: number) => {
    setEditing(true);
    setCodeLine(undefined);
    requestAnimationFrame(() => setCodeLine(line));
  };
  const write = (base: string, next: string, structure = true) => {
    try {
      apply(base, next, structure);
      setError("");
    } catch (e) {
      setError(String(e));
      throw e;
    }
  };
  const run = (name: Parameters<Props["action"]>[0]) => {
    try {
      if (
        activeInteraction &&
        ["up", "down", "duplicate", "delete"].includes(name)
      )
        throw Error("请先应用或取消当前块的编辑，再调整内容块。");
      action(name);
      setError("");
      if (menu.current) menu.current.open = false;
    } catch (e) {
      setError(String(e));
    }
  };
  return (
    <section
      ref={ref}
      className={`inline-content-block ${large ? "expanded" : ""} ${editing ? "is-editing" : ""}`}
      data-kind={language}
      aria-label={`${known ? blockTypes[kind as BlockKind].label : raw ? "原始 Markdown" : language || "代码"}内容块`}
    >
      <header className="inline-block-bar">
        <button className="block-title" onClick={() => run("select")}>
          {known
            ? blockTypes[kind as BlockKind].label
            : raw
              ? "原始 Markdown"
              : language || "代码"}
        </button>
        <div className="block-actions">
          <button onClick={() => setEditing(!editing)}>
            {editing ? "完成编辑" : "编辑代码"}
          </button>
          <details
            className="block-menu"
            ref={menu}
            onBlur={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node | null))
                e.currentTarget.open = false;
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.stopPropagation();
                e.currentTarget.open = false;
                e.currentTarget.querySelector("summary")?.focus();
              }
            }}
          >
            <summary aria-label="内容块操作">
              <MoreHorizontal size={17} />
            </summary>
            <div role="group" aria-label="内容块操作">
              <button aria-label="上移内容块" onClick={() => run("up")}>
                上移
              </button>
              <button aria-label="下移内容块" onClick={() => run("down")}>
                下移
              </button>
              <button onClick={() => run("duplicate")}>复制块</button>
              <button
                onClick={() => {
                  void navigator.clipboard
                    .writeText(
                      raw ? source : "```" + language + "\n" + source + "\n```",
                    )
                    .then(() => setError("已复制 Markdown"))
                    .catch((e) => setError(String(e)));
                  if (menu.current) menu.current.open = false;
                }}
              >
                复制内容
              </button>
              <button
                onClick={() => {
                  setLarge(!large);
                  if (menu.current) menu.current.open = false;
                }}
              >
                {large ? "收起" : "放大"}
              </button>
              <button
                className="danger"
                onClick={() => {
                  setDeleting(true);
                  if (menu.current) menu.current.open = false;
                }}
              >
                删除块
              </button>
            </div>
          </details>
          {large && <button onClick={() => setLarge(false)}>收起</button>}
        </div>
      </header>
      {deleting && (
        <div className="preview-error" role="alert">
          删除整个内容块？可撤销。
          <button onClick={() => run("delete")}>确认删除块</button>
          <button onClick={() => setDeleting(false)}>取消</button>
        </div>
      )}
      {error && (
        <div role="status" className="preview-help">
          {error}
        </div>
      )}
      {editing && (
        <label className="inline-code-editor">
          {known ? "块内代码" : "代码"}
          <textarea
            ref={code}
            data-document-editor="true"
            aria-label={`${raw ? "原始 Markdown" : language || "代码"}块源码`}
            spellCheck={false}
            value={source}
            onChange={(e) => {
              try {
                write(source, e.target.value, false);
              } catch {}
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setEditing(false);
                e.stopPropagation();
              }
            }}
          />
        </label>
      )}
      {!known && !editing && (
        <div className="inline-code-reading">
          {raw && <p className="preview-help">此段格式以原文保留</p>}
          <pre
            tabIndex={0}
            aria-label={`${raw ? "原始 Markdown" : language || "文本"}内容`}
          >
            <code>{source || "（空代码块）"}</code>
          </pre>
        </div>
      )}
      {known && (visible || large || activeInteraction) ? (
        <div className="inline-block-preview" ref={preview}>
          <ContentBlock
            kind={kind}
            source={source}
            viewKey={viewKey}
            onApply={write}
            onLocate={locate}
            onError={setError}
            onEditingChange={setActiveInteraction}
          />
        </div>
      ) : known ? (
        <div
          className="block-placeholder"
          style={{ height: placeholderHeight }}
        >
          滚动到此处后本地呈现
        </div>
      ) : null}
      <footer>
        <button onClick={() => run("after")}>在块后继续写作</button>
      </footer>
    </section>
  );
}

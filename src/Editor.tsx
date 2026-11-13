import { isImeEvent } from "./platform/ime";
import {
  useEffect,
  useImperativeHandle,
  useId,
  useMemo,
  useRef,
  useState,
  type Ref,
} from "react";
import TextEditor, { type EditorHandle as TextHandle } from "./TextEditor";
import { DocumentSession, documentKind } from "./session";
import { headingOutline } from "./content/blocks";

import JsonTree from "./preview/JsonTree";
import Markdown from "./preview/Markdown";
import Graph from "./preview/Graph";
import Mindmap from "./preview/Mindmap";
import { insertCommands } from "./rich/commands";
import { ChevronDown, Plus, Undo2, Redo2, ListTree } from "lucide-react";
export type EditorMode = "source" | "visual" | "split" | "mindmap";
export interface InsertionTarget {
  revision: number;
  selection: ReturnType<TextHandle["captureSelection"]>;
}
export interface EditorHandle {
  getContent: () => string;
  undo: () => void;
  redo: () => void;
  captureInsertion: () => InsertionTarget;
  insertMarkdown: (text: string, target: InsertionTarget) => void;
}
interface Props {
  handleRef?: Ref<EditorHandle>;
  content: string;
  mode: EditorMode;
  path: string;
  viewKey?: string;
  line?: number;
  onChange: (value: string) => void;
  onError: (e: string) => void;
  onPosition?: (selection: number, scroll: number) => void;
  position?: { selection: number; scroll: number };
  onOpenDoc?: (path: string) => void;
}
const diagramTemplates: Record<string, string> = {
  flowchart: "flowchart LR\n  A[开始] --> B[完成]\n",
  sequenceDiagram:
    "sequenceDiagram\n  participant U as 用户\n  participant I as 砚台\n  U->>I: 保存资料\n  I-->>U: 完成\n",
  classDiagram: "classDiagram\n  class 文档 {\n    +标题\n    +保存()\n  }\n",
  "stateDiagram-v2":
    "stateDiagram-v2\n  [*] --> 编辑\n  编辑 --> 已保存: 保存\n  已保存 --> 编辑: 修改\n",
  mindmap: "mindmap\n  root((中心主题))\n    分支一\n    分支二\n",
};

export default function Editor({
  handleRef,
  content,
  mode,
  path,
  viewKey = path,
  line,
  onChange,
  onError,
  onPosition,
  position,
  onOpenDoc,
}: Props) {
  const session = useRef<DocumentSession | null>(null);
  if (!session.current) {
    session.current = new DocumentSession(content);
    session.current.selection = position?.selection ?? 0;
    session.current.scrollTop = position?.scroll ?? 0;
  }
  const doc = session.current;
  const inner = useRef<TextHandle>(null);
  const [, redraw] = useState(0);
  const [jump, setJump] = useState<number>();
  const [outline, setOutline] = useState(false);
  const [ratio, setRatio] = useState(50);
  const [insertOpen, setInsertOpen] = useState(false);
  const insertMenuId = useId();
  const pendingInsertFocus = useRef<"first" | "last">(null);
  const insertButton = useRef<HTMLButtonElement>(null);
  const insertRoot = useRef<HTMLDivElement>(null);
  const formattingHost = useRef<HTMLDivElement>(null);
  const editorRoot = useRef<HTMLDivElement>(null);
  const [compactTools, setCompactTools] = useState(false);
  useEffect(() => {
    const host = editorRoot.current;
    if (!host) return;
    const refresh = () => {
      const width = host.getBoundingClientRect().width;
      setCompactTools(width > 0 && width <= 520);
    };
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(refresh);
    observer?.observe(host);
    window.addEventListener("resize", refresh);
    refresh();
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", refresh);
    };
  }, []);
  useEffect(() => {
    if (!insertOpen) return;
    if (pendingInsertFocus.current) {
      const items = insertRoot.current?.querySelectorAll<HTMLButtonElement>(
        '[role="menuitem"]:not(:disabled)',
      );
      if (items?.length)
        items[
          pendingInsertFocus.current === "first" ? 0 : items.length - 1
        ].focus();
      pendingInsertFocus.current = null;
    }
    const outside = (event: PointerEvent) => {
      if (!insertRoot.current?.contains(event.target as Node))
        setInsertOpen(false);
    };
    document.addEventListener("pointerdown", outside, true);
    return () => document.removeEventListener("pointerdown", outside, true);
  }, [insertOpen]);
  const kind = documentKind(path);
  const publish = () => {
    redraw((n) => n + 1);
    onChange(doc.content);
  };
  const sync = () => {
    const live = inner.current?.getContent();
    if (live !== undefined && live !== doc.content) {
      doc.commit(live, mode === "visual" ? "visual" : "source");
      publish();
    }
    return doc.content;
  };
  const undo = () => {
    sync();
    if (doc.undo()) publish();
  };
  const redo = () => {
    sync();
    if (doc.redo()) publish();
  };
  useImperativeHandle(handleRef, () => ({
    getContent: sync,
    undo,
    redo,
    captureInsertion: () => {
      sync();
      if (!inner.current || kind !== "markdown")
        throw Error("请先打开一篇 Markdown 文档并选择插入位置。");
      return {
        revision: doc.revision,
        selection: inner.current.captureSelection(),
      };
    },
    insertMarkdown: (text, target) => {
      sync();
      if (!inner.current || target.revision !== doc.revision)
        throw Error("文档已变化，请关闭预览后重新选择插入位置。");
      if (kind !== "markdown") throw Error("回答只能插入 Markdown 文档。");
      inner.current.insertMarkdown(text, target.selection);
      sync();
    },
  }));
  const apply = (base: string, next: string) => {
    try {
      sync();
      if (doc.apply(base, next)) publish();
    } catch (e) {
      onError(String(e));
    }
  };
  useEffect(() => {
    if (content !== doc.content) {
      doc.commit(content, "structure");
      redraw((n) => n + 1);
    }
  }, [content]);
  const headings = useMemo(
    () => (kind === "markdown" && outline ? headingOutline(doc.content) : []),
    [kind, doc.content, outline],
  );
  const locate = (n: number) => {
    setJump(undefined);
    requestAnimationFrame(() => setJump(n));
  };
  const visualAllowed = kind === "markdown" && doc.content.length <= 300000;
  const actualVisual = mode === "visual" && visualAllowed;
  const previewTooLarge = doc.content.length > 300000;
  const hasPreview =
    !previewTooLarge &&
    (mode === "split" ||
      mode === "mindmap" ||
      (mode === "visual" && !actualVisual));
  return (
    <div
      ref={editorRoot}
      data-compact-tools={compactTools}
      className={`document-editor ${hasPreview ? "has-preview" : ""}`}
      onKeyDownCapture={(event) => {
        const target = event.target as HTMLElement;
        if (
          insertOpen &&
          !isImeEvent(event.nativeEvent) &&
          ["Escape", "ArrowDown", "ArrowUp"].includes(event.key)
        ) {
          event.preventDefault();
          event.stopPropagation();
          if (event.key === "Escape") {
            setInsertOpen(false);
            insertButton.current?.focus();
          } else {
            const items = Array.from(
              insertRoot.current?.querySelectorAll<HTMLButtonElement>(
                '[role="menuitem"]:not(:disabled)',
              ) ?? [],
            );
            const index = items.indexOf(
              document.activeElement as HTMLButtonElement,
            );
            const up = event.key === "ArrowUp";
            items[
              index < 0
                ? up
                  ? items.length - 1
                  : 0
                : (index + (up ? -1 : 1) + items.length) % items.length
            ]?.focus();
          }
          return;
        }
        if (event.key === "/") setInsertOpen(false);
        if (
          (target.matches("input,textarea,select") &&
            !target.hasAttribute("data-document-editor")) ||
          isImeEvent(event.nativeEvent)
        )
          return;
        if (
          (event.metaKey || event.ctrlKey) &&
          event.key.toLowerCase() === "z"
        ) {
          event.preventDefault();
          event.stopPropagation();
          event.nativeEvent.stopImmediatePropagation();
          event.shiftKey ? redo() : undo();
        }
      }}
    >
      <div className="editor-tools" role="group" aria-label="编辑操作">
        <div className="history-tools" role="group" aria-label="历史操作">
          <button
            onClick={undo}
            disabled={!doc.canUndo}
            title="撤销 · ⌘Z"
            aria-label="撤销"
          >
            <Undo2 size={17} strokeWidth={1.75} aria-hidden="true" />
          </button>
          <button
            onClick={redo}
            disabled={!doc.canRedo}
            title="重做 · ⇧⌘Z"
            aria-label="重做"
          >
            <Redo2 size={17} strokeWidth={1.75} aria-hidden="true" />
          </button>
        </div>
        <div
          ref={formattingHost}
          className="formatting-host milkdown"
          hidden={!actualVisual}
          role="toolbar"
          aria-label="文字格式"
        />
        {kind === "markdown" && (
          <>
            <button
              className={outline ? "selected" : ""}
              onClick={() => setOutline(!outline)}
              aria-label="文档大纲"
              aria-pressed={outline}
              title="文档大纲"
            >
              <ListTree size={17} strokeWidth={1.75} aria-hidden="true" />
              <span className="toolbar-label">大纲</span>
            </button>
            {!actualVisual && <span className="tools-spacer" />}
            <div
              className="insert-control"
              ref={insertRoot}
              onBlur={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node | null))
                  setInsertOpen(false);
              }}
            >
              <button
                ref={insertButton}
                type="button"
                aria-haspopup="menu"
                aria-expanded={insertOpen}
                aria-controls={insertOpen ? insertMenuId : undefined}
                onMouseDown={(e) => e.preventDefault()}
                onKeyDown={(event) => {
                  if (
                    insertOpen ||
                    isImeEvent(event.nativeEvent) ||
                    !["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)
                  )
                    return;
                  event.preventDefault();
                  pendingInsertFocus.current =
                    event.key === "ArrowUp" ? "last" : "first";
                  inner.current?.closeMenus();
                  setInsertOpen(true);
                }}
                onClick={() => {
                  inner.current?.closeMenus();
                  setInsertOpen(!insertOpen);
                }}
              >
                <Plus size={16} strokeWidth={1.8} />
                插入
                <ChevronDown size={14} strokeWidth={1.8} />
              </button>
              {insertOpen && (
                <div
                  className="insert-menu"
                  id={insertMenuId}
                  role="menu"
                  aria-label="插入内容"
                >
                  {insertCommands.map((command) => (
                    <button
                      key={command.id}
                      type="button"
                      role="menuitem"
                      disabled={!actualVisual && command.id === "clear"}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        inner.current?.runInsertCommand(command.id);
                        setInsertOpen(false);
                      }}
                    >
                      <command.Icon size={15} />
                      {command.label}
                    </button>
                  ))}
                  <span>空段输入 / 也可插入</span>
                </div>
              )}
            </div>
          </>
        )}
        {kind === "mermaid" && (
          <select
            aria-label="替换为图表模板（可撤销）"
            value=""
            onChange={(e) => {
              const template = diagramTemplates[e.target.value];
              if (template) {
                sync();
                apply(doc.content, template);
              }
            }}
          >
            <option value="">替换为模板（可撤销）</option>
            {Object.keys(diagramTemplates).map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        )}
      </div>
      {!visualAllowed && mode === "visual" && (
        <div className="preview-help">
          此内容保留源码编辑与实时预览，避免转换损失。
        </div>
      )}
      {previewTooLarge && mode !== "source" && (
        <div className="preview-help">
          文档超过 300 KB，已保留源码编辑以保持流畅；请精简后预览。
        </div>
      )}
      <div className="editor-panes">
        {outline && kind === "markdown" && (
          <nav className="document-outline" aria-label="文档大纲">
            {headings.map((h) => (
              <button
                key={h.line}
                style={{ paddingLeft: 10 + (h.depth - 1) * 10 }}
                onClick={() => locate(h.line)}
              >
                {h.label}
              </button>
            ))}
            {!headings.length && <p>暂无标题</p>}
          </nav>
        )}
        <div
          className="editor-source-pane"
          style={hasPreview ? { flexBasis: `${ratio}%` } : undefined}
        >
          <TextEditor
            handleRef={inner}
            toolbarHost={formattingHost}
            viewKey={viewKey}
            content={doc.content}
            path={path}
            mode={actualVisual ? "visual" : "source"}
            line={jump ?? line}
            session={doc}
            onPosition={onPosition}
            onOpenDoc={onOpenDoc}
            onChange={(value, structure) => {
              if (
                doc.commit(
                  value,
                  structure ? "structure" : actualVisual ? "visual" : "source",
                )
              )
                publish();
            }}
            onError={onError}
          />
        </div>
        {hasPreview && (
          <>
            <div className="split-divider">
              <input
                aria-label="编辑与预览宽度"
                type="range"
                min="25"
                max="75"
                value={ratio}
                onChange={(e) => setRatio(Number(e.target.value))}
              />
            </div>
            <div className="editor-preview-pane">
              {mode === "mindmap" && kind === "markdown" ? (
                <Mindmap
                  viewKey={`${viewKey}:outline`}
                  source={doc.content}
                  onApply={apply}
                  onLocate={locate}
                  onError={onError}
                />
              ) : kind === "json" ? (
                <JsonTree
                  viewKey={`${viewKey}:document`}
                  source={doc.content}
                  onApply={apply}
                  onLocate={locate}
                />
              ) : kind === "mermaid" ? (
                <Graph
                  kind="mermaid"
                  source={doc.content}
                  onError={onError}
                  onLocate={locate}
                />
              ) : kind === "text" ? (
                <pre className="plain-preview">{doc.content}</pre>
              ) : (
                <Markdown
                  viewKey={viewKey}
                  source={doc.content}
                  path={path}
                  onApply={apply}
                  onLocate={locate}
                  onError={onError}
                  onOpenDoc={onOpenDoc}
                />
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

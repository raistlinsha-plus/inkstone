import { isMermaidMindmap } from "./preview/mermaidMindmap";
import { mindName } from "./library/mediaTypes";
import StandaloneMindmap from "./preview/StandaloneMindmap";
import { msg } from "./i18n";
import { dismissOnOutside } from "./platform/menu";
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
import type { EditorPosition } from "./document/editorSession";
import TextEditor, { type EditorHandle as TextHandle } from "./TextEditor";
import { DocumentSession, documentKind } from "./session";
import { headingOutline } from "./content/blocks";

import JsonTree from "./preview/JsonTree";
import Markdown from "./preview/Markdown";
import Graph from "./preview/Graph";
import { insertCommands } from "./rich/commands";
import type { AnswerSourceLink } from "./content/answerSourceLink";
import { ChevronDown, Plus, Undo2, Redo2, ListTree } from "lucide-react";
export type EditorMode = "source" | "visual" | "split" | "mindmap";
export interface InsertionTarget {
  revision: number;
  selection: ReturnType<TextHandle["captureSelection"]>;
}
export interface EditorHandle {
  focus: () => void;
  capturePosition: () => EditorPosition | undefined;
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
  onOpenSource?: () => void;
  path: string;
  fileTitle?: string;
  viewKey?: string;
  line?: number;
  onChange: (value: string) => void;
  onError: (e: string) => void;
  onPosition?: (selection: number, scroll: number) => void;
  position?: EditorPosition;
  onOpenDoc?: (path: string) => void;
  onOpenAnswerSource?: (source: AnswerSourceLink) => void;
}
const diagramTemplates: Record<string, string> = {
  flowchart: "flowchart LR\n  A[开始] --> B[完成]\n",
  sequenceDiagram:
    "sequenceDiagram\n  participant U as 用户\n  participant I as 砚台\n  U->>I: 保存资料\n  I-->>U: 完成\n",
  classDiagram: "classDiagram\n  class 文档 {\n    +标题\n    +保存()\n  }\n",
  "stateDiagram-v2":
    "stateDiagram-v2\n  [*] --> 编辑\n  编辑 --> 已保存: 保存\n  已保存 --> 编辑: 修改\n",
  mindmap: "mindmap\n  root(中心主题)\n    分支一\n    分支二\n",
};

export default function Editor({
  handleRef,
  content,
  mode,
  onOpenSource,
  path,
  fileTitle = path.split(/[\\/]/).pop() || path,
  viewKey = path,
  line,
  onChange,
  onError,
  onPosition,
  position,
  onOpenDoc,
  onOpenAnswerSource,
}: Props) {
  const session = useRef<DocumentSession | null>(null);
  if (!session.current) {
    session.current = new DocumentSession(content);
    session.current.selection = position?.selection ?? 0;
    session.current.selectionAnchor = position?.anchor;
    session.current.scrollTop = position?.scroll ?? 0;
    if (position?.visual && mode === "visual") {
      session.current.positionMode = "visual";
      session.current.visualSelection = position.visual.head;
      session.current.visualAnchor = position.visual.anchor;
      session.current.visualScrollTop = position.scroll;
    }
  }
  const doc = session.current;
  const inner = useRef<TextHandle>(null);
  const [, redraw] = useState(0);
  const [externalRevision, setExternalRevision] = useState(0);
  const [jump, setJump] = useState<number>();
  const [outline, setOutline] = useState(false);
  const [ratio, setRatio] = useState(50);
  const sourcePaneId = useId();
  const resizeStart = useRef({ x: 0, ratio: 50, paneWidth: 0 });
  const resizeSplit = (value: number) =>
    setRatio(Math.min(75, Math.max(25, Math.round(value))));
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
    const root = insertRoot.current;
    if (!root) return;
    return dismissOnOutside((event) => event.composedPath().includes(root), () => setInsertOpen(false));
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
  // Only commands that originate outside the active text view may rewrite it.
  const publishReplacement = () => {
    setExternalRevision(n => n + 1);
    publish();
  };
  const undo = () => {
    sync();
    if (doc.undo()) publishReplacement();
  };
  const redo = () => {
    sync();
    if (doc.redo()) publishReplacement();
  };
  useImperativeHandle(handleRef, () => ({
    getContent: sync,
    focus: () => inner.current?.focus(),
    capturePosition: () => inner.current?.capturePosition(),
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
  const applyMindChange = (base: string, next: string) => {
    sync();
    if (doc.apply(base, next)) publishReplacement();
  };
  const apply = (base: string, next: string) => {
    try {
      applyMindChange(base, next);
    } catch (e) {
      onError(String(e));
    }
  };
  useEffect(() => {
    if (content !== doc.content) {
      doc.commit(content, "structure");
      setExternalRevision(n => n + 1);
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
  const standaloneMap = mindName(path);
  const canvasOnly = hasPreview && mode === "mindmap" && (standaloneMap || kind === "mermaid");
  return (
    <div
      data-map-canvas={canvasOnly || undefined}
      ref={editorRoot}
      data-compact-tools={compactTools}
      className={`document-editor ${hasPreview ? "has-preview" : ""}`}
      onKeyDownCapture={(event) => {
        const target = event.target as HTMLElement;
        if (
          insertOpen &&
          !isImeEvent(event.nativeEvent) &&
          ["Escape", "Tab", "ArrowDown", "ArrowUp"].includes(event.key)
        ) {
          if (event.key !== "Tab") event.preventDefault();
          event.stopPropagation();
          if (event.key === "Escape" || event.key === "Tab") {
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
      <div className="editor-tools" role="group" aria-label={msg("编辑操作")}>
        <div className="history-tools" role="group" aria-label={msg("历史操作")}>
          <button
            onClick={undo}
            disabled={!doc.canUndo}
            title={msg("撤销 · ⌘Z")}
            aria-label={msg("撤销")}
          >
            <Undo2 size={17} strokeWidth={1.75} aria-hidden="true" />
          </button>
          <button
            onClick={redo}
            disabled={!doc.canRedo}
            title={msg("重做 · ⇧⌘Z")}
            aria-label={msg("重做")}
          >
            <Redo2 size={17} strokeWidth={1.75} aria-hidden="true" />
          </button>
        </div>
        <div
          ref={formattingHost}
          className="formatting-host milkdown"
          hidden={!actualVisual}
          role="toolbar"
          aria-label={msg("文字格式")}
        />
        {kind === "markdown" && !standaloneMap && (
          <>
            <button
              className={outline ? "selected" : ""}
              onClick={() => setOutline(!outline)}
              aria-label={msg("文档大纲")}
              aria-pressed={outline}
              title={msg("文档大纲")}
            >
              <ListTree size={17} strokeWidth={1.75} aria-hidden="true" />
              <span className="toolbar-label">{msg("大纲")}</span>
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
                {msg("插入")}
                <ChevronDown size={14} strokeWidth={1.8} />
              </button>
              {insertOpen && (
                <div
                  className="insert-menu"
                  id={insertMenuId}
                  role="menu"
                  aria-label={msg("插入内容")}
                >
                  {insertCommands.map((command) => (
                    <button
                      key={command.id}
                      type="button"
                      role="menuitem"
                      tabIndex={-1}
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
                  <span>{msg("空段输入 / 也可插入")}</span>
                </div>
              )}
            </div>
          </>
        )}
        {kind === "mermaid" && (!canvasOnly || !isMermaidMindmap(doc.content)) && (
          <select
            aria-label={msg("替换为图表模板（可撤销）")}
            value=""
            onChange={(e) => {
              const template = diagramTemplates[e.target.value];
              if (template) {
                sync();
                apply(doc.content, template);
              }
            }}
          >
            <option value="">{msg("替换为模板（可撤销）")}</option>
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
          {msg("此内容保留源码编辑与实时预览，避免转换损失。")}
        </div>
      )}
      {previewTooLarge && mode !== "source" && (
        <div className="preview-help">
          {msg("文档超过 300 KB，已保留源码编辑以保持流畅；请精简后预览。")}
        </div>
      )}
      <div className="editor-panes">
        {outline && kind === "markdown" && (
          <nav className="document-outline" aria-label={msg("文档大纲")}>
            {headings.map((h) => (
              <button
                key={h.line}
                style={{ paddingLeft: 10 + (h.depth - 1) * 10 }}
                onClick={() => locate(h.line)}
              >
                {h.label}
              </button>
            ))}
            {!headings.length && <p>{msg("暂无标题")}</p>}
          </nav>
        )}
        <div
          id={sourcePaneId}
          className="editor-source-pane"
          style={canvasOnly ? { display: "none" } : hasPreview ? { flex: `${ratio} 1 0px` } : undefined}
        >
          <TextEditor
            handleRef={inner}
            toolbarHost={formattingHost}
            viewKey={viewKey}
            content={doc.content}
            externalRevision={externalRevision}
            path={path}
            mode={actualVisual ? "visual" : "source"}
            line={jump ?? line}
            session={doc}
            onPosition={onPosition}
            onOpenDoc={onOpenDoc}
            onOpenAnswerSource={onOpenAnswerSource}
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
            {!canvasOnly && <div
              className="split-divider"
              role="separator"
              tabIndex={0}
              aria-label={msg("编辑与预览宽度")}
              aria-orientation="vertical"
              aria-controls={sourcePaneId}
              aria-valuemin={25}
              aria-valuemax={75}
              aria-valuenow={ratio}
              aria-valuetext={`编辑区 ${ratio}%`}
              onPointerDown={(event) => {
                if (!event.isPrimary || event.button !== 0) return;
                const divider = event.currentTarget;
                const source = divider.previousElementSibling!;
                const preview = divider.nextElementSibling!;
                resizeStart.current = {
                  x: event.clientX,
                  ratio,
                  paneWidth:
                    source.getBoundingClientRect().width +
                    preview.getBoundingClientRect().width,
                };
                divider.setPointerCapture(event.pointerId);
              }}
              onPointerMove={(event) => {
                if (!event.currentTarget.hasPointerCapture(event.pointerId))
                  return;
                const start = resizeStart.current;
                if (start.paneWidth)
                  resizeSplit(
                    start.ratio +
                      ((event.clientX - start.x) * 100) / start.paneWidth,
                  );
              }}
              onKeyDown={(event) => {
                const next = {
                  ArrowLeft: ratio - 5,
                  ArrowRight: ratio + 5,
                  Home: 25,
                  End: 75,
                }[event.key];
                if (next === undefined) return;
                event.preventDefault();
                resizeSplit(next);
              }}
            />}
            <div
              className="editor-preview-pane"
              style={{ flex: `${100 - ratio} 1 0px` }}
            >
              {(standaloneMap || (kind === "mermaid" && isMermaidMindmap(doc.content)) || (mode === "mindmap" && kind === "markdown")) ? (
                <StandaloneMindmap
                  title={fileTitle.replace(/\.mindmap( 副本\d+)?\.md$/i, "$1")}
                  viewKey={viewKey}
                  source={doc.content}
                  format={kind === "mermaid" ? "mermaid" : "markdown"}
                  onOpenSource={onOpenSource}
                  onApply={applyMindChange}
                  onLocate={mode === "mindmap" && !standaloneMap && kind === "markdown" ? locate : undefined}
                  onError={onError}
                  onHistory={(back) => back ? undo() : redo()}
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
                  canvas={canvasOnly}
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
                  onOpenAnswerSource={onOpenAnswerSource}
                />
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

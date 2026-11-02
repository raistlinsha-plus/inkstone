import { isImeEvent } from "./platform/ime";
import {
  useEffect,
  useRef,
  useImperativeHandle,
  useState,
  type Ref,
  type RefObject,
} from "react";
import { EditorState } from "@codemirror/state";
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  drawSelection,
} from "@codemirror/view";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from "@codemirror/commands";
import {
  search,
  searchKeymap,
  highlightSelectionMatches,
} from "@codemirror/search";
import { markdown } from "@codemirror/lang-markdown";
import { json } from "@codemirror/lang-json";
import {
  foldGutter,
  bracketMatching,
  syntaxHighlighting,
  defaultHighlightStyle,
} from "@codemirror/language";
import { linter } from "@codemirror/lint";
import { jsonParseLinter } from "@codemirror/lang-json";
import type { DocumentSession } from "./session";
import { Crepe } from "@milkdown/crepe";
import { commandsCtx, editorViewCtx, parserCtx } from "@milkdown/kit/core";
import { invoke } from "@tauri-apps/api/core";
import { safeInlineBreaks } from "./rich/breaks";
import {
  commandIcon,
  hideCrepeMenu,
  insertCommands,
  insertSource,
  runInsertCommand,
} from "./rich/commands";
import { RichMarkdownAdapter } from "./rich/markdown";
import {
  NodeSelection,
  TextSelection,
  Plugin,
} from "@milkdown/kit/prose/state";
import { $prose } from "@milkdown/kit/utils";
import { sourceFromVisual, visualFromSource } from "./rich/positions";
import { insertMarkdownDocument } from "./rich/insertMarkdown";
import { revealTextPosition } from "./rich/navigation";
import { enhanceFormattingToolbar, formattingIcons } from "./rich/toolbar";
import {
  identityPlugin,
  rememberVisualBlockIdentities,
  restoreBlockIdentity,
} from "./rich/identity";
import { decodeLocalImageUrl } from "./content/urls";
import { contentBlockPlugin, revealSourceEvent } from "./rich/plugin";
import { revealAfterLayout } from "./rich/reveal";
import {
  blockSource,
  insertBlock as insertRichBlock,
  type BlockKind,
} from "./rich/blocks";
import "@milkdown/crepe/theme/common/style.css";
import "@milkdown/crepe/theme/frame.css";

export interface EditorHandle {
  getContent: () => string;
  insertBlock: (kind: BlockKind, calendarView?: "agenda" | "month") => void;
  runInsertCommand: (id: string) => void;
  closeMenus: () => void;
  captureSelection: () => { mode: "visual" | "source"; head: number };
  insertMarkdown: (
    text: string,
    target: { mode: "visual" | "source"; head: number },
  ) => void;
}
interface Props {
  handleRef?: Ref<EditorHandle>;
  toolbarHost?: RefObject<HTMLDivElement | null>;
  content: string;
  mode: "source" | "visual";
  path: string;
  viewKey?: string;
  line?: number;
  onChange: (value: string, structure?: boolean) => void;
  onError: (error: string) => void;
  session?: DocumentSession;
  onPosition?: (selection: number, scroll: number) => void;
  onOpenDoc?: (path: string) => void;
}
export default function TextEditor({
  content,
  mode,
  path,
  viewKey = path,
  line,
  onChange,
  onError,
  handleRef,
  toolbarHost,
  session,
  onPosition,
  onOpenDoc,
}: Props) {
  const root = useRef<HTMLDivElement>(null);
  const visual = useRef<Crepe | null>(null);
  const [readyVersion, setReadyVersion] = useState(0);
  const latest = useRef({ content, onPosition, onError, onOpenDoc });
  latest.current = { content, onPosition, onError, onOpenDoc };
  const applying = useRef(false);
  const adapter = useRef(new RichMarkdownAdapter(content));
  const callback = useRef(onChange);
  const source = useRef<EditorView | null>(null);
  const readCurrent = useRef<() => string>(() => content);
  useImperativeHandle(
    handleRef,
    () => ({
      getContent: () => readCurrent.current(),
      captureSelection: () => {
        if (visual.current?.editor.status === "Created")
          return visual.current.editor.action((ctx) => ({
            mode: "visual" as const,
            head: ctx.get(editorViewCtx).state.selection.head,
          }));
        if (source.current)
          return {
            mode: "source",
            head: source.current.state.selection.main.head,
          };
        throw Error("编辑器尚未就绪，请稍后再试。");
      },
      insertMarkdown: (text, target) => {
        if (
          target.mode === "visual" &&
          visual.current?.editor.status === "Created"
        ) {
          publishStructure.current(false);
          applying.current = true;
          try {
            visual.current.editor.action((ctx) => {
              const view = ctx.get(editorViewCtx);
              if (view.composing) throw Error("请先完成当前输入。");
              const parsed = ctx.get(parserCtx)(
                adapter.current.prepare(text, "fragment"),
              );
              if (!parsed)
                throw Error("回答内容无法转换，请复制 Markdown 后检查。");
              insertMarkdownDocument(view, parsed, target.head);
              view.focus();
              requestAnimationFrame(() => {
                if (view.dom.isConnected) view.focus();
              });
            });
          } finally {
            applying.current = false;
          }
          publishStructure.current(true);
        } else if (target.mode === "source" && source.current) {
          const view = source.current,
            head = Math.min(target.head, view.state.doc.length);
          applying.current = true;
          try {
            view.dispatch({
              changes: { from: head, insert: "\n\n" + text + "\n\n" },
              selection: { anchor: head + text.length + 4 },
            });
          } finally {
            applying.current = false;
          }
          callback.current(view.state.doc.toString(), true);
          view.focus();
        } else throw Error("编辑模式已变化，请重新选择插入位置。");
      },
      closeMenus: () => {
        if (visual.current?.editor.status === "Created")
          visual.current.editor.action(hideCrepeMenu);
      },
      runInsertCommand: (id) => {
        if (visual.current?.editor.status === "Created") {
          publishStructure.current(false);
          visual.current.editor.action((ctx) => {
            hideCrepeMenu(ctx);
            runInsertCommand(
              ctx,
              id,
              ctx.get(editorViewCtx).state.selection.$from.parent
                .textContent === "/",
            );
          });
          publishStructure.current(true);
        } else if (source.current) {
          const view = source.current,
            sel = view.state.selection.main;
          const text =
            "\n\n" +
            insertSource(id, view.state.sliceDoc(sel.from, sel.to)) +
            "\n\n";
          view.dispatch({
            changes: { from: sel.from, to: sel.to, insert: text },
            selection: { anchor: sel.from + text.length },
          });
          view.focus();
        }
      },
      insertBlock: (kind, calendarView = "agenda") => {
        if (visual.current?.editor.status === "Created") {
          publishStructure.current(false);
          visual.current.editor.action((ctx) =>
            insertRichBlock(ctx.get(editorViewCtx), kind, calendarView),
          );
          publishStructure.current(true);
        } else if (source.current) {
          const view = source.current,
            sel = view.state.selection.main;
          const text =
            "\n\n```" +
            kind +
            "\n" +
            blockSource(kind, calendarView) +
            "\n```\n\n";
          view.dispatch({
            changes: { from: sel.from, to: sel.to, insert: text },
            selection: { anchor: sel.from + text.length },
          });
          view.focus();
        }
      },
    }),
    [],
  );
  callback.current = onChange;
  const publishStructure = useRef<(structure: boolean) => void>(() => {});
  useEffect(() => {
    if (!root.current) return;
    if (mode === "source") {
      const view = new EditorView({
        parent: root.current,
        state: EditorState.create({
          doc: content,
          extensions: [
            EditorView.contentAttributes.of({
              "aria-label": "文档源码",
              spellcheck: "false",
            }),
            EditorView.domEventHandlers({
              scroll: (_event, view) => {
                if (session) session.scrollTop = view.scrollDOM.scrollTop;
                latest.current.onPosition?.(
                  view.state.selection.main.head,
                  view.scrollDOM.scrollTop,
                );
              },
            }),
            lineNumbers(),
            history(),
            drawSelection(),
            highlightActiveLine(),
            highlightSelectionMatches(),
            search({ top: true }),
            keymap.of([
              ...defaultKeymap,
              ...historyKeymap,
              ...searchKeymap,
              indentWithTab,
            ]),
            foldGutter(),
            bracketMatching(),
            syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
            ...(/\.json$/i.test(path)
              ? [json(), linter(jsonParseLinter())]
              : /\.(txt|mmd)$/i.test(path)
                ? []
                : [markdown()]),
            EditorView.lineWrapping,
            EditorView.updateListener.of((update) => {
              if (update.docChanged && !applying.current)
                callback.current(update.state.doc.toString());
              if (update.selectionSet || update.docChanged) {
                if (session) {
                  session.selection = update.state.selection.main.head;
                  session.selectionAnchor = update.state.selection.main.anchor;
                }
                latest.current.onPosition?.(
                  update.state.selection.main.head,
                  view.scrollDOM.scrollTop,
                );
              }
            }),
            EditorView.theme({
              "&": { height: "100%", fontSize: "14px" },
              ".cm-scroller": {
                fontFamily: '"SFMono-Regular", Menlo, monospace',
                lineHeight: "1.9",
              },
              ".cm-content": { padding: "30px 24px" },
              ".cm-gutters": {
                background: "#faf9f6",
                border: "none",
                color: "#b3b0a8",
                paddingRight: "10px",
              },
              ".cm-activeLine": { background: "#eeece550" },
              ".cm-activeLineGutter": { background: "transparent" },
              "&.cm-focused": { outline: "none" },
              ".cm-cursor": { borderLeftColor: "#396c57" },
            }),
          ],
        }),
      });
      source.current = view;
      view.dispatch({
        selection: {
          anchor: Math.min(
            session?.selectionAnchor ?? session?.selection ?? 0,
            view.state.doc.length,
          ),
          head: Math.min(session?.selection ?? 0, view.state.doc.length),
        },
      });
      if (session?.positionMode === "visual")
        view.dispatch({
          effects: EditorView.scrollIntoView(view.state.selection.main.head, {
            y: "center",
          }),
        });
      else view.scrollDOM.scrollTop = session?.scrollTop ?? 0;
      if (session) session.positionMode = "source";
      const baseline = view.state.doc;
      readCurrent.current = () =>
        view.state.doc.eq(baseline) ? content : view.state.doc.toString();
      return () => {
        if (session) {
          session.selection = view.state.selection.main.head;
          session.selectionAnchor = view.state.selection.main.anchor;
          session.scrollTop = view.scrollDOM.scrollTop;
          session.positionMode = "source";
        }
        readCurrent.current = () => content;
        source.current = null;
        view.destroy();
      };
    }
    adapter.current = new RichMarkdownAdapter(content);
    let cancelled = false;
    let ready = false;
    let canonical = "";
    let cleanupToolbar = () => {};
    let captureVisual = () => {};
    const crepe = new Crepe({
      root: root.current,
      defaultValue: adapter.current.prepare(content),
      features: {
        [Crepe.Feature.Latex]: false,
        [Crepe.Feature.AI]: false,
        [Crepe.Feature.CodeMirror]: false,
        [Crepe.Feature.TopBar]: true,
      },
      featureConfigs: {
        [Crepe.Feature.BlockEdit]: {
          buildMenu: (builder) => {
            builder.clear();
            for (const group of ["文本", "列表", "内容块", "插入内容"]) {
              const items = builder.addGroup(group, group);
              for (const command of insertCommands.filter(
                (item) => item.group === group,
              )) {
                items.addItem(command.id, {
                  label: command.label,
                  icon: commandIcon(command),
                  onRun: (ctx) => {
                    publishStructure.current(false);
                    runInsertCommand(ctx, command.id, true);
                    publishStructure.current(true);
                  },
                });
              }
            }
          },
          textGroup: {
            label: "文本",
            text: { label: "正文" },
            h1: { label: "标题 1" },
            h2: { label: "标题 2" },
            h3: { label: "标题 3" },
            h4: { label: "标题 4" },
            h5: { label: "标题 5" },
            h6: { label: "标题 6" },
            quote: { label: "引用" },
            divider: { label: "分隔线" },
          },
          listGroup: {
            label: "列表",
            bulletList: { label: "无序列表" },
            orderedList: { label: "有序列表" },
            taskList: { label: "任务列表" },
          },
          advancedGroup: {
            label: "内容块",
            image: { label: "本地图片" },
            codeBlock: { label: "代码块" },
            table: { label: "表格" },
            math: null,
          },
        },
        [Crepe.Feature.TopBar]: {
          ...formattingIcons,
          buildTopBar: (builder) => {
            builder.getGroup("block").clear();
            builder.getGroup("more").clear();
            const insert = builder.getGroup("insert");
            insert.group.items = insert.group.items.filter(
              (item) => item.key === "link",
            );
            for (const item of builder.getGroup("list").group.items) {
              const name =
                item.key === "bullet-list"
                  ? "bullet_list"
                  : item.key === "ordered-list"
                    ? "ordered_list"
                    : "list_item";
              item.active = (ctx) => {
                const { $from } = ctx.get(editorViewCtx).state.selection;
                for (let depth = $from.depth; depth > 0; depth--) {
                  const node = $from.node(depth);
                  if (
                    node.type.name === name &&
                    (name !== "list_item" ||
                      typeof node.attrs.checked === "boolean")
                  )
                    return true;
                }
                return false;
              };
            }
            const groups = builder
              .build()
              .filter((group) => group.items.length);
            builder.clear();
            for (const group of groups) {
              const next = builder.addGroup(group.key, group.label);
              for (const item of group.items) next.addItem(item.key, item);
            }
          },
          headingOptions: [
            { label: "正文", level: null },
            ...[1, 2, 3, 4, 5, 6].map((level) => ({
              label: `标题 ${level}`,
              level,
            })),
          ],
        },
        [Crepe.Feature.LinkTooltip]: { inputPlaceholder: "输入链接地址" },
        [Crepe.Feature.CodeMirror]: {
          previewToggleText: (mode) => (mode ? "编辑代码" : "预览代码"),
        },
        [Crepe.Feature.Placeholder]: { text: "从一个想法开始…" },
        [Crepe.Feature.ImageBlock]: {
          proxyDomURL: async (url) => {
            try {
              return await invoke<string>("resolve_image", {
                documentPath: path,
                url: decodeLocalImageUrl(url),
              });
            } catch {
              return "";
            }
          },
          onUpload: async () => {
            throw new Error("请使用工作区内图片的相对路径");
          },
          inlineUploadPlaceholderText: "输入本地图片相对路径",
          blockUploadPlaceholderText: "输入本地图片相对路径",
        },
        [Crepe.Feature.Toolbar]: {
          boldLabel: "粗体",
          italicLabel: "斜体",
          codeLabel: "行内代码",
          linkLabel: "链接",
          strikethroughLabel: "删除线",
        },
      },
    });
    crepe.editor.use(safeInlineBreaks);
    crepe.editor.use($prose(() => identityPlugin(viewKey, content)));
    crepe.editor.use(
      $prose(
        () =>
          new Plugin({
            view: () => ({
              update(view) {
                if (session && ready && !cancelled) {
                  session.visualAnchor = view.state.selection.anchor;
                  session.visualSelection =
                    view.state.selection instanceof NodeSelection
                      ? view.state.selection.from + 1
                      : view.state.selection.head;
                }
              },
            }),
          }),
      ),
    );
    crepe.editor.use(
      contentBlockPlugin(
        (structure) => publishStructure.current(structure),
        viewKey,
      ),
    );
    visual.current = crepe;
    publishStructure.current = (structure) => {
      if (!ready || cancelled) return;
      canonical = readCurrent.current();
      crepe.editor.action((ctx) =>
        rememberVisualBlockIdentities(
          viewKey,
          canonical,
          ctx.get(editorViewCtx).state,
        ),
      );
      callback.current(canonical, structure);
    };
    crepe.on((listener) =>
      listener.markdownUpdated((_, markdown) => {
        const value = readCurrent.current();
        if (ready && !cancelled && !applying.current && value !== canonical) {
          canonical = value;
          crepe.editor.action((ctx) =>
            rememberVisualBlockIdentities(
              viewKey,
              value,
              ctx.get(editorViewCtx).state,
            ),
          );
          callback.current(value);
        }
      }),
    );
    const creation = crepe
      .create()
      .then(() => {
        const serializedBaseline = adapter.current.serialize(
          crepe.getMarkdown(),
        );
        const baseline = crepe.editor.action(
          (ctx) => ctx.get(editorViewCtx).state.doc,
        );
        readCurrent.current = () => {
          if (
            crepe.editor
              .action((ctx) => ctx.get(editorViewCtx).state.doc)
              .eq(baseline)
          )
            return content;
          const next = adapter.current.serialize(crepe.getMarkdown());
          return next === serializedBaseline ? content : next;
        };
        canonical = content;
        ready = true;
        if (cancelled) return crepe.destroy();
        crepe.editor.action((ctx) => {
          const view = ctx.get(editorViewCtx);
          const head =
            session?.positionMode === "visual"
              ? session.visualSelection
              : visualFromSource(
                  view.state.doc,
                  session?.selection ?? 0,
                  content,
                );
          const anchor =
            session?.positionMode === "visual"
              ? (session.visualAnchor ?? head)
              : visualFromSource(
                  view.state.doc,
                  session?.selectionAnchor ?? session?.selection ?? 0,
                  content,
                );
          const resolved = view.state.doc.resolve(
            Math.max(0, Math.min(head, view.state.doc.content.size)),
          );
          const selection =
            resolved.depth > 0 && resolved.parent.type.name === "code_block"
              ? NodeSelection.create(view.state.doc, resolved.before())
              : TextSelection.create(
                  view.state.doc,
                  TextSelection.near(
                    view.state.doc.resolve(
                      Math.max(
                        0,
                        Math.min(anchor, view.state.doc.content.size),
                      ),
                    ),
                  ).anchor,
                  TextSelection.near(resolved).head,
                );
          view.dispatch(
            view.state.tr
              .setSelection(selection)
              .setMeta("addToHistory", false),
          );
          const surface = root.current;
          const previousMode = session?.positionMode;
          requestAnimationFrame(() => {
            if (cancelled || !surface) return;
            if (previousMode === "visual")
              surface.scrollTop = session?.visualScrollTop ?? 0;
            else
              view.dispatch(
                view.state.tr.scrollIntoView().setMeta("addToHistory", false),
              );
          });
          if (session) session.positionMode = "visual";
          captureVisual = () => {
            if (!session || cancelled || crepe.editor.status !== "Created")
              return;
            rememberVisualBlockIdentities(
              viewKey,
              readCurrent.current(),
              view.state,
            );
            session.visualAnchor = view.state.selection.anchor;
            session.selectionAnchor = sourceFromVisual(
              view.state.doc,
              view.state.selection.anchor,
              readCurrent.current(),
              view.state.selection.anchor < view.state.selection.head
                ? "forward"
                : "backward",
            );
            session.visualSelection =
              view.state.selection instanceof NodeSelection
                ? view.state.selection.from + 1
                : view.state.selection.head;
            session.visualScrollTop = surface?.scrollTop ?? 0;
            session.selection = sourceFromVisual(
              view.state.doc,
              view.state.selection instanceof NodeSelection
                ? view.state.selection.from + 1
                : view.state.selection.head,
              readCurrent.current(),
              view.state.selection.head < view.state.selection.anchor
                ? "forward"
                : "backward",
            );
            session.positionMode = "visual";
            latest.current.onPosition?.(
              session.selection,
              session.visualScrollTop,
            );
          };
        });
        setReadyVersion((n) => n + 1);
        const bar =
          root.current?.querySelector<HTMLElement>(".milkdown-top-bar");
        if (bar && toolbarHost?.current) toolbarHost.current.append(bar);
        const toolbar = bar
          ? enhanceFormattingToolbar(bar, (button) => {
              if (button.getAttribute("aria-label") === "链接") return;
              requestAnimationFrame(() => {
                if (!cancelled && crepe.editor.status === "Created")
                  crepe.editor.action((ctx) => ctx.get(editorViewCtx).focus());
              });
            })
          : null;
        const labelBar = () => {
          toolbar?.refresh();
          const selector = bar?.querySelector<HTMLElement>(
            ".top-bar-heading-button",
          );
          const dropdown = bar?.querySelector<HTMLElement>(
            ".top-bar-heading-dropdown",
          );
          selector?.setAttribute("aria-expanded", String(!!dropdown));
          if (selector && dropdown) {
            const rect = selector.getBoundingClientRect();
            Object.assign(dropdown.style, {
              position: "fixed",
              left: `${rect.left}px`,
              top: `${rect.bottom + 4}px`,
              maxHeight: `${Math.max(100, Math.min(320, window.innerHeight - rect.bottom - 16))}px`,
              overflowY: "auto",
              zIndex: "80",
            });
          }
        };
        labelBar();
        const observer = new MutationObserver(labelBar);
        if (bar)
          observer.observe(bar, {
            subtree: true,
            childList: true,
            attributes: true,
            attributeFilter: ["class"],
          });
        const focusAfterAction = (button: HTMLButtonElement) => {
          if (
            button.classList.contains("top-bar-heading-button") ||
            button.getAttribute("aria-label") === "链接"
          )
            return;
          requestAnimationFrame(() => {
            if (!cancelled && crepe.editor.status === "Created")
              crepe.editor.action((ctx) => ctx.get(editorViewCtx).focus());
          });
        };
        const keyboard = (event: KeyboardEvent) => {
          if (isImeEvent(event)) return;
          const button = (
            event.target as HTMLElement
          ).closest<HTMLButtonElement>("button");
          if (!button || !bar?.contains(button)) return;
          if (["ArrowDown", "ArrowUp"].includes(event.key)) {
            const dropdown = bar.querySelector(".top-bar-heading-dropdown");
            if (
              button.classList.contains("top-bar-heading-button") ||
              dropdown?.contains(button)
            ) {
              event.preventDefault();
              if (!dropdown)
                button.dispatchEvent(
                  new PointerEvent("pointerdown", {
                    bubbles: true,
                    cancelable: true,
                  }),
                );
              requestAnimationFrame(() => {
                const options = Array.from(
                  bar.querySelectorAll<HTMLButtonElement>(
                    ".top-bar-heading-option",
                  ),
                );
                const index = options.indexOf(button);
                options[
                  index < 0
                    ? event.key === "ArrowUp"
                      ? options.length - 1
                      : 0
                    : (index +
                        (event.key === "ArrowDown" ? 1 : options.length - 1) +
                        options.length) %
                      options.length
                ]?.focus();
              });
            }
          }
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            button.dispatchEvent(
              new PointerEvent("pointerdown", {
                bubbles: true,
                cancelable: true,
              }),
            );
            focusAfterAction(button);
          }
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            const selected = bar.querySelector<HTMLButtonElement>(
              ".top-bar-heading-button",
            );
            if (bar.querySelector(".top-bar-heading-dropdown")) {
              selected?.dispatchEvent(
                new PointerEvent("pointerdown", {
                  bubbles: true,
                  cancelable: true,
                }),
              );
              selected?.focus();
            } else crepe.editor.action((ctx) => ctx.get(editorViewCtx).focus());
          }
        };
        bar?.addEventListener("keydown", keyboard);
        const hideSlash = () => crepe.editor.action(hideCrepeMenu);
        bar?.addEventListener("pointerdown", hideSlash, true);
        const accessibilityClick = (event: MouseEvent) => {
          if (
            event.detail !== 0 ||
            (event.target as HTMLElement).closest(
              ".format-overflow-button,.format-overflow-menu",
            )
          )
            return;
          const button = (
            event.target as HTMLElement
          ).closest<HTMLButtonElement>("button");
          button?.dispatchEvent(
            new PointerEvent("pointerdown", {
              bubbles: true,
              cancelable: true,
            }),
          );
          if (button) focusAfterAction(button);
        };
        bar?.addEventListener("click", accessibilityClick);
        window.addEventListener("resize", labelBar);
        cleanupToolbar = () => {
          observer.disconnect();
          toolbar?.destroy();
          bar?.removeEventListener("keydown", keyboard);
          bar?.removeEventListener("pointerdown", hideSlash, true);
          bar?.removeEventListener("click", accessibilityClick);
          window.removeEventListener("resize", labelBar);
        };
      })
      .catch((error) => {
        if (!cancelled) onError(String(error));
      });
    return () => {
      captureVisual();
      readCurrent.current = () => content;
      visual.current = null;
      cleanupToolbar();
      cancelled = true;
      ready = false;
      void creation
        .then(() => {
          if (crepe.editor.status !== "Destroyed") return crepe.destroy();
        })
        .catch(() => {});
    };
  }, [mode, path]);
  useEffect(() => {
    if (readCurrent.current() === content) return;
    const view = source.current;
    applying.current = true;
    if (view) {
      const anchor = Math.min(
        session?.selection ?? view.state.selection.main.head,
        content.length,
      );
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: content },
        selection: { anchor },
      });
      applying.current = false;
    } else if (visual.current && visual.current.editor.status === "Created") {
      try {
        visual.current.editor.action((ctx) => {
          const view = ctx.get(editorViewCtx);
          rememberVisualBlockIdentities(
            viewKey,
            readCurrent.current(),
            view.state,
          );
          const parsed = ctx.get(parserCtx)(adapter.current.prepare(content));
          if (!parsed) throw Error("文档内容无法读取，原文已保留。");
          view.dispatch(
            view.state.tr
              .replaceWith(0, view.state.doc.content.size, parsed.content)
              .setMeta(restoreBlockIdentity, content)
              .setMeta("addToHistory", false),
          );
        });
      } catch (error) {
        latest.current.onError(String(error));
      } finally {
        applying.current = false;
      }
    } else applying.current = false;
  }, [content, readyVersion]);
  useEffect(() => {
    const view = source.current;
    if (!view && line && visual.current?.editor.status === "Created") {
      const location = adapter.current.sourceLocation(content, line);
      if (!location) {
        visual.current.editor.action((ctx) => {
          const view = ctx.get(editorViewCtx);
          const rows = content.split("\n"),
            offset = rows
              .slice(0, Math.max(0, line - 1))
              .reduce((sum, row) => sum + row.length + 1, 0);
          const target = visualFromSource(view.state.doc, offset, content);
          revealTextPosition(view, target);
        });
        return;
      }
      let stop: (() => void) | undefined;
      visual.current.editor.action((ctx) => {
        const v = ctx.get(editorViewCtx);
        let ordinal = 0;
        v.state.doc.descendants((node, pos) => {
          if (node.type.name !== "code_block" || ordinal++ !== location.index)
            return;
          const element = v.nodeDOM(pos);
          if (!(element instanceof HTMLElement)) return false;
          v.dispatch(
            v.state.tr
              .setSelection(NodeSelection.create(v.state.doc, pos))
              .setMeta("addToHistory", false),
          );
          element.dispatchEvent(
            new CustomEvent(revealSourceEvent, {
              detail: {
                line: location.line,
                showCode:
                  String(node.attrs.language).toLowerCase() !== "calendar",
              },
            }),
          );
          stop = revealAfterLayout(v.dom, element);
          return false;
        });
      });
      return () => stop?.();
    }
    if (view && line) {
      const target = view.state.doc.line(
        Math.max(1, Math.min(line, view.state.doc.lines)),
      ).from;
      view.dispatch({
        selection: { anchor: target },
        effects: EditorView.scrollIntoView(target, { y: "center" }),
      });
      view.focus();
    }
  }, [line, mode, readyVersion]);
  return (
    <div
      className={`editor-surface ${mode}`}
      ref={root}
      onClickCapture={(event) => {
        const link = (event.target as HTMLElement).closest("a");
        if (link) {
          event.preventDefault();
          const url = link.getAttribute("href");
          // Ordinary clicks keep editing in the document; the link tooltip
          // supplies editing actions. Command/Ctrl-click explicitly opens it.
          if (url && !url.startsWith("#") && !event.metaKey && !event.ctrlKey)
            return;
          if (url && /^https?:\/\//i.test(url))
            void invoke("open_external", { url }).catch((e) =>
              latest.current.onError(String(e)),
            );
          else if (url?.startsWith("#")) {
            try {
              const target = decodeURIComponent(url.slice(1)),
                counts = new Map<string, number>();
              const heading = Array.from(
                root.current?.querySelectorAll<HTMLElement>(
                  ".ProseMirror :is(h1,h2,h3,h4,h5,h6)",
                ) ?? [],
              ).find((element) => {
                const base =
                  (element.textContent ?? "")
                    .trim()
                    .toLowerCase()
                    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
                    .replace(/\s/g, "-") || "section";
                const count = counts.get(base) ?? 0;
                counts.set(base, count + 1);
                return (count ? `${base}-${count}` : base) === target;
              });
              if (heading && visual.current?.editor.status === "Created")
                visual.current.editor.action((ctx) => {
                  const view = ctx.get(editorViewCtx),
                    position = view.posAtDOM(heading, 0);
                  revealTextPosition(view, position);
                });
            } catch (error) {
              latest.current.onError(String(error));
            }
          } else if (url && !url.includes(":")) {
            try {
              const base = new URL(path, "https://workspace.invalid/");
              const target = new URL(url, base);
              if (target.origin !== base.origin)
                throw Error("链接超出文档范围");
              if (!url.startsWith("#"))
                latest.current.onOpenDoc?.(
                  decodeURIComponent(target.pathname.slice(1)),
                );
            } catch (e) {
              latest.current.onError(String(e));
            }
          }
        }
      }}
    />
  );
}

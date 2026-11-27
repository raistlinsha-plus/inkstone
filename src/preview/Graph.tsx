import { msg } from "../i18n";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { createPortal } from "react-dom";
import { invoke, isTauri } from "@tauri-apps/api/core";
import {
  ZoomIn,
  ZoomOut,
  Download,
  Expand,
  Minimize2,
  Scan,
  Ratio,
} from "lucide-react";
import DOMPurify from "dompurify";
import type { MindNode } from "../content/mindmap";
import { graphViewport, loadViewport, saveViewport } from "./viewport";
import { parseChart } from "../content/chart";
import { lightGraphExport, previewTheme } from "./theme";
import "./graph.css";
export type MapAction = "child" | "sibling" | "rename" | "delete" | "undo" | "redo";
interface Props {
  kind: "mermaid" | "mindmap" | "chart";
  source: string;
  tree?: MindNode;
  selectedNode?: string;
  focusRequest?: number;
  canvas?: boolean;
  onNodeAction?: (id: string, action: MapAction) => void;
  onNode?: (id: string) => void;
  onError?: (message: string) => void;
  onLocate?: (line: number) => void;
  startLine?: number;
  viewKey?: string;
  toolbarHost?: HTMLElement | null;
  toolbarExtras?: React.ReactNode;
}
export function diagramProblem(source: string): string | null {
  if (source.length > 50000) return "图表超过 50 KB，请缩小内容后预览。";
  if (
    /%%\{|^---\s*$|\bclick\s+|<\/?[a-zA-Z]|url\s*\(|@import|\bhttps?:\/\//im.test(
      source,
    )
  )
    return "图表包含 HTML、外部资源、回调或配置指令，请移除后预览。";
  if ((source.match(/[\[({]/g) ?? []).length > 200)
    return "图表结构超过保护上限，请缩小内容后预览。";
  const type = source.trim().split(/\s/)[0];
  if (
    ![
      "flowchart",
      "graph",
      "sequenceDiagram",
      "classDiagram",
      "stateDiagram-v2",
      "mindmap",
    ].includes(type)
  )
    return "本版预览支持流程图、时序图、类图、状态图和 mindmap。源码仍可编辑。";
  if (
    source.split("\n").filter((s) => s.trim() && !s.trim().startsWith("%%"))
      .length > 201
  )
    return "图表超过 200 行保护上限，请精简后手动预览。";
  return null;
}
export async function exportSvg(svg: string, format: "svg" | "png" = "svg") {
  const clean = DOMPurify.sanitize(svg, {
    USE_PROFILES: { svg: true, svgFilters: true, html: true },
    ADD_TAGS: ["foreignObject"],
    FORBID_TAGS: ["script", "iframe", "image", "img", "a", "use"],
    FORBID_ATTR: ["href", "src", "xlink:href"],
  });
  let png = "";
  if (format === "png") {
    const parsed = new DOMParser().parseFromString(clean, "image/svg+xml");
    const svgNode = parsed.documentElement;
    if (svgNode.localName !== "svg" || parsed.querySelector("parsererror"))
      throw new Error("图表 SVG 格式无效，无法转换为 PNG。");
    const box = (svgNode.getAttribute("viewBox") ?? "")
      .split(/[ ,]+/)
      .map(Number);
    const width =
      Number.parseFloat(svgNode.getAttribute("width") ?? "") || box[2] || 960;
    const height =
      Number.parseFloat(svgNode.getAttribute("height") ?? "") || box[3] || 540;
    if (!(width > 0 && height > 0 && width <= 4096 && height <= 4096))
      throw new Error("图表导出尺寸超过保护范围。");
    const canvas = document.createElement("canvas");
    canvas.width = Math.min(4096, Math.round(width * 2));
    canvas.height = Math.min(4096, Math.round(height * 2));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("当前环境无法生成 PNG，请使用 SVG。");
    const imageUrl = URL.createObjectURL(
      new Blob([clean], { type: "image/svg+xml" }),
    );
    try {
      const image = new Image();
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error("图表 PNG 转换超时，请使用 SVG。")),
          10000,
        );
        image.onload = () => {
          clearTimeout(timer);
          resolve();
        };
        image.onerror = () => {
          clearTimeout(timer);
          reject(new Error("图表 PNG 转换失败，请使用 SVG。"));
        };
        image.src = imageUrl;
      });
      context.fillStyle = lightGraphExport;
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      png = canvas.toDataURL("image/png");
    } finally {
      URL.revokeObjectURL(imageUrl);
    }
  }
  if (isTauri()) {
    if (format === "png") await invoke("export_png", { dataUrl: png });
    else await invoke("export_svg", { content: clean });
  } else {
    const data =
      format === "png"
        ? Uint8Array.from(atob(png.split(",")[1]), (char) => char.charCodeAt(0))
        : clean;
    const url = URL.createObjectURL(
      new Blob([data], {
        type: format === "png" ? "image/png" : "image/svg+xml",
      }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `Inkstone-图表.${format}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
export default function Graph({
  kind,
  source,
  tree,
  onNode,
  selectedNode,
  focusRequest = 0,
  canvas = false,
  onNodeAction,
  onError,
  onLocate,
  startLine = 1,
  viewKey,
  toolbarHost,
  toolbarExtras,
}: Props) {
  const frame = useRef<HTMLIFrameElement>(null);
  const frameLoaded = useRef(false);
  const renderWhenLoaded = useRef<() => void>(() => {});
  const attachFrame = useCallback((element: HTMLIFrameElement | null) => {
    if (frame.current !== element) frameLoaded.current = false;
    frame.current = element;
  }, []);
  const viewport = useRef(loadViewport(viewKey));
  const [zoom, setZoom] = useState(100);
  const [canvasExpanded, setCanvasExpanded] = useState(false);
  const [frameHover, setFrameHover] = useState(false);
  const [measuredHeight, setMeasuredHeight] = useState(240);
  const compactHeight = useMemo(() => {
    if (kind !== "mindmap" || !tree) return measuredHeight;
    const leaves = (node: MindNode): number =>
      node.children.length
        ? node.children.reduce((sum, child) => sum + leaves(child), 0)
        : 1;
    return Math.max(200, leaves(tree) * 32 + 72);
  }, [kind, tree, measuredHeight]);
  const token = useMemo(() => crypto.randomUUID(), []);
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState("正在准备本地预览…");
  const [failed, setFailed] = useState(false);
  const [errorLine, setErrorLine] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState<number | null>(null);
  const problem = useMemo(() => {
    if (kind === "mermaid") return diagramProblem(source);
    if (kind === "chart") {
      try {
        parseChart(source);
      } catch (e) {
        return e instanceof Error ? e.message : String(e);
      }
    }
    return null;
  }, [kind, source]);
  const [debounced, setDebounced] = useState({ source, tree });
  const [theme, setTheme] = useState(() =>
    previewTheme(document.documentElement.dataset.theme),
  );
  useEffect(() => {
    const root = document.documentElement;
    const readTheme = () => setTheme(previewTheme(root.dataset.theme));
    const observer = new MutationObserver(readTheme);
    observer.observe(root, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    readTheme();
    return () => observer.disconnect();
  }, []);
  const callbacks = useRef({ onNode, onNodeAction, selectedNode, onError, onLocate, startLine, source });
  callbacks.current = { onNode, onNodeAction, selectedNode, onError, onLocate, startLine, source };
  const focusPending = useRef(false);
  const lastFocus = useRef(focusRequest);
  const stale = source !== debounced.source;
  const active = useRef({ id: "", revision: 0 });
  const lastRender = useRef<{
    content: typeof debounced;
    kind: Props["kind"];
    frame: HTMLIFrameElement;
  }>(null);
  useEffect(() => {
    const t = setTimeout(() => setDebounced({ source, tree }), 350);
    return () => clearTimeout(t);
  }, [source, tree]);
  const send = (message: object) =>
    frame.current?.contentWindow?.postMessage(
      {
        ...message,
        channel: token,
        requestId: active.current.id,
        revision: active.current.revision,
      },
      "*",
    );
  const syncNode = () => {
    if (!callbacks.current.onNodeAction) return;
    send({ type: "command", action: "select-node", id: callbacks.current.selectedNode, focus: focusPending.current });
  };
  useEffect(() => {
    if (focusRequest !== lastFocus.current) focusPending.current = true;
    lastFocus.current = focusRequest;
    if (!stale) syncNode();
  }, [selectedNode, focusRequest, stale]);
  useEffect(() => {
    if (!frameHover) return;
    // An opaque iframe may never receive pointerleave. The next pointer event
    // in the outer document (or another diagram) identifies the real target.
    const leave = (event: Event) => {
      if (event.target === frame.current) return;
      setFrameHover(false);
      send({ type: "command", action: "pointer-left-frame" });
    };
    document.addEventListener("pointerover", leave, true);
    document.addEventListener("pointermove", leave, true);
    document.addEventListener("inkstone-diagram-enter", leave, true);
    return () => {
      document.removeEventListener("pointerover", leave, true);
      document.removeEventListener("pointermove", leave, true);
      document.removeEventListener("inkstone-diagram-enter", leave, true);
    };
  }, [frameHover]);
  useEffect(() => {
    if (problem) return;
    const id = crypto.randomUUID();
    active.current = { id, revision: active.current.revision + 1 };
    setFailed(false);
    setFrameHover(false);
    setErrorLine(null);
    setStatus("正在本地绘制…");
    let timer: ReturnType<typeof setTimeout>;
    let started = performance.now();
    let sent = false;
    const render = () => {
      if (sent || !frame.current) return;
      sent = true;
      const previous = lastRender.current;
      const preserveView =
        previous?.content === debounced &&
        previous.kind === kind &&
        previous.frame === frame.current;
      lastRender.current = { content: debounced, kind, frame: frame.current };
      clearTimeout(timer);
      started = performance.now();
      setElapsed(null);
      send({
        type: "render",
        kind,
        source: debounced.source,
        tree: debounced.tree,
        interactiveNodes: !!callbacks.current.onNodeAction,
        canvas,
        viewport: viewport.current,
        theme,
        preserveView,
      });
      timer = setTimeout(() => {
        setStatus("预览超时。可继续编辑源码，精简内容后重试。");
        setFailed(true);
      }, 8000);
    };
    const handler = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow) return;
      const data = event.data;
      if (data?.type === "frame-loaded") {
        frameLoaded.current = true;
        render();
        return;
      }
      if (
        data?.channel !== token ||
        data.requestId !== id ||
        data.revision !== active.current.revision
      )
        return;
      if (
        data.type === "size" &&
        typeof data.height === "number" &&
        Number.isFinite(data.height)
      ) {
        setMeasuredHeight(
          Math.max(180, Math.min(16384, Math.ceil(data.height))),
        );
      } else if (data.type === "diagram-pointer" && typeof data.inside === "boolean") {
        setFrameHover(data.inside);
        if (data.inside) frame.current?.dispatchEvent(new Event("inkstone-diagram-enter", { bubbles: true }));
      } else if (data.type === "viewport") {
        const next = graphViewport(data);
        if (next) {
          setZoom(Math.round(next.scale * 100));
          if (data.remember === true) {
            viewport.current = next;
            saveViewport(viewKey, next);
          }
        }
      } else if (data.type === "node-focused") {
        focusPending.current = false;
      } else if (data.type === "ready") {
        syncNode();
        setFrameHover(data.pointerInside === true);
        clearTimeout(timer);
        setStatus("");
        setElapsed(Math.round(performance.now() - started));
      } else if (data.type === "error") {
        clearTimeout(timer);
        setFailed(true);
        setStatus(data.message);
        const line = String(data.message).match(/line\s+(\d+)/i);
        if (line) setErrorLine(Number(line[1]));
      } else if (data.type === "locate")
        callbacks.current.onLocate?.(callbacks.current.startLine);
      else if (data.type === "export-error")
        callbacks.current.onError?.(String(data.message));
      else if (
        data.type === "node" &&
        callbacks.current.source === debounced.source
      )
        callbacks.current.onNode?.(data.id);
      else if (data.type === "node-action" && callbacks.current.source === debounced.source &&
               ["child", "sibling", "rename", "delete", "undo", "redo"].includes(data.action))
        callbacks.current.onNodeAction?.(data.id, data.action);
      else if (
        data.type === "export" &&
        callbacks.current.source === debounced.source &&
        typeof data.svg === "string" &&
        data.svg.length < 10_000_000
      )
        void exportSvg(data.svg, data.format === "png" ? "png" : "svg").catch(
          (e) => callbacks.current.onError?.(String(e)),
        );
    };
    window.addEventListener("message", handler);
    renderWhenLoaded.current = render;
    // One render per revision; a loaded frame handles edits immediately, while
    // a new iframe waits for its load handshake instead of racing two renders.
    if (frameLoaded.current) render();
    if (!sent)
      timer = setTimeout(() => {
        setStatus("本地预览载入超时，请重试。");
        setFailed(true);
      }, 8000);
    return () => {
      clearTimeout(timer);
      renderWhenLoaded.current = () => {};
      window.removeEventListener("message", handler);
    };
  }, [debounced, kind, token, attempt, problem, theme, canvas]);
  const toolbar = (
    <div
      className={
        kind === "chart" ? "chart-exports" : "graph-actions diagram-tools"
      }
      role="group"
      aria-label={msg("操作")}
    >
      {toolbarExtras}
      {kind !== "chart" && (
        <span className="graph-kind">
          {kind === "mermaid" ? msg("Mermaid 图表") : msg("脑图")}
        </span>
      )}
      {kind !== "chart" && (
        <>
          <button
            onClick={() => send({ type: "command", action: "in" })}
            title={msg("放大图表")}
            aria-label={msg("放大图表")}
          >
            <ZoomIn size={16} aria-hidden="true" />
          </button>
          <button
            onClick={() => send({ type: "command", action: "out" })}
            title={msg("缩小图表")}
            aria-label={msg("缩小图表")}
          >
            <ZoomOut size={16} aria-hidden="true" />
          </button>
          <button
            title={msg("适应窗口")}
            aria-label={msg("适应窗口")}
            onClick={() => send({ type: "command", action: "fit" })}
          >
            <Scan size={16} aria-hidden="true" />
          </button>
          {kind === "mindmap" && (
            <>
              <button
                title={msg("原始比例")}
                aria-label={msg("原始比例")}
                onClick={() => send({ type: "command", action: "actual" })}
              >
                <Ratio size={16} aria-hidden="true" />
              </button>
              <output aria-label={msg("脑图缩放比例")}>{zoom}%</output>
            </>
          )}
        </>
      )}
      {kind !== "chart" && (
        <button
          title={canvasExpanded ? msg("收起画布") : msg("展开画布")}
          aria-label={canvasExpanded ? msg("收起画布") : msg("展开画布")}
          aria-pressed={canvasExpanded}
          onClick={() => setCanvasExpanded(!canvasExpanded)}
        >
          {canvasExpanded ? <Minimize2 size={15} /> : <Expand size={15} />}
        </button>
      )}
      <button
        disabled={stale || !!status || !!problem}
        title={msg("导出 SVG")}
        aria-label={msg("导出 SVG")}
        onClick={() => send({ type: "command", action: "export" })}
      >
        <Download size={15} aria-hidden="true" />
        {kind === "chart" && "SVG"}
      </button>
      {kind === "chart" && (
        <button
          disabled={stale || !!status || !!problem}
          title={msg("导出 PNG")}
          aria-label={msg("导出 PNG")}
          onClick={() =>
            send({ type: "command", action: "export", format: "png" })
          }
        >
          <Download size={15} aria-hidden="true" />
          PNG
        </button>
      )}
    </div>
  );
  return (
    <div
      className={
        kind === "chart" ? "graph-preview" : "graph-preview diagram-preview"
      }
      data-kind={kind}
      data-frame-hover={frameHover || undefined}
      style={
        kind === "chart"
          ? undefined
          : ({
              "--graph-height": `${canvasExpanded ? Math.max(560, compactHeight + 160) : compactHeight}px`,
            } as CSSProperties)
      }
      data-render-ms={elapsed ?? undefined}
    >
      {toolbarHost === undefined
        ? toolbar
        : toolbarHost && createPortal(toolbar, toolbarHost)}
      {stale && (
        <div className="preview-status" role="status">
          {msg("正在更新；下方为上次预览，完成前不可导出。")}
        </div>
      )}
      {(problem || status) && (
        <div
          role="status"
          className={problem || failed ? "preview-error" : "preview-status"}
        >
          {problem || status}
          {errorLine !== null && onLocate && (
            <button onClick={() => onLocate(startLine + errorLine - 1)}>
              {msg("定位源码第")} {startLine + errorLine - 1} {msg("行")}
            </button>
          )}
          {failed && (
            <button onClick={() => setAttempt((n) => n + 1)}>
              {msg("重新预览")}
            </button>
          )}
        </div>
      )}
      {!problem && !failed && (
        <iframe
          key={attempt}
          ref={attachFrame}
          onLoad={() => {
            frameLoaded.current = true;
            renderWhenLoaded.current();
          }}
          sandbox="allow-scripts"
          title={
            kind === "mermaid"
              ? msg("Mermaid 本地预览")
              : kind === "chart"
                ? msg("数据图表本地预览")
                : msg("Markdown 脑图")
          }
          src={
            kind === "chart"
              ? "./inkstone-chart.html"
              : "./inkstone-preview.html"
          }
        />
      )}
    </div>
  );
}

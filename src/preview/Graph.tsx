import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { ZoomIn, ZoomOut, Download, Expand, Minimize2 } from "lucide-react";
import DOMPurify from "dompurify";
import type { MindNode } from "../content/mindmap";
import { graphViewport, loadViewport, saveViewport } from "./viewport";
import { parseChart } from "../content/chart";
interface Props {
  kind: "mermaid" | "mindmap" | "chart";
  source: string;
  tree?: MindNode;
  onNode?: (id: string) => void;
  onError?: (message: string) => void;
  onLocate?: (line: number) => void;
  startLine?: number;
  viewKey?: string;
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
async function exportSvg(svg: string, format: "svg" | "png" = "svg") {
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
      context.fillStyle = "#fffefa";
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
  onError,
  onLocate,
  startLine = 1,
  viewKey,
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
  const [measuredHeight, setMeasuredHeight] = useState(240);
  const compactHeight = useMemo(() => {
    if (kind !== "mindmap" || !tree) return measuredHeight;
    const leaves = (node: MindNode): number =>
      node.children.length
        ? node.children.reduce((sum, child) => sum + leaves(child), 0)
        : 1;
    return Math.min(440, Math.max(200, leaves(tree) * 32 + 72));
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
  const callbacks = useRef({ onNode, onError, onLocate, startLine, source });
  callbacks.current = { onNode, onError, onLocate, startLine, source };
  const stale = source !== debounced.source;
  const active = useRef({ id: "", revision: 0 });
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
  useEffect(() => {
    if (problem) return;
    const id = crypto.randomUUID();
    active.current = { id, revision: active.current.revision + 1 };
    setFailed(false);
    setErrorLine(null);
    setStatus("正在本地绘制…");
    let timer: ReturnType<typeof setTimeout>;
    let started = performance.now();
    let sent = false;
    const render = () => {
      if (sent || !frame.current) return;
      sent = true;
      clearTimeout(timer);
      started = performance.now();
      setElapsed(null);
      send({
        type: "render",
        kind,
        source: debounced.source,
        tree: debounced.tree,
        viewport: viewport.current,
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
        setMeasuredHeight(Math.max(180, Math.min(440, data.height)));
      } else if (data.type === "viewport") {
        const next = graphViewport(data);
        if (next) {
          setZoom(Math.round(next.scale * 100));
          if (data.remember === true) {
            viewport.current = next;
            saveViewport(viewKey, next);
          }
        }
      } else if (data.type === "ready") {
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
      else if (
        data.type === "node" &&
        callbacks.current.source === debounced.source
      )
        callbacks.current.onNode?.(data.id);
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
  }, [debounced, kind, token, attempt, problem]);
  return (
    <div
      className="graph-preview"
      data-kind={kind}
      style={
        kind === "chart"
          ? undefined
          : ({
              "--graph-height": `${canvasExpanded ? 560 : compactHeight}px`,
            } as CSSProperties)
      }
      data-render-ms={elapsed ?? undefined}
    >
      <div className="graph-actions">
        <span className="graph-kind">
          {kind === "mermaid"
            ? "Mermaid 图表"
            : kind === "chart"
              ? "数据图表"
              : "脑图"}
        </span>
        {kind !== "chart" && (
          <>
            <button
              onClick={() => send({ type: "command", action: "in" })}
              aria-label="放大图表"
            >
              <ZoomIn size={16} aria-hidden="true" />
            </button>
            <button
              onClick={() => send({ type: "command", action: "out" })}
              aria-label="缩小图表"
            >
              <ZoomOut size={16} aria-hidden="true" />
            </button>
            <button onClick={() => send({ type: "command", action: "fit" })}>
              适应窗口
            </button>
            {kind === "mindmap" && (
              <>
                <button
                  onClick={() => send({ type: "command", action: "actual" })}
                >
                  原始比例
                </button>
                <output aria-label="脑图缩放比例">{zoom}%</output>
              </>
            )}
          </>
        )}
        {kind !== "chart" && (
          <button
            aria-pressed={canvasExpanded}
            onClick={() => setCanvasExpanded(!canvasExpanded)}
          >
            {canvasExpanded ? <Minimize2 size={15} /> : <Expand size={15} />}
            {canvasExpanded ? "收起画布" : "展开画布"}
          </button>
        )}
        <button
          disabled={stale || !!status || !!problem}
          onClick={() => send({ type: "command", action: "export" })}
        >
          <Download size={15} aria-hidden="true" />
          导出 SVG
        </button>
        {kind === "chart" && (
          <button
            disabled={stale || !!status || !!problem}
            onClick={() =>
              send({ type: "command", action: "export", format: "png" })
            }
          >
            <Download size={15} aria-hidden="true" />
            导出 PNG
          </button>
        )}
      </div>
      {stale && (
        <div className="preview-status" role="status">
          正在更新；下方为上次预览，完成前不可导出。
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
              定位源码第 {startLine + errorLine - 1} 行
            </button>
          )}
          {failed && (
            <button onClick={() => setAttempt((n) => n + 1)}>重新预览</button>
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
              ? "Mermaid 本地预览"
              : kind === "chart"
                ? "数据图表本地预览"
                : "Markdown 脑图"
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

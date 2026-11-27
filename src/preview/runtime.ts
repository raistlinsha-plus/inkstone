import { mindPresentation } from "../content/editableMind";
import { isMermaidMindmap, orderedMindmap, type MermaidMindDB } from "./mermaidMindmap";
import { trackFramePointer } from "./framePointer";
import mermaid from "mermaid";
import { Markmap } from "markmap-view";
import DOMPurify from "dompurify";
import { serializeSvg } from "./svg";
import { graphViewport } from "./viewport";
import {
  applyPreviewTheme,
  diagramFontFamily,
  mindmapFontSize,
  previewColors,
  previewTheme,
  type PreviewTheme,
} from "./theme";

let channel = "";
let requestId = "";
let revision = 0;
let generation = 0;
let renderedGeneration = -1;
let map: Markmap | null = null;
let kind = "";
let diagramSource = "";
let fullCanvas = false;
let theme: PreviewTheme = "light";
let mermaidQueue: Promise<unknown> = Promise.resolve();
let scale = 1;
let mapViewport = { x: 0, y: 0, scale: 1 };
const host = document.getElementById("graph")!;
const styleNonce =
  (document.querySelector("style[nonce]") as HTMLStyleElement | null)?.nonce ??
  "";

function colorMindmap(svg: SVGElement, theme: PreviewTheme) {
  const colors = previewColors[theme];
  svg.style.setProperty("--markmap-branch", colors.branch);
  svg.style.setProperty("--preview-selected", colors.node);
  svg.style.setProperty("--markmap-text-color", colors.text);
  svg.style.setProperty("--markmap-circle-open-bg", colors.canvas);
}

function renderMermaid(source: string, id: string, theme: PreviewTheme) {
  // Mermaid's initialization is global to this frame. Keep export and preview
  // configurations from overlapping when a render is still loading.
  const result = mermaidQueue.then(async () => {
    const colors = previewColors[theme];
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme: "base",
      suppressErrorRendering: true,
      maxTextSize: 50000,
      maxEdges: 500,
      htmlLabels: false,
      flowchart: { htmlLabels: false },
      themeVariables: {
        darkMode: theme === "dark",
        fontFamily: diagramFontFamily,
        background: colors.canvas,
        primaryColor: colors.node,
        primaryTextColor: colors.text,
        primaryBorderColor: colors.branch,
        secondaryColor: colors.surface,
        secondaryTextColor: colors.text,
        tertiaryColor: colors.surface,
        tertiaryTextColor: colors.text,
        lineColor: colors.branch,
        textColor: colors.text,
      },
    });
    if (isMermaidMindmap(source) && !source.includes('`')) {
      const presentation = mindPresentation(source, "mermaid");
      const parsed = await mermaid.mermaidAPI.getDiagramFromText(presentation.body);
      const db = parsed.db as Partial<MermaidMindDB>;
      if (db.getMindmap && db.nodeType) {
        const diagram = orderedMindmap(db as MermaidMindDB, theme, presentation.style, presentation.positions);
        if (diagram) return diagram;
      }
    }
    const { svg } = await mermaid.render(id, source);
    return DOMPurify.sanitize(svg, {
      RETURN_DOM_FRAGMENT: true,
      USE_PROFILES: { svg: true, svgFilters: true },
      FORBID_TAGS: ["script", "image", "a", "use"],
      FORBID_ATTR: ["href", "xlink:href"],
    });
  });
  mermaidQueue = result.catch(() => {});
  return result;
}
const notify = (
  type: string,
  payload: object = {},
  job = { generation, channel, requestId, revision },
) => {
  if (job.generation !== generation) return;
  parent.postMessage(
    {
      type,
      channel: job.channel,
      requestId: job.requestId,
      revision: job.revision,
      ...payload,
    },
    "*",
  );
};
const framePointer = trackFramePointer((inside) => {
  if (requestId) notify("diagram-pointer", { inside });
});
const escape = (s: string) =>
  s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
function tree(node: any): any {
  return {
    content: escape(String(node.label)),
    payload: { sourceId: node.id },
    children: (node.children ?? []).map(tree),
  };
}
// Report the same dimensions used to paint the SVG. Tall, narrow diagrams
// retain their intrinsic size instead of being enlarged to fill the page.
function layoutMermaid() {
  const svg = host.querySelector("svg");
  const box = svg?.viewBox?.baseVal;
  if (!svg || !box || !(box.width > 0 && box.height > 0)) return;
  const availableWidth = Math.max(1, host.clientWidth - 24);
  const fit = Math.min(1, availableWidth / box.width, 16336 / box.height);
  const width = Math.ceil(box.width * fit * scale);
  const height = Math.ceil(box.height * fit * scale);
  svg.style.maxWidth = "none";
  svg.style.width = `${width}px`;
  svg.style.height = `${height}px`;
  svg.style.margin = fullCanvas ? `${Math.max(12, (host.clientHeight - height) / 2)}px auto` : "12px auto";
  notify("size", { height: height + 28 + (width > host.clientWidth ? 16 : 0) });
}
function refreshPanCursor() {
  const overflow =
    host.scrollWidth > host.clientWidth + 1 ||
    host.scrollHeight > host.clientHeight + 1;
  host.toggleAttribute(
    "data-pannable",
    !!map || (kind === "mermaid" && overflow),
  );
}
if (typeof ResizeObserver !== "undefined")
  new ResizeObserver(() => {
    if (map) map.svg.attr("height", Math.max(160, window.innerHeight - 4));
    if (kind === "mermaid" && renderedGeneration === generation) layoutMermaid();
    refreshPanCursor();
  }).observe(host);
let drag: {
  pointerId: number;
  x: number;
  y: number;
  left: number;
  top: number;
} | null = null;
host.addEventListener("pointerdown", (event) => {
  if (
    !map &&
    host.hasAttribute("data-pannable") &&
    event.isPrimary &&
    event.button === 0
  ) {
    drag = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      left: host.scrollLeft,
      top: host.scrollTop,
    };
    host.setPointerCapture(event.pointerId);
    host.setAttribute("data-panning", "");
  }
});
host.addEventListener("pointermove", (event) => {
  if (drag && drag.pointerId === event.pointerId) {
    host.scrollLeft = drag.left + drag.x - event.clientX;
    host.scrollTop = drag.top + drag.y - event.clientY;
  }
});
host.addEventListener("lostpointercapture", (event) => {
  if (drag?.pointerId === event.pointerId) {
    drag = null;
    host.removeAttribute("data-panning");
  }
});
host.addEventListener("dblclick", () => {
  if (!map) notify("locate");
});
window.addEventListener("message", async (event) => {
  if (
    event.source !== parent ||
    !event.data ||
    typeof event.data.channel !== "string"
  )
    return;
  const data = event.data;
  if (channel && channel !== data.channel) return;
  channel = data.channel;
  if (data.type === "command") {
    if (data.requestId !== requestId || data.revision !== revision) return;
    if (data.action === "pointer-left-frame") {
      framePointer.reset();
      return;
    }
    if (renderedGeneration !== generation) return;
    if (data.action === "select-node" && map) {
      for (const el of host.querySelectorAll<SVGGElement>("[data-source-node]")) {
        const active = el.dataset.sourceNode === data.id;
        el.setAttribute("aria-pressed", String(active));
        el.setAttribute("tabindex", active ? "0" : "-1");
        if (active && data.focus === true) {
          el.focus({ preventScroll: true });
          notify("node-focused");
        }
      }
      return;
    }
    if (data.action === "export") {
      const job = { generation, channel, requestId, revision };
      const format = data.format === "png" ? "png" : "svg";
      try {
        const exportSource =
          theme === "dark" && kind === "mermaid"
            ? await renderMermaid(
                diagramSource,
                `inkstone-export-${job.generation}`,
                "light",
              )
            : host;
        const svg = exportSource.querySelector<SVGElement>("svg");
        if (svg) notify("export", { svg: serializeSvg(svg), format }, job);
      } catch {
        notify("export-error", { message: "无法导出本地图表。" }, job);
      }
    } else if (map) {
      const job = { generation, channel, requestId, revision };
      if (data.action === "fit") await map.fit(1);
      if (data.action === "actual") await map.rescale(1 / mapViewport.scale);
      if (data.action === "in") await map.rescale(1.25);
      if (data.action === "out") await map.rescale(0.8);
      notify("viewport", { ...mapViewport, remember: true }, job);
    } else {
      const svg = host.querySelector("svg") as SVGSVGElement | null;
      if (svg) {
        scale =
          data.action === "fit"
            ? 1
            : scale * (data.action === "in" ? 1.25 : 0.8);
        scale = Math.max(0.2, Math.min(4, scale));
        layoutMermaid();
        refreshPanCursor();
      }
    }
    return;
  }
  if (data.type !== "render") return;
  const wasReady = renderedGeneration === generation;
  requestId = data.requestId;
  revision = data.revision;
  const job = { generation: ++generation, channel, requestId, revision };
  renderedGeneration = -1;
  const current = () => job.generation === generation;
  theme = previewTheme(data.theme);
  applyPreviewTheme(theme);
  const savedViewport = graphViewport(data.viewport);
  if (
    wasReady &&
    data.preserveView === true &&
    kind === "mindmap" &&
    data.kind === "mindmap" &&
    diagramSource === data.source &&
    map
  ) {
    colorMindmap(map.svg.node()!, theme);
    renderedGeneration = job.generation;
    notify("ready", { pointerInside: framePointer.inside }, job);
    return;
  }
  const preserveMermaidView =
    data.preserveView === true &&
    kind === "mermaid" &&
    data.kind === "mermaid" &&
    diagramSource === data.source;
  const scroll = { left: host.scrollLeft, top: host.scrollTop };
  kind = data.kind;
  fullCanvas = data.canvas === true;
  diagramSource = data.source;
  map?.destroy();
  map = null;
  drag = null;
  host.removeAttribute("data-pannable");
  host.removeAttribute("data-panning");
  if (!preserveMermaidView) {
    host.replaceChildren();
    scale = 1;
  }
  try {
    if (data.kind === "mermaid") {
      // It stays inside an opaque sandbox. Links and document callbacks are never bound.
      const fragment = await renderMermaid(
        data.source,
        `inkstone-diagram-${job.generation}`,
        theme,
      );
      if (!current()) return;
      fragment.querySelectorAll("style").forEach((style) => {
        if (styleNonce) style.nonce = styleNonce;
      });
      host.replaceChildren(fragment);
      layoutMermaid();
      if (preserveMermaidView) {
        host.scrollLeft = scroll.left;
        host.scrollTop = scroll.top;
      }
    } else if (data.kind === "mindmap") {
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.style.width = "100%";
      svg.style.height = "calc(100vh - 4px)";
      svg.style.setProperty("--markmap-font", `400 ${mindmapFontSize}px/20px ${diagramFontFamily}`);
      colorMindmap(svg, theme);
      host.append(svg);
      const localMap = Markmap.create(svg, {
        duration: 0,
        autoFit: false,
        // A plain wheel scrolls the enclosing document. Pinch/ctrl-wheel and drag still operate the map.
        pan: false,
        scrollForPan: true,
        maxInitialScale: 1,
        initialExpandLevel: data.interactiveNodes ? -1 : 4,
        maxWidth: 220,
        spacingHorizontal: 100,
        spacingVertical: 12,
        lineWidth: () => 1.6,
        embedGlobalCSS: true,
        color: () => "var(--markmap-branch)",
      });
      map = localMap;
      localMap.zoom.scaleExtent([0.005, 16]);
      localMap.zoom.on("start.inkstone", (event) => {
        if (map === localMap && event.sourceEvent?.type === "mousedown")
          host.setAttribute("data-panning", "");
      });
      localMap.zoom.on("end.inkstone", () => {
        if (map === localMap) host.removeAttribute("data-panning");
      });
      localMap.zoom.on("zoom.inkstone", (event) => {
        if (map !== localMap) return;
        mapViewport = {
          x: event.transform.x,
          y: event.transform.y,
          scale: event.transform.k,
        };
        notify("viewport", { ...mapViewport, remember: !!event.sourceEvent });
      });
      const style = localMap.styleNode.node();
      if (style && styleNonce) {
        style.remove();
        style.nonce = styleNonce;
        svg.prepend(style);
      }
      await localMap.setData(tree(data.tree));
      if (!current()) {
        localMap.destroy();
        return;
      }
      const saved = savedViewport;
      if (saved) {
        const t = localMap.svg.property("__zoom");
        const identity = t.translate(-t.x / t.k, -t.y / t.k).scale(1 / t.k);
        localMap.svg.call(
          localMap.zoom.transform,
          identity.translate(saved.x, saved.y).scale(saved.scale),
        );
      } else await localMap.fit(1);
      if (!current()) {
        localMap.destroy();
        return;
      }
      if (data.interactiveNodes === true) {
        const groups = [...svg.querySelectorAll<SVGGElement>("g.markmap-node")];
        for (const [i, group] of groups.entries()) {
          const id = (group as Element & { __data__?: {payload?: {sourceId?: string}} }).__data__?.payload?.sourceId;
          if (!id) continue;
          group.dataset.sourceNode = id;
          group.setAttribute("tabindex", i ? "-1" : "0");
          group.setAttribute("role", "button");
          group.setAttribute("aria-label", group.textContent?.trim() || id);
          group.addEventListener("keydown", (event) => {
            if (event.isComposing || event.keyCode === 229 || event.altKey) return;
            if (event.key.startsWith("Arrow")) {
              event.preventDefault();
              const direction = ["ArrowDown", "ArrowRight"].includes(event.key) ? 1 : -1;
              const target = groups[Math.min(groups.length - 1, Math.max(0, i + direction))];
              target.focus();
              notify("node", { id: target.dataset.sourceNode });
              return;
            }
            if (event.shiftKey && event.key === "Tab") return;
            const action = (event.ctrlKey || event.metaKey)
              ? (event.key.toLowerCase() === "z" ? event.shiftKey ? "redo" : "undo" : undefined)
              : ({ Tab: "child", Enter: "sibling", F2: "rename", Delete: "delete" } as Record<string, string>)[event.key];
            if (action) { event.preventDefault(); notify("node-action", { id, action }); }
          });
          group.addEventListener("dblclick", (event) => {
            event.stopPropagation();
            notify("node-action", { id, action: "rename" });
          });
        }
        const sheet = document.createElementNS("http://www.w3.org/2000/svg", "style");
        sheet.textContent = 'g[data-source-node]{cursor:pointer}g[data-source-node] foreignObject div{border-radius:4px}g[data-source-node][aria-pressed="true"] foreignObject>div{background:var(--preview-selected)}g[data-source-node]:focus-visible{outline:1.5px solid var(--markmap-branch);outline-offset:3px}';
        svg.prepend(sheet);
      }
      svg.addEventListener("click", (event) => {
        const node = (event.target as Element).closest("g.markmap-node") as
          (Element & { __data__?: any }) | null;
        if (map === localMap && node?.__data__?.payload?.sourceId) {
          if (data.interactiveNodes) (node as SVGGElement).focus({ preventScroll: true });
          notify("node", { id: node.__data__.payload.sourceId });
        }
      });
    } else throw new Error("不支持的本地图表类型。");
    if (!current()) return;
    refreshPanCursor();
    renderedGeneration = job.generation;
    notify("ready", { pointerInside: framePointer.inside }, job);
  } catch (error) {
    if (!current()) return;
    host.replaceChildren();
    notify("error", { message: String(error) }, job);
  }
});
window.addEventListener("pagehide", () => map?.destroy());
parent.postMessage({ type: "frame-loaded" }, "*");

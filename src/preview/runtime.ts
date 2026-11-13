import mermaid from "mermaid";
import { Markmap } from "markmap-view";
import DOMPurify from "dompurify";
import { serializeSvg } from "./svg";
import { graphViewport } from "./viewport";
import {
  applyPreviewTheme,
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
        fontFamily: "system-ui, sans-serif",
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
if (typeof ResizeObserver !== "undefined")
  new ResizeObserver(() => {
    if (map) map.svg.attr("height", Math.max(160, window.innerHeight - 4));
  }).observe(host);
let drag: { x: number; y: number; left: number; top: number } | null = null;
host.addEventListener("pointerdown", (event) => {
  if (!map) {
    drag = {
      x: event.clientX,
      y: event.clientY,
      left: host.scrollLeft,
      top: host.scrollTop,
    };
    host.setPointerCapture(event.pointerId);
  }
});
host.addEventListener("pointermove", (event) => {
  if (drag) {
    host.scrollLeft = drag.left + drag.x - event.clientX;
    host.scrollTop = drag.top + drag.y - event.clientY;
  }
});
host.addEventListener("pointerup", () => {
  drag = null;
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
    if (
      data.requestId !== requestId ||
      data.revision !== revision ||
      renderedGeneration !== generation
    )
      return;
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
        svg.style.width = `${scale * 100}%`;
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
    notify("ready", {}, job);
    return;
  }
  const preserveMermaidView =
    data.preserveView === true &&
    kind === "mermaid" &&
    data.kind === "mermaid" &&
    diagramSource === data.source;
  const scroll = { left: host.scrollLeft, top: host.scrollTop };
  kind = data.kind;
  diagramSource = data.source;
  map?.destroy();
  map = null;
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
      const svg = host.querySelector("svg")!;
      svg.style.maxWidth = "none";
      svg.style.width = `${scale * 100}%`;
      svg.style.minHeight = "140px";
      if (preserveMermaidView) {
        host.scrollLeft = scroll.left;
        host.scrollTop = scroll.top;
      }
      const box = svg.viewBox?.baseVal;
      if (box?.width > 0 && box.height > 0)
        notify(
          "size",
          {
            height: Math.ceil(
              box.height *
                Math.min(1, Math.max(120, window.innerWidth - 32) / box.width) +
                40,
            ),
          },
          job,
        );
    } else if (data.kind === "mindmap") {
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.style.width = "100%";
      svg.style.height = "calc(100vh - 4px)";
      svg.style.fontSize = "14px";
      colorMindmap(svg, theme);
      host.append(svg);
      const localMap = Markmap.create(svg, {
        duration: 0,
        autoFit: false,
        maxInitialScale: 1,
        initialExpandLevel: 4,
        maxWidth: 220,
        embedGlobalCSS: true,
        color: () => "var(--markmap-branch)",
      });
      map = localMap;
      localMap.zoom.scaleExtent([0.005, 16]);
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
      svg.addEventListener("click", (event) => {
        const node = (event.target as Element).closest("g.markmap-node") as
          (Element & { __data__?: any }) | null;
        if (map === localMap && node?.__data__?.payload?.sourceId)
          notify("node", { id: node.__data__.payload.sourceId });
      });
    } else throw new Error("不支持的本地图表类型。");
    if (!current()) return;
    renderedGeneration = job.generation;
    notify("ready", {}, job);
  } catch (error) {
    if (!current()) return;
    host.replaceChildren();
    notify("error", { message: String(error) }, job);
  }
});
window.addEventListener("pagehide", () => map?.destroy());
parent.postMessage({ type: "frame-loaded" }, "*");

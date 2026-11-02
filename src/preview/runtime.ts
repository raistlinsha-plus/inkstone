import mermaid from "mermaid";
import { Markmap } from "markmap-view";
import DOMPurify from "dompurify";
import { serializeSvg } from "./svg";
import { graphViewport } from "./viewport";

let channel = "";
let requestId = "";
let revision = 0;
let generation = 0;
let renderedGeneration = -1;
let map: Markmap | null = null;
let scale = 1;
let mapViewport = { x: 0, y: 0, scale: 1 };
const host = document.getElementById("graph")!;
const styleNonce =
  (document.querySelector("style[nonce]") as HTMLStyleElement | null)?.nonce ??
  "";
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
      const svg = host.querySelector("svg");
      if (svg)
        notify("export", {
          svg: serializeSvg(svg as SVGElement),
          format: data.format === "png" ? "png" : "svg",
        });
    } else if (map) {
      if (data.action === "fit") await map.fit(1);
      if (data.action === "actual") await map.rescale(1 / mapViewport.scale);
      if (data.action === "in") await map.rescale(1.25);
      if (data.action === "out") await map.rescale(0.8);
      notify("viewport", { ...mapViewport, remember: true });
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
  requestId = data.requestId;
  revision = data.revision;
  const job = { generation: ++generation, channel, requestId, revision };
  renderedGeneration = -1;
  const current = () => job.generation === generation;
  map?.destroy();
  map = null;
  host.replaceChildren();
  scale = 1;
  try {
    if (data.kind === "mermaid") {
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
          fontFamily: "system-ui, sans-serif",
          primaryColor: "#eef2e8",
          primaryTextColor: "#303c32",
          lineColor: "#668270",
        },
      });
      const result = await mermaid.render(
        `inkstone-diagram-${job.generation}`,
        data.source,
      );
      if (!current()) return;
      // It stays inside an opaque sandbox. Links and document-supplied callbacks are never bound.
      const fragment = DOMPurify.sanitize(result.svg, {
        RETURN_DOM_FRAGMENT: true,
        USE_PROFILES: { svg: true, svgFilters: true },
        FORBID_TAGS: ["script", "image", "a", "use"],
        FORBID_ATTR: ["href", "xlink:href"],
      });
      fragment.querySelectorAll("style").forEach((style) => {
        if (styleNonce) style.nonce = styleNonce;
      });
      host.replaceChildren(fragment);
      const svg = host.querySelector("svg")!;
      svg.style.maxWidth = "none";
      svg.style.width = "100%";
      svg.style.minHeight = "300px";
    } else if (data.kind === "mindmap") {
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.style.width = "100%";
      svg.style.height = `${Math.max(300, window.innerHeight - 4)}px`;
      svg.style.fontSize = "14px";
      host.append(svg);
      const localMap = Markmap.create(
        svg,
        {
          duration: 0,
          autoFit: false,
          maxInitialScale: 1,
          initialExpandLevel: 4,
          maxWidth: 220,
          embedGlobalCSS: true,
          color: () => "#4f7a65",
        },
        tree(data.tree),
      );
      map = localMap;
      localMap.zoom.scaleExtent([0.005, 16]);
      localMap.zoom.on("zoom.inkstone", (event) => {
        if (!current()) return;
        mapViewport = {
          x: event.transform.x,
          y: event.transform.y,
          scale: event.transform.k,
        };
        notify(
          "viewport",
          { ...mapViewport, remember: !!event.sourceEvent },
          job,
        );
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
      const saved = graphViewport(data.viewport);
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
        if (node?.__data__?.payload?.sourceId)
          notify("node", { id: node.__data__.payload.sourceId }, job);
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

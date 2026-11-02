import * as echarts from "echarts/core";
import { BarChart, LineChart, PieChart } from "echarts/charts";
import {
  TitleComponent,
  TooltipComponent,
  LegendComponent,
  GridComponent,
} from "echarts/components";
import { SVGRenderer } from "echarts/renderers";
import { parseChart, chartOption } from "../content/chart";

echarts.use([
  BarChart,
  LineChart,
  PieChart,
  TitleComponent,
  TooltipComponent,
  LegendComponent,
  GridComponent,
  SVGRenderer,
]);
let channel = "";
let requestId = "";
let revision = 0;
let chart: echarts.EChartsType | null = null;
let ready = false;
let resizeTimer: ReturnType<typeof setTimeout>;
const host = document.getElementById("graph")!;
function notify(type: string, payload: object = {}) {
  parent.postMessage({ type, channel, requestId, revision, ...payload }, "*");
}
window.addEventListener("message", (event) => {
  const data = event.data;
  if (
    event.source !== parent ||
    !data ||
    typeof data.channel !== "string" ||
    (channel && channel !== data.channel)
  )
    return;
  channel = data.channel;
  if (data.type === "command") {
    if (
      !ready ||
      !chart ||
      data.requestId !== requestId ||
      data.revision !== revision
    )
      return;
    if (data.action === "export")
      notify("export", {
        svg: chart.renderToSVGString(),
        format: data.format === "png" ? "png" : "svg",
      });
    return;
  }
  if (data.type !== "render") return;
  requestId = data.requestId;
  revision = data.revision;
  ready = false;
  chart?.dispose();
  chart = null;
  host.replaceChildren();
  try {
    if (data.kind !== "chart") throw new Error("不支持的图表类型。");
    const validated = parseChart(data.source);
    const chartHost = document.createElement("div");
    chartHost.style.width = "100%";
    chartHost.style.height = `${Math.max(300, window.innerHeight - 4)}px`;
    host.append(chartHost);
    chart = echarts.init(chartHost, undefined, { renderer: "svg" });
    chart.setOption(chartOption(validated) as echarts.EChartsCoreOption, {
      notMerge: true,
    });
    ready = true;
    notify("ready");
  } catch (error) {
    chart?.dispose();
    chart = null;
    host.replaceChildren();
    notify("error", {
      message: error instanceof Error ? error.message : String(error),
    });
  }
});
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (chart && ready)
      chart.resize({ height: Math.max(300, window.innerHeight - 4) });
  }, 100);
});
window.addEventListener("pagehide", () => {
  clearTimeout(resizeTimer);
  chart?.dispose();
});
parent.postMessage({ type: "frame-loaded" }, "*");

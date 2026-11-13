import * as echarts from "echarts/core";
import { BarChart, LineChart, PieChart } from "echarts/charts";
import {
  TitleComponent,
  TooltipComponent,
  LegendComponent,
  GridComponent,
} from "echarts/components";
import { SVGRenderer } from "echarts/renderers";
import { parseChart, chartOption, type ChartData } from "../content/chart";
import { applyPreviewTheme, previewTheme } from "./theme";

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
let validated: ChartData | null = null;
let source = "";
let ready = false;
let resizeTimer: ReturnType<typeof setTimeout>;
const host = document.getElementById("graph")!;
function notify(type: string, payload: object = {}) {
  parent.postMessage({ type, channel, requestId, revision, ...payload }, "*");
}

function exportChart(live: echarts.EChartsType, data: ChartData) {
  const output = echarts.init(null, undefined, {
    renderer: "svg",
    ssr: true,
    width: live.getWidth(),
    height: live.getHeight(),
  });
  try {
    const option = chartOption(data, "export");
    const legend = live.getOption().legend as
      | {
          selected?: Record<string, boolean>;
          scrollDataIndex?: number;
        }[]
      | undefined;
    const { selected, scrollDataIndex } = legend?.[0] ?? {};
    output.setOption({
      ...option,
      legend: { ...option.legend, selected, scrollDataIndex },
    } as echarts.EChartsCoreOption);
    return output.renderToSVGString();
  } finally {
    output.dispose();
  }
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
      !validated ||
      data.requestId !== requestId ||
      data.revision !== revision
    )
      return;
    if (data.action === "export") {
      try {
        notify("export", {
          svg: exportChart(chart, validated),
          format: data.format === "png" ? "png" : "svg",
        });
      } catch {
        notify("export-error", { message: "无法导出数据图表。" });
      }
    }
    return;
  }
  if (data.type !== "render") return;
  const preserve =
    ready && data.preserveView === true && data.source === source;
  requestId = data.requestId;
  revision = data.revision;
  ready = false;
  try {
    if (data.kind !== "chart") throw new Error("不支持的图表类型。");
    const theme = previewTheme(data.theme);
    applyPreviewTheme(theme);
    if (!preserve || !chart || !validated) {
      chart?.dispose();
      chart = null;
      host.replaceChildren();
      validated = parseChart(data.source);
      source = data.source;
      const chartHost = document.createElement("div");
      chartHost.style.width = "100%";
      chartHost.style.height = `${Math.max(300, window.innerHeight - 4)}px`;
      host.append(chartHost);
      chart = echarts.init(chartHost, undefined, { renderer: "svg" });
    }
    chart.setOption(
      chartOption(validated, theme) as echarts.EChartsCoreOption,
      {
        notMerge: !preserve,
      },
    );
    ready = true;
    notify("ready");
  } catch (error) {
    chart?.dispose();
    chart = null;
    validated = null;
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

import { expect, test } from "vitest";
import * as echarts from "echarts/core";
import { BarChart, LineChart, PieChart } from "echarts/charts";
import {
  GridComponent,
  TitleComponent,
  LegendComponent,
  TooltipComponent,
} from "echarts/components";
import { SVGRenderer } from "echarts/renderers";
import { chartTemplate, parseChart, chartOption } from "../content/chart";
echarts.use([
  BarChart,
  LineChart,
  PieChart,
  GridComponent,
  TitleComponent,
  LegendComponent,
  TooltipComponent,
  SVGRenderer,
]);
test.each(["bar", "line", "pie"])(
  "the actual ECharts SVG renderer draws %s in both appearances",
  (type) => {
    const source = JSON.parse(chartTemplate);
    source.type = type;
    source.title = "<script>alert(1)</script>";
    if (type === "line") {
      source.series.push({ name: "成本", values: [20, 50, 38, 80] });
    }
    for (const [theme, canvas] of [
      ["light", "#fbfaf7"],
      ["dark", "#1e2220"],
      ["export", "#fffefa"],
    ] as const) {
      const chart = echarts.init(null, undefined, {
        renderer: "svg",
        ssr: true,
        width: 800,
        height: 400,
      });
      try {
        chart.setOption(
          chartOption(
            parseChart(JSON.stringify(source)),
            theme,
          ) as echarts.EChartsCoreOption,
        );
        const svg = chart.renderToSVGString();
        expect(svg).toContain("<svg");
        expect(svg).toContain("<path");
        expect(svg).toContain("Q1");
        expect(svg).toContain(canvas);
        if (type === "line") expect(svg).toContain("stroke-dasharray");
        expect(svg).not.toContain("<script>");
        expect(svg).not.toContain("NaN");
        expect(svg).toContain("&lt;script&gt;");
      } finally {
        chart.dispose();
      }
    }
  },
);

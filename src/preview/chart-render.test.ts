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
  "the actual ECharts SVG renderer draws %s from the same validated data",
  (type) => {
    const source = JSON.parse(chartTemplate);
    source.type = type;
    source.title = "<script>alert(1)</script>";
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
        ) as echarts.EChartsCoreOption,
      );
      const svg = chart.renderToSVGString();
      expect(svg).toContain("<svg");
      expect(svg).toContain("<path");
      expect(svg).toContain("Q1");
      expect(svg).not.toContain("<script>");
      expect(svg).not.toContain("NaN");
      expect(svg).toContain("&lt;script&gt;");
    } finally {
      chart.dispose();
    }
  },
);

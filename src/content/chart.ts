import { inspectJson, type JsonNode } from "./json";
import {
  lightGraphExport,
  previewColors,
  type PreviewTheme,
} from "../preview/theme";

export interface ChartData {
  schemaVersion: 1;
  type: "bar" | "line" | "pie";
  title: string;
  x: { label: string; values: string[] };
  y: { label: string; unit: string };
  series: { name: string; values: (number | null)[] }[];
  sourceRefs?: string[];
  orientation?: "vertical" | "horizontal";
  donut?: boolean;
}
export const chartTemplate = JSON.stringify(
  {
    schemaVersion: 1,
    type: "bar",
    title: "季度收入",
    x: { label: "季度", values: ["Q1", "Q2", "Q3", "Q4"] },
    y: { label: "收入", unit: "万元" },
    series: [{ name: "收入", values: [120, 150, 138, 180] }],
  } satisfies ChartData,
  null,
  2,
);
const problem = (message: string): never => {
  throw new Error(message);
};
function object(
  value: unknown,
  keys: string[],
  where: string,
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return problem(`${where}必须是对象。`);
  for (const key of Object.keys(value))
    if (!keys.includes(key)) problem(`${where}不支持字段“${key}”。`);
  return value as Record<string, unknown>;
}
function label(value: unknown, where: string, empty = true, max = 160): string {
  if (
    typeof value !== "string" ||
    value.length > max ||
    (!empty && !value.trim()) ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)
  )
    return problem(
      `${where}需要${empty ? "" : "非空"}文本，最多 ${max} 字符。`,
    );
  return value;
}
// Compare decimal text before and after JS parsing. Trailing zeroes and exponent
// notation are equivalent, while precision-losing decimal literals are refused.
function decimalKey(raw: string): string {
  const m = raw.toLowerCase().match(/^(-?)(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/);
  if (!m) return raw;
  let digits = (m[2] + (m[3] ?? "")).replace(/^0+/, "");
  let exponent = Number(m[4] ?? 0) - (m[3]?.length ?? 0);
  if (!digits) return "0";
  while (digits.endsWith("0")) {
    digits = digits.slice(0, -1);
    exponent++;
  }
  return m[1] + digits + "e" + exponent;
}
export function parseChart(source: string): ChartData {
  if (new TextEncoder().encode(source).length > 50_000)
    problem("图表配置超过 50 KB，请精简后重试。");
  const inspected = inspectJson(source);
  if (inspected.errors.length || !inspected.root)
    problem("图表 JSON 尚未完整或有语法错误；原文已保留。");
  if (inspected.duplicate) problem("图表 JSON 包含重复键，请修正后预览。");
  function check(node: JsonNode, depth = 0) {
    if (depth > 8) problem("图表配置嵌套过深。");
    if (node.type === "number") {
      const n = node.value as number;
      if (
        !Number.isFinite(n) ||
        (Number.isInteger(n) && !Number.isSafeInteger(n)) ||
        decimalKey(source.slice(node.offset, node.offset + node.length)) !==
          decimalKey(String(n))
      )
        problem(
          "数值超出安全精度或范围，请保留原始数据并调整单位；未绘制近似值。",
        );
    }
    node.children?.forEach((child) => check(child, depth + 1));
  }
  check(inspected.root!);
  const value = JSON.parse(source) as unknown;
  const root = object(
    value,
    [
      "schemaVersion",
      "type",
      "title",
      "x",
      "y",
      "series",
      "sourceRefs",
      "orientation",
      "donut",
    ],
    "图表",
  );
  if (root.schemaVersion !== 1) problem("仅支持图表 schemaVersion 1。");
  if (!["bar", "line", "pie"].includes(String(root.type)))
    problem("图表类型仅支持 bar、line、pie。");
  label(root.title, "图表标题", false);
  const x = object(root.x, ["label", "values"], "x");
  const y = object(root.y, ["label", "unit"], "y");
  label(x.label, "分类轴名称");
  label(y.label, "数值轴名称");
  label(y.unit, "单位", true, 40);
  if (!Array.isArray(x.values) || !x.values.length || x.values.length > 1000)
    problem("分类数量需要在 1 至 1000 之间。");
  (x.values as unknown[]).forEach((v) => label(v, "分类", false));
  if (new Set(x.values as string[]).size !== (x.values as string[]).length)
    problem("图表分类不能重复。");
  if (
    !Array.isArray(root.series) ||
    !root.series.length ||
    root.series.length > 8
  )
    problem("图表需要 1 至 8 个系列。");
  const series = root.series as unknown[];
  if (series.length * (x.values as unknown[]).length > 1000)
    problem("图表总数据点不能超过 1000 个。");
  let count = 0;
  const names = new Set<string>();
  for (const item of series) {
    const s = object(item, ["name", "values"], "系列");
    const name = label(s.name, "系列名称", false);
    if (names.has(name)) problem("系列名称不能重复。");
    names.add(name);
    if (
      !Array.isArray(s.values) ||
      s.values.length !== (x.values as unknown[]).length
    )
      problem("每个系列的数据数量必须与分类数量一致。");
    for (const v of s.values as unknown[]) {
      if (v === null) continue;
      if (typeof v !== "number" || !Number.isFinite(v))
        problem("图表值只能是有限数值或 null；缺失值不会补零。");
      count++;
    }
  }
  if (!count) problem("图表没有可绘制的数值，缺失值仍保留在原文中。");
  if (
    root.orientation !== undefined &&
    !["vertical", "horizontal"].includes(String(root.orientation))
  )
    problem("orientation 仅支持 vertical 或 horizontal。");
  if (root.donut !== undefined && typeof root.donut !== "boolean")
    problem("donut 必须是布尔值。");
  if (root.type === "pie") {
    if (series.length !== 1) problem("饼图仅支持单个系列。");
    const values = (series[0] as { values: (number | null)[] }).values;
    if (
      values.some((v) => v !== null && v < 0) ||
      !values.some((v) => v !== null && v > 0)
    )
      problem("饼图数值须非负且至少有一个正值。");
  } else if (root.donut !== undefined) problem("donut 仅用于饼图。");
  if (root.sourceRefs !== undefined) {
    if (
      !Array.isArray(root.sourceRefs) ||
      root.sourceRefs.length > 24 ||
      root.sourceRefs.some(
        (s: unknown) => typeof s !== "string" || !/^S[1-9]\d{0,3}$/.test(s),
      )
    )
      problem("sourceRefs 需要有效的 S1、S2 等来源编号。");
    if (
      new Set(root.sourceRefs as string[]).size !==
      (root.sourceRefs as string[]).length
    )
      problem("sourceRefs 不能重复。");
  }
  return value as ChartData;
}
export function chartText(data: ChartData): string {
  return [
    data.title,
    `${data.x.label} / ${data.y.label}${data.y.unit && data.y.unit.trim() !== data.y.label.trim() ? `（${data.y.unit}）` : ""}`,
    ...data.x.values.map(
      (category, i) =>
        `${category}：${data.series.map((s) => `${s.name} ${s.values[i] === null ? "缺失" : s.values[i]}${s.values[i] === null ? "" : data.y.unit}`).join("；")}`,
    ),
  ].join("\n");
}
const seriesPalette = {
  light: [
    "#3e775e",
    "#8254a1",
    "#ad5d31",
    "#346b9a",
    "#917019",
    "#ad4977",
    "#326f75",
    "#6d6260",
  ],
  dark: [
    "#86c6a4",
    "#c7a4eb",
    "#f1ac85",
    "#8ebbed",
    "#e7c66c",
    "#e99ebc",
    "#78c7cc",
    "#bbafaa",
  ],
};
const lineSymbols = [
  "circle",
  "rect",
  "triangle",
  "diamond",
  "pin",
  "roundRect",
  "arrow",
  "circle",
];
const lineStyles = [
  "solid",
  "dashed",
  "dotted",
  "solid",
  "dashed",
  "dotted",
  "solid",
  "dotted",
];

// Compile only the documented data schema. No user-controlled ECharts options,
// callbacks, HTML, resource URLs, toolbox or transforms are ever forwarded.
export function chartOption(
  data: ChartData,
  theme: PreviewTheme | "export" = "light",
) {
  const colors = previewColors[theme === "dark" ? "dark" : "light"];
  const palette = seriesPalette[theme === "dark" ? "dark" : "light"];
  const canvas = theme === "export" ? lightGraphExport : colors.canvas;
  const axisStyle = {
    axisLine: { show: true, lineStyle: { color: colors.axis } },
    axisTick: { lineStyle: { color: colors.axis } },
    nameTextStyle: { color: colors.muted },
  };
  const horizontal = data.orientation === "horizontal";
  const category = {
    ...axisStyle,
    type: "category",
    name: data.x.label,
    data: data.x.values,
    axisLabel: {
      color: colors.muted,
      hideOverlap: true,
      width: 130,
      overflow: "truncate",
    },
  };
  const numeric = {
    ...axisStyle,
    type: "value",
    name: [
      ...new Set(
        [data.y.label, data.y.unit]
          .map((label) => label.trim())
          .filter(Boolean),
      ),
    ].join(" / "),
    axisLabel: { color: colors.muted },
    splitLine: { lineStyle: { color: colors.grid } },
  };
  return {
    animation: false,
    backgroundColor: canvas,
    color: palette,
    textStyle: {
      fontFamily: "system-ui, sans-serif",
      color: colors.text,
      fontSize: 13,
    },
    title: {
      text: data.title,
      left: "center",
      top: 10,
      textStyle: { color: colors.text, fontSize: 17, fontWeight: "normal" },
    },
    legend: {
      top: 44,
      type: "scroll",
      textStyle: { color: colors.text },
      inactiveColor: colors.muted,
      pageIconColor: colors.text,
      pageIconInactiveColor: colors.muted,
      pageTextStyle: { color: colors.muted },
    },
    tooltip: {
      trigger: data.type === "pie" ? "item" : "axis",
      renderMode: "richText",
      confine: true,
      backgroundColor: colors.surface,
      borderColor: colors.axis,
      textStyle: { color: colors.text },
    },
    ...(data.type === "pie"
      ? {}
      : {
          grid: {
            top: 92,
            left: 66,
            right: 42,
            bottom: 56,
            containLabel: true,
          },
          xAxis: horizontal ? numeric : category,
          yAxis: horizontal ? category : numeric,
        }),
    series:
      data.type === "pie"
        ? [
            {
              type: "pie",
              name: data.series[0].name,
              radius: data.donut ? ["38%", "65%"] : "65%",
              center: ["50%", "59%"],
              avoidLabelOverlap: true,
              label: { color: colors.text, overflow: "truncate", width: 140 },
              itemStyle: { borderColor: canvas, borderWidth: 2 },
              data: data.x.values.flatMap((name, i) =>
                data.series[0].values[i] === null
                  ? []
                  : [
                      {
                        name,
                        value: data.series[0].values[i],
                        itemStyle: { color: palette[i % palette.length] },
                      },
                    ],
              ),
            },
          ]
        : data.series.map((s, index) => ({
            type: data.type,
            name: s.name,
            data: s.values,
            itemStyle: { color: palette[index] },
            ...(data.type === "line"
              ? {
                  connectNulls: false,
                  lineStyle: {
                    color: palette[index],
                    width: 2,
                    type: lineStyles[index],
                  },
                  symbol: lineSymbols[index],
                  symbolSize: 7,
                }
              : { barMaxWidth: 60 }),
          })),
  };
}

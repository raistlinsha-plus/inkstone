import { expect, test } from "vitest";
import { chartIndexChunks } from "./chartIndex";
import { chunkStructured } from "./indexing";
const source = `{
  "schemaVersion": 1,
  "type": "bar",
  "title": "季度收入与成本",
  "x": {
    "label": "季度",
    "values": [
      "Q1",
      "Q2"
    ]
  },
  "y": {"label":"金额", "unit":"万元"},
  "orientation": "horizontal",
  "series": [
    {
      "name":"收入",
      "values": [
        120.00,
        1.50e+2
      ]
    },
    {
      "name":"成本",
      "values": [
        -0,
        null
      ]
    }
  ]
}`;
function facts(chunks: ReturnType<typeof chartIndexChunks>) {
  return chunks.flatMap((chunk) => {
    const parsed = JSON.parse(chunk.text);
    return parsed.数据 ?? [parsed];
  });
}
const lineAt = (text: string, needle: string) =>
  text.slice(0, text.indexOf(needle)).split("\n").length;
test("each category/series/value relationship remains together with title and unit", () => {
  const chunks = chartIndexChunks(source, 1800),
    all = facts(chunks);
  expect(all).toHaveLength(4);
  expect(all).toContainEqual({ 类别: "Q2", 系列: "收入", 数值: 150 });
  expect(all).toContainEqual({ 类别: "Q2", 系列: "成本", 数值: null });
  expect(
    chunks.every(
      (chunk) =>
        chunk.text.includes("季度收入与成本") && chunk.text.includes("万元"),
    ),
  ).toBe(true);
  expect(chunks.map((chunk) => chunk.text).join("\n")).toContain("120.00");
  expect(chunks.map((chunk) => chunk.text).join("\n")).toContain("1.50e+2");
  expect(chunks.map((chunk) => chunk.text).join("\n")).toContain('"数值":-0');
  expect(chunks.map((chunk) => chunk.text).join("\n")).not.toContain(
    "orientation",
  );
  expect(chunks.map((chunk) => chunk.text).join("\n")).not.toContain(
    "horizontal",
  );
});
test("small chunks preserve category/series association and a real range spanning both fields", () => {
  const markdown =
    "# 项目\n\n说明正文。\n\n```chart\n" + source + "\n```\n\n尾部正文";
  const chunks = chunkStructured(markdown, "图表.md", 128);
  const revenue = chunks.find(
    (chunk) =>
      chunk.text.includes("Q2") &&
      chunk.text.includes("收入") &&
      chunk.text.includes("1.50e+2"),
  )!;
  expect(revenue).toBeTruthy();
  expect(revenue.text).toContain("万元");
  expect(revenue.text).toContain("季度收入与成本");
  expect(revenue.startLine).toBeLessThanOrEqual(lineAt(markdown, '"Q2"'));
  expect(revenue.endLine).toBeGreaterThanOrEqual(lineAt(markdown, "1.50e+2"));
  expect(revenue.startLine).toBeLessThan(revenue.endLine);
  expect(
    chunks.every(
      (chunk) =>
        Array.from(chunk.text).length + Array.from(chunk.heading).length + 2 <=
        128,
    ),
  ).toBe(true);
  expect(
    chunks.filter((chunk) => chunk.text.includes("尾部正文")),
  ).toHaveLength(1);
});
test("emoji and long labels respect embedding limits without rounding numeric literals", () => {
  const long = JSON.stringify({
    schemaVersion: 1,
    type: "line",
    title: "长期经营收入📚".repeat(10),
    x: { label: "日期", values: ["类别" + "长📚".repeat(20)] },
    y: { label: "金额", unit: "万元" },
    series: [
      { name: "收入系列".repeat(20), values: [1.2345678901234567e-100] },
    ],
  });
  const chunks = chunkStructured("```chart\n" + long + "\n```", "long.md", 128);
  expect(
    chunks.every(
      (chunk) =>
        Array.from(chunk.text).length + Array.from(chunk.heading).length + 2 <=
        128,
    ),
  ).toBe(true);
  expect(
    chunks.some((chunk) => chunk.text.includes("1.2345678901234567e-100")),
  ).toBe(true);
  expect(chunks.some((chunk) => chunk.text.includes("…"))).toBe(true);
  expect(
    chunks.every(
      (chunk) => JSON.parse(chunk.text).数值 === 1.2345678901234567e-100,
    ),
  ).toBe(true);
});
test("invalid schemas and unsafe numbers retain source text rather than inventing facts", () => {
  for (const bad of [
    source.replace("120.00", "9007199254740993"),
    source.replace('"orientation"', '"arbitraryScript"'),
    source.slice(0, -2),
  ]) {
    const chunks = chunkStructured("```chart\n" + bad + "\n```", "bad.md", 512);
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.map((chunk) => chunk.text).join("")).toBe(bad);
    expect(chunks.some((chunk) => chunk.text.includes('"数据":'))).toBe(false);
  }
});
test("pretty versus one-line JSON and uppercase chart fences report actual source lines", () => {
  const one = JSON.stringify(JSON.parse(source));
  const markdown = "第一行\n\n```CHART\n" + one + "\n```";
  const chunks = chunkStructured(markdown, "one.md", 1800).filter((chunk) =>
    chunk.heading.includes("数据图表"),
  );
  expect(chunks.length).toBeGreaterThan(0);
  expect(
    chunks.every((chunk) => chunk.startLine === 4 && chunk.endLine === 4),
  ).toBe(true);
  expect(facts(chunks)).toContainEqual({ 类别: "Q2", 系列: "收入", 数值: 150 });
});

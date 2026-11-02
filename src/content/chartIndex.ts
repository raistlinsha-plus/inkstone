import { parseChart } from "./chart";
import { inspectJson, type JsonNode } from "./json";
import type { Chunk } from "../types";

const length = (text: string) => Array.from(text).length;
const clip = (text: string, limit: number) => {
  const chars = Array.from(text);
  return chars.length <= limit
    ? text
    : limit > 1
      ? chars.slice(0, limit - 1).join("") + "…"
      : chars.slice(0, limit).join("");
};
function field(node: JsonNode | undefined, key: string): JsonNode {
  const value = node?.children?.find(
    (property) => property.children?.[0]?.value === key,
  )?.children?.[1];
  if (!value) throw Error("图表数据字段缺失，已保留原文。");
  return value;
}
interface Fact {
  category: string;
  series: string;
  raw: string;
  nodes: JsonNode[];
}
// Derived, indexable facts remain valid JSON: source checking can distinguish
// numbers from IDs/years inside labels. Values are copied as lexical tokens,
// never JSON.stringify(Number(token)) or a model-generated summary.
export function chartIndexChunks(source: string, max: number): Chunk[] {
  const data = parseChart(source);
  const root = inspectJson(source).root!;
  const title = field(root, "title"),
    x = field(root, "x"),
    y = field(root, "y"),
    series = field(root, "series");
  const categoryNodes = field(x, "values").children!;
  const commonNodes = [
    title,
    field(x, "label"),
    field(y, "label"),
    field(y, "unit"),
  ];
  const facts: Fact[] = [];
  for (let category = 0; category < data.x.values.length; category++) {
    for (let index = 0; index < data.series.length; index++) {
      const seriesNode = series.children![index];
      const name = field(seriesNode, "name"),
        value = field(seriesNode, "values").children![category];
      facts.push({
        category: data.x.values[category],
        series: data.series[index].name,
        raw: source.slice(value.offset, value.offset + value.length),
        nodes: [...commonNodes, categoryNodes[category], name, value],
      });
    }
  }
  const starts = [0];
  for (let i = 0; i < source.length; i++)
    if (source[i] === "\n") starts.push(i + 1);
  const line = (offset: number) => {
    let lower = 0,
      upper = starts.length;
    while (lower + 1 < upper) {
      const middle = (lower + upper) >>> 1;
      if (starts[middle] <= offset) lower = middle;
      else upper = middle;
    }
    return lower + 1;
  };
  const range = (items: Fact[]) => {
    const nodes = items.flatMap((item) => item.nodes);
    return {
      startLine: line(Math.min(...nodes.map((node) => node.offset))),
      endLine: line(
        Math.max(...nodes.map((node) => node.offset + node.length - 1)),
      ),
    };
  };
  const heading = clip(
    data.title.replace(/\s+/g, " "),
    Math.min(180, Math.floor(max / 5)),
  );
  const context = JSON.stringify({
    图表: data.title,
    分类轴: data.x.label,
    数值轴: data.y.label,
    单位: data.y.unit,
  });
  const record = (fact: Fact) =>
    `{"类别":${JSON.stringify(fact.category)},"系列":${JSON.stringify(fact.series)},"数值":${fact.raw}}`;
  const render = (items: Fact[]) =>
    context.slice(0, -1) + ',"数据":[' + items.map(record).join(",") + "]}";
  const fits = (text: string, title = heading) =>
    length(text) + length(title) + 2 <= max;
  const chunks: Chunk[] = [];
  let pending: Fact[] = [];
  const flush = () => {
    if (pending.length) {
      chunks.push({ heading, text: render(pending), ...range(pending) });
      pending = [];
    }
  };
  for (const fact of facts) {
    if (fits(render([...pending, fact]))) {
      pending.push(fact);
      continue;
    }
    flush();
    if (fits(render([fact]))) {
      pending.push(fact);
      continue;
    }
    // Long labels or a small embedding limit still retain all the fact fields
    // together. Shortened labels carry an ellipsis; the source range points to
    // their complete originals. Never split or approximate a numeric token.
    const labels = [data.title, data.y.unit, fact.category, fact.series];
    const limits = labels.map(length);
    const compact = () =>
      `{"图表":${JSON.stringify(clip(labels[0], limits[0]))},"单位":${JSON.stringify(clip(labels[1], limits[1]))},"类别":${JSON.stringify(clip(labels[2], limits[2]))},"系列":${JSON.stringify(clip(labels[3], limits[3]))},"数值":${fact.raw}}`;
    let text = compact();
    const shortHeading = clip(
      data.title.replace(/\s+/g, " "),
      Math.min(12, Math.floor(max / 10)),
    );
    while (!fits(text, shortHeading)) {
      const largest = limits.reduce(
        (best, current, i) => (current > limits[best] ? i : best),
        0,
      );
      if (limits[largest] <= 1)
        throw Error("切片上限不足以保留图表字段与数值，请增大上限。");
      limits[largest]--;
      text = compact();
    }
    chunks.push({ heading: shortHeading, text, ...range([fact]) });
  }
  flush();
  return chunks;
}

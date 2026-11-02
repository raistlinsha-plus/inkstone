import { expect, test } from "vitest";
import { answerMarkdown, type AnswerSnapshot } from "./answerContent";
import { parseMarkdown, type MarkdownNode } from "./content/blocks";
import { chartTemplate } from "./content/chart";
import type { SearchResult } from "./types";
const source: SearchResult = {
  id: 1,
  path: "documents/source/预算)最终.md",
  text: "收入120万元，150万元。",
  heading: "季度数据",
  title: "预算)最终.md",
  startLine: 3,
  endLine: 8,
  hash: "source-hash",
  score: 1,
  documentId: "source-doc",
};
const snapshot: AnswerSnapshot = {
  id: "answer",
  workspaceRoot: "/project",
  scopeLabel: "当前项目",
  scopePath: null,
  mode: "keyword",
  model: "test",
  createdAt: "2026-10-29T00:00:00Z",
  finishReason: "stop",
};
function nodes(text: string, type: string) {
  const found: MarkdownNode[] = [];
  const walk = (n: MarkdownNode) => {
    if (n.type === type) found.push(n);
    n.children?.forEach(walk);
  };
  walk(parseMarkdown(text));
  return found;
}
const transfer = (
  text: string,
  options: { incomplete?: boolean; rejectedCharts?: number[] } = {},
) =>
  (answerMarkdown as (...args: any[]) => string)(
    text,
    "测试回答",
    [source],
    snapshot,
    "documents/new/回答.md",
    true,
    options,
  );
function assertSourcesOutsideCode(text: string) {
  const headings = nodes(text, "heading");
  expect(
    headings.some((n) =>
      n.children?.some((child) => child.value === "回答来源"),
    ),
  ).toBe(true);
  expect(nodes(text, "link")).toHaveLength(1);
}
test("saved source links encode unmatched ASCII parentheses and resolve from the destination folder", () => {
  const output = transfer("一段回答 [1]。");
  const link = nodes(output, "link")[0];
  expect(
    decodeURIComponent(
      new URL(
        link.url!,
        "https://workspace.invalid/documents/new/回答.md",
      ).pathname.slice(1),
    ),
  ).toBe(source.path);
});
test("saving an indented code answer preserves the first line indentation semantics", () => {
  const output = transfer("    values = [1]\n    print(values)\n");
  expect(nodes(output, "code")[0]?.value).toBe("values = [1]\nprint(values)");
  assertSourcesOutsideCode(output);
});
test("rejected chart blocks remain recoverable source rather than becoming ordinary live charts on save", () => {
  const text = "```chart\n" + chartTemplate + "\n```\n";
  const output = transfer(text, { rejectedCharts: [0] });
  const code = nodes(output, "code")[0];
  expect(code.lang).toBe("chart-unverified");
  expect(code.value).toBe(chartTemplate);
  assertSourcesOutsideCode(output);
});
test("incomplete answers persist every specialized block as unverified but keep ordinary code intact", () => {
  const text =
    ["json", "mindmap", "mermaid", "calendar", "chart"]
      .map((lang) => "```" + lang + "\n内容[1]\n```\n")
      .join("\n") + "\n```python\nprint([1])\n```\n";
  const output = transfer(text, { incomplete: true });
  const code = nodes(output, "code");
  expect(code.slice(0, 5).map((n) => n.lang)).toEqual([
    "json-unverified",
    "mindmap-unverified",
    "mermaid-unverified",
    "calendar-unverified",
    "chart-unverified",
  ]);
  expect(code[5]).toMatchObject({ lang: "python", value: "print([1])" });
  assertSourcesOutsideCode(output);
});
test.each([
  ["plain", "```python\nprint([1])", "python", "print([1])"],
  ["tilde", "~~~python\nprint([1])", "python", "print([1])"],
  ["plain trailing newline", "```python\nprint([1])\n", "python", "print([1])"],
  ["indented literal marker", "```python\nx\n    ```", "python", "x\n    ```"],
  ["quoted literal marker", "```python\nx\n> ```", "python", "x\n> ```"],
  ["quote", '> ```json\n> {"values":[1]}', "json-unverified", '{"values":[1]}'],
  [
    "list",
    '- 说明\n\n  ```json\n  {"values":[1]}',
    "json-unverified",
    '{"values":[1]}',
  ],
  [
    "quote-list",
    '> - 说明\n>\n>   ```json\n>   {"values":[1]}',
    "json-unverified",
    '{"values":[1]}',
  ],
])(
  "unclosed %s fence cannot swallow appended provenance",
  (_, input, language, value) => {
    const output = transfer(input, { incomplete: true });
    expect(nodes(output, "code")[0]).toMatchObject({ lang: language, value });
    assertSourcesOutsideCode(output);
  },
);
test("rejected chart ordinal skips other fences and works inside a blockquote", () => {
  const data = '{"values":[1]}';
  const text =
    "```json\n" +
    data +
    "\n```\n\n> ```chart\n> " +
    chartTemplate.replaceAll("\n", "\n> ") +
    "\n> ```\n\n```chart\n" +
    chartTemplate +
    "\n```\n";
  const output = transfer(text, { rejectedCharts: [0] });
  const code = nodes(output, "code");
  expect(code.map((n) => n.lang)).toEqual([
    "json",
    "chart-unverified",
    "chart",
  ]);
  expect(code[0].value).toBe(data);
  expect(code[1].value).toBe(chartTemplate);
  expect(code[2].value).toBe(chartTemplate);
  assertSourcesOutsideCode(output);
});
test("a wider outer code fence does not turn its inner chart example into a live block", () => {
  const text = "````markdown\n```chart\n" + chartTemplate + "\n```\n````\n";
  const output = transfer(text, { incomplete: true, rejectedCharts: [0] });
  const code = nodes(output, "code");
  expect(code).toHaveLength(1);
  expect(code[0].lang).toBe("markdown");
  expect(code[0].value).toContain("```chart");
  assertSourcesOutsideCode(output);
});

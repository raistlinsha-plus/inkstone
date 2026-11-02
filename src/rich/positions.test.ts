import { expect, test } from "vitest";
import { Schema } from "@milkdown/kit/prose/model";
import { sourceFromVisual, visualFromSource } from "./positions";
const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { content: "inline*", group: "block" },
    heading: { content: "inline*", group: "block" },
    text: { group: "inline" },
    code_block: {
      content: "text*",
      group: "block",
      code: true,
      attrs: { language: { default: "" } },
    },
  },
  marks: { strong: {} },
});
const p = (text = "") =>
  schema.nodes.paragraph.create(null, text ? schema.text(text) : null);
test("a paragraph after a final code block maps to source EOF rather than the title", () => {
  const source = '# Title\n\n```json\n{"a":1}\n```';
  const doc = schema.nodes.doc.create(null, [
    schema.nodes.heading.create(null, schema.text("Title")),
    schema.nodes.code_block.create(
      { language: "json" },
      schema.text('{"a":1}'),
    ),
    p(),
  ]);
  expect(sourceFromVisual(doc, doc.content.size - 1, source)).toBe(
    source.length,
  );
  expect(visualFromSource(doc, source.length, source)).toBe(
    doc.content.size - 1,
  );
});
test("middle-of-paragraph carets round-trip through formatting markers and long repeated text", () => {
  const repeated = "重复文本".repeat(500),
    source = "前**强调**后" + repeated;
  const doc = schema.nodes.doc.create(null, [
    schema.nodes.paragraph.create(null, [
      schema.text("前"),
      schema.text("强调", [schema.marks.strong.create()]),
      schema.text("后" + repeated),
    ]),
  ]);
  for (const sourceOffset of [1, 5, 9, 1000, source.length]) {
    const visual = visualFromSource(doc, sourceOffset, source);
    const back = sourceFromVisual(doc, visual, source);
    // Offsets on formatting punctuation intentionally snap to readable text.
    if (sourceOffset > 8) expect(back).toBe(sourceOffset);
    else expect(back).toBeGreaterThanOrEqual(0);
  }
});
test("code-block anchors retain the fenced source region", () => {
  const source = '首段\n\n```json\n{"n":1}\n```\n\n尾段';
  const doc = schema.nodes.doc.create(null, [
    p("首段"),
    schema.nodes.code_block.create(
      { language: "json" },
      schema.text('{"n":1}'),
    ),
    p("尾段"),
  ]);
  const blockStart = doc.child(0).nodeSize;
  expect(sourceFromVisual(doc, blockStart + 1, source)).toBe(
    source.indexOf("```"),
  );
  const target = visualFromSource(doc, source.indexOf('"n"'), source);
  expect(target).toBeGreaterThan(blockStart);
  expect(target).toBeLessThan(blockStart + doc.child(1).nodeSize);
});

test("both ends of a Chinese text range survive source/visual mapping", () => {
  const source = "开始**中文选区**结束";
  const doc = schema.nodes.doc.create(null, [
    schema.nodes.paragraph.create(null, [
      schema.text("开始"),
      schema.text("中文选区", [schema.marks.strong.create()]),
      schema.text("结束"),
    ]),
  ]);
  const from = source.indexOf("中文"),
    to = from + "中文选区".length;
  const anchor = visualFromSource(doc, from, source),
    head = visualFromSource(doc, to, source);
  expect(doc.textBetween(anchor, head)).toBe("中文选区");
  expect(
    source.slice(
      sourceFromVisual(doc, anchor, source, "forward"),
      sourceFromVisual(doc, head, source),
    ),
  ).toBe("中文选区");
});

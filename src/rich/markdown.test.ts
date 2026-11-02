import { expect, test } from "vitest";
import { RichMarkdownAdapter } from "./markdown";
import { normalizeInlineBreaks } from "./breaks";
import { parseMarkdown, type MarkdownNode } from "../content/blocks";
test("empty paragraphs and inline BR keep ordinary lists readable without exposing arbitrary HTML", () => {
  for (const br of ["<br>", "<br/>", "<br />", "<BR />"]) {
    const source = `# 题头\n\n${br}\n\n- 第一项\n- 第一行${br}第二行\n`;
    const adapter = new RichMarkdownAdapter(source);
    expect(adapter.prepare(source)).toBe(source);
    expect(adapter.serialize(adapter.prepare(source))).toBe(source);
  }
  const source = '<br onclick="evil()">\n\n<script>evil()</script>';
  const adapter = new RichMarkdownAdapter(source);
  expect(adapter.prepare(source)).toContain(adapter.rawLanguage);
  expect(adapter.serialize(adapter.prepare(source))).toBe(source);
});
test("safe BR normalization changes inline nodes only and leaves literal code untouched", () => {
  const inline = { type: "html", value: "<br />" };
  const placeholder = { type: "html", value: "<br />" };
  const code = { type: "code", value: 'print("<br />")' };
  const tree = {
    type: "root",
    children: [
      {
        type: "paragraph",
        children: [
          { type: "text", value: "前" },
          inline,
          { type: "text", value: "后" },
        ],
      },
      { type: "paragraph", children: [placeholder] },
      code,
    ],
  };
  normalizeInlineBreaks(tree);
  expect(inline).toEqual({ type: "break" });
  expect(placeholder).toEqual({ type: "html", value: "<br />" });
  expect(code.value).toBe('print("<br />")');
});
test("HTML stays protected while resolved references become editable inline links and retain their definitions", () => {
  const source =
    '# 写作\n\n正常正文\n\n<div onclick="evil()">保留</div>\n\n[链接][ref]\n\n[ref]: target.md\n\n~~~custom meta=keep\nuntouched\n~~~';
  const adapter = new RichMarkdownAdapter(source),
    prepared = adapter.prepare(source);
  expect(prepared).toContain(adapter.rawLanguage);
  expect(prepared).toContain("正常正文");
  expect(adapter.serialize(prepared)).toBe(source);
  const serialized = prepared.replace(
    "~~~custom meta=keep\nuntouched\n~~~",
    "```custom\nuntouched\n```",
  );
  const updated = adapter.serialize(serialized);
  expect(updated).toContain('<div onclick="evil()">保留</div>');
  expect(updated).toContain("~~~custom meta=keep\nuntouched\n~~~");
  expect(updated).toContain("[ref]: target.md");
  expect(updated).toContain("[链接](<target.md>)");
});
test("source locations count protected raw blocks once and preserve block-local lines", () => {
  const source =
    '# 题头\n\n[保留][ref]\n\n[ref]: target.md\n\n```calendar\n{}\n```\n\n```calendar\n{}\n```\n\n```json\n{\n  "big":9007199254740993\n}\n```\n';
  const adapter = new RichMarkdownAdapter(source);
  const lines = source.split("\n");
  const fence = lines.indexOf("```json") + 1;
  expect(adapter.sourceLocation(source, fence)).toEqual({ index: 2, line: 1 });
  expect(adapter.sourceLocation(source, fence + 2)).toEqual({
    index: 2,
    line: 2,
  });
  expect(adapter.sourceLocation(source, 3)).toBeNull();
  expect(adapter.sourceLocation(source, 1)).toBeNull();
});

function nodes(source: string, type: string) {
  const result: MarkdownNode[] = [];
  const visit = (node: MarkdownNode) => {
    if (node.type === type) result.push(node);
    node.children?.forEach(visit);
  };
  visit(parseMarkdown(source));
  return result;
}
test("resolved references do not turn an ordinary mixed-link paragraph or its definition into raw cards", () => {
  const source =
    '普通 [行内](https://example.com/inline)、[引用][Manual] 与 [锚点](#后文)。\n\n[manual]: https://example.com/help "说明"\n\n## 后文\n\n正文。';
  const adapter = new RichMarkdownAdapter(source),
    prepared = adapter.prepare(source);
  expect(prepared).not.toContain(adapter.rawLanguage);
  expect(nodes(prepared, "link").map((n) => n.url)).toEqual([
    "https://example.com/inline",
    "https://example.com/help",
    "#后文",
  ]);
  expect(nodes(prepared, "definition")).toHaveLength(0);
  expect(adapter.serialize(prepared)).toBe(source);
  const edited = adapter.serialize(prepared.replace("正文。", "正文已编辑。"));
  expect(edited).toContain('[manual]: https://example.com/help "说明"');
  expect(nodes(edited, "link").map((n) => n.url)).toEqual([
    "https://example.com/inline",
    "https://example.com/help",
    "#后文",
  ]);
  const reopened = new RichMarkdownAdapter(edited);
  expect(reopened.prepare(edited)).not.toContain(reopened.rawLanguage);
  expect(reopened.serialize(reopened.prepare(edited))).toBe(edited);
});
test("AST-only reference expansion preserves formatting, images, code literals, and unused or duplicate definitions", () => {
  const source =
    '[**加粗** 与 \`代码\`][r] ![图片][img]\n\n\`[示例][r]\`\n\n\`\`\`text\n[示例][r]\n\`\`\`\n\n[r]: <target (v1).md> "带\\"引号"\n[r]: other.md\n[img]: images/a%20b.png\n[unused]: keep.md';
  const adapter = new RichMarkdownAdapter(source),
    prepared = adapter.prepare(source);
  expect(nodes(prepared, "strong")).toHaveLength(1);
  expect(nodes(prepared, "inlineCode").map((n) => n.value)).toContain(
    "[示例][r]",
  );
  expect(nodes(prepared, "code").map((n) => n.value)).toContain("[示例][r]");
  expect(nodes(prepared, "image")[0].url).toBe("images/a%20b.png");
  const edited = adapter.serialize(prepared + "\n\n新增段落");
  expect(edited).toContain("[unused]: keep.md");
  expect(edited).toContain("[r]: other.md");
  expect(decodeURIComponent(nodes(edited, "link")[0].url!)).toBe(
    "target (v1).md",
  );
});
test("fragment insertion retains both definition sets and an external undo does not resurrect removed definitions", () => {
  const source = "[原链接][a]\n\n[a]: old.md";
  const adapter = new RichMarkdownAdapter(source),
    prepared = adapter.prepare(source);
  const fragment = adapter.prepare(
    "[回答链接][b]\n\n[b]: answer.md",
    "fragment",
  );
  const inserted = adapter.serialize(prepared + "\n\n" + fragment + "\n");
  expect(inserted).toContain("[a]: old.md");
  expect(inserted).toContain("[b]: answer.md");
  expect(nodes(inserted, "link").map((n) => n.url)).toEqual([
    "old.md",
    "answer.md",
  ]);
  const restored = adapter.prepare(source);
  const edited = adapter.serialize(restored + "\n\n另一个修改");
  expect(edited).toContain("[a]: old.md");
  expect(edited).not.toContain("[b]: answer.md");
});

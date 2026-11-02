import { describe, it, expect } from "vitest";
import { DocumentSession, replaceRange, documentKind } from "../session";
import {
  addJsonChild,
  deleteJsonNode,
  formatJson,
  inspectJson,
  pointer,
  replaceJsonValue,
} from "./json";
import { codeBlocks } from "./blocks";
import { editMind, flattenMind, outlineTree } from "./mindmap";
import { chunkStructured } from "./indexing";
import { diagramProblem } from "../preview/Graph";

describe("跨视图文档历史", () => {
  it("源码合并输入，结构和可视化编辑共享撤销/重做", () => {
    const s = new DocumentSession("a");
    s.commit("ab", "source", 0);
    s.commit("abc", "source", 200);
    s.commit("视觉修改", "visual", 1000);
    s.apply("视觉修改", "结构修改");
    s.undo();
    expect(s.content).toBe("视觉修改");
    s.undo();
    expect(s.content).toBe("abc");
    s.undo();
    expect(s.content).toBe("a");
    s.redo();
    expect(s.content).toBe("abc");
    s.commit("分支");
    expect(s.redo()).toBe(false);
  });
  it("拒绝过期预览回写并保留原文", () => {
    const s = new DocumentSession("当前");
    expect(() => s.apply("旧版", "错误")).toThrow("文档已变化");
    expect(s.content).toBe("当前");
  });
  it("新文件类型识别", () => {
    expect(documentKind("配置.JSON")).toBe("json");
    expect(documentKind("图.mmd")).toBe("mermaid");
    expect(documentKind("笔记.md")).toBe("markdown");
  });
});
describe("JSON 精度与局部编辑", () => {
  const source =
    '{"large":9007199254740993,"negative":-0,"exponent":1e+30,"a/b":{"x~y":"中文📚"},"items":[1,2,3]}';
  it("格式化只改空白，保留大整数和数字字面量", () => {
    const next = formatJson(source);
    expect(next).toContain("9007199254740993");
    expect(next).toContain('"negative": -0');
    expect(next).toContain('"exponent": 1e+30');
    expect(inspectJson(next).errors).toEqual([]);
  });
  it("修改字段不会重建其他数字", () => {
    const root = inspectJson(source).root!;
    const node = root.children![3].children![1].children![0].children![1];
    const next = replaceJsonValue(source, node, '"新内容"');
    expect(next).toContain('"large":9007199254740993');
    expect(next).toContain('"x~y":"新内容"');
    expect(pointer(["a/b", "x~y"])).toBe("/a~1b/x~0y");
  });
  it("新增和删除首中尾字段都生成有效 JSON", () => {
    const root = inspectJson(source).root!;
    const added = addJsonChild(source, root, "9007199254740995", "新字段");
    expect(added).toContain('"新字段": 9007199254740995');
    expect(inspectJson(added).errors).toEqual([]);
    for (const item of root.children!) {
      const next = deleteJsonNode(source, item.children![1]);
      expect(inspectJson(next).errors).toEqual([]);
    }
    expect(() => addJsonChild(source, root, "null", "large")).toThrow();
  });
  it("拒绝注释/尾逗号并识别重复键", () => {
    expect(inspectJson('{"a":1,}').errors.length).toBeGreaterThan(0);
    expect(inspectJson('{/*注释*/"a":1}').errors.length).toBeGreaterThan(0);
    expect(inspectJson('{"a":1,"a":2}').duplicate).toBe(true);
  });
});
describe("Markdown 结构回写", () => {
  it("围栏替换保留前后内容与围栏", () => {
    const source =
      '# 前文\r\n\r\n~~~json\r\n{"n":9007199254740993}\r\n~~~\r\n\r\n后文';
    const block = codeBlocks(source)[0];
    const next = replaceRange(
      source,
      block.text,
      block.from,
      block.to,
      formatJson(block.text),
    );
    expect(next.startsWith("# 前文\r\n\r\n~~~json\r\n")).toBe(true);
    expect(next.endsWith("~~~\r\n\r\n后文")).toBe(true);
    expect(next).toContain("9007199254740993");
    expect(() =>
      replaceRange(source, "旧内容", block.from, block.to, "{}"),
    ).toThrow();
  });
  it("脑图仅修改目标节点且删除保护复杂正文", () => {
    const source = "# 项目\n\n- 模块\n  - 子项\n\n## 正文\n\n保留这段内容。\n";
    const nodes = flattenMind(outlineTree(source));
    const item = nodes.find((n) => n.label === "模块")!;
    const renamed = editMind(source, item, "rename", "新模块");
    expect(renamed).toContain("- 新模块\n  - 子项");
    expect(renamed).toContain("保留这段内容。");
    const removed = editMind(source, item, "delete");
    expect(removed).not.toContain("子项");
    expect(removed).toContain("保留这段内容。");
    const heading = nodes.find((n) => n.label === "正文")!;
    expect(heading.editable).toBe(false);
    expect(() => editMind(source, heading, "delete")).toThrow();
  });
  it("脑图复杂列表和多行正文保持只读", () => {
    const source =
      "- 第一行\n  第二行\n\n- 代码分支\n\n  ```js\n  x()\n  ```\n";
    const nodes = flattenMind(outlineTree(source)).filter(
      (n) => n.kind === "list",
    );
    expect(nodes.every((n) => !n.editable)).toBe(true);
  });
  it("图片和分隔线分支不允许结构删除", () => {
    for (const source of [
      "# 资料\n\n![图片](local.png)\n",
      "# 资料\n\n---\n",
    ]) {
      const node = outlineTree(source).children[0];
      expect(node.editable).toBe(false);
      expect(() => editMind(source, node, "delete")).toThrow();
    }
  });
  it("脑图增子节点保持结构", () => {
    const source = "- 中心\n  - 已有子项\n";
    const node = flattenMind(outlineTree(source)).find(
      (n) => n.label === "中心",
    )!;
    expect(editMind(source, node, "child", "新增子项")).toContain(
      "  - 新增子项",
    );
  });
});
describe("图表输入边界", () => {
  it("允许支持的中文图，拒绝配置和外部资源", () => {
    expect(diagramProblem("flowchart LR\n A[中文] --> B[完成]")).toBeNull();
    for (const raw of [
      "%%{init:{}}%%\nflowchart LR",
      "flowchart LR\n click A callback",
      "flowchart LR\n A[<img src=x>]",
      "flowchart LR\n A[https://example.com]",
    ])
      expect(diagramProblem(raw)).not.toBeNull();
  });
});

describe("JSON 索引来源", () => {
  it("按对象路径保存切片和原文行号", () => {
    const source =
      '{\n  "a/b": {\n    "x~y": "中文"\n  },\n  "large": 9007199254740993\n}';
    const chunks = chunkStructured(source, "配置.json", 128);
    expect(chunks[0].heading).toBe("/a~1b");
    expect(chunks[0].startLine).toBe(2);
    expect(chunks[1].startLine).toBe(5);
    expect(chunks[1].text).toContain("9007199254740993");
    expect(
      chunks.every(
        (c) =>
          Array.from(c.heading).length + Array.from(c.text).length + 2 <= 128,
      ),
    ).toBe(true);
  });
  it("深路径和长正文仍遵守 API 字符上限", () => {
    const source = JSON.stringify({ ["路径".repeat(100)]: "正文".repeat(500) });
    expect(
      chunkStructured(source, "a.json", 128).every(
        (c) =>
          Array.from(c.heading).length + Array.from(c.text).length + 2 <= 128,
      ),
    ).toBe(true);
  });
});

it("mixed document indexes each block once with object paths and actual source lines", () => {
  const source =
    '# 主题\n\n正文。\n\n```json\n{"limit":9007199254740993}\n```\n\n```mindmap\n# 目标\n\n- 枝叶\n```\n';
  const chunks = chunkStructured(source, "mixed.md", 200);
  expect(
    chunks.filter((c) => c.text.includes("9007199254740993")),
  ).toHaveLength(1);
  expect(chunks.find((c) => c.heading.includes("/limit"))?.startLine).toBe(6);
  expect(chunks.filter((c) => c.text.includes("枝叶"))).toHaveLength(1);
});

import { expect, test } from "vitest";
import {
  answerFileName,
  answerMarkdown,
  type AnswerSnapshot,
} from "./answerContent";
import { answerSourceUrl } from "./content/answerSourceLink";
import type { SearchResult } from "./types";
const source: SearchResult = {
  id: 1,
  path: "documents/source/季度 数据.md",
  text: "120万元",
  heading: "收入",
  startLine: 3,
  endLine: 6,
  hash: "saved-version",
  score: 1,
  documentId: "source",
};
const snapshot: AnswerSnapshot = {
  id: "turn-1",
  workspaceRoot: "/project",
  scopeLabel: "当前文档 · 季度数据.md",
  scopePath: source.path,
  mode: "hybrid",
  model: "user-model",
  createdAt: "2026-10-29T01:00:00+08:00",
  finishReason: "stop",
};
test("transferred answers preserve literal JSON and locate sources relative to nested managed documents", () => {
  const body =
    '## 结果\n\n```json\n{"values":[1],"years":[2026],"id":9007199254740993}\n```\n\n结论。[1]';
  const value = answerMarkdown(
    body,
    "季度分析",
    [source],
    snapshot,
    "documents/new/回答.md",
    true,
  );
  expect(value).toContain(body);
  expect(value).toContain(
    "../../documents/source/%E5%AD%A3%E5%BA%A6%20%E6%95%B0%E6%8D%AE.md",
  );
  expect(value).toContain("saved-version");
  expect(value).toContain("第 3–6 行");
  expect(value).toContain("当前文档 · 季度数据.md");
});
test("file names cannot smuggle paths and interrupted answers remain labelled", () => {
  expect(answerFileName("../a\n/b:为何?")).not.toMatch(/[\\/\r\n:？]/);
  expect(
    answerMarkdown("未完成", "问题", [], {
      ...snapshot,
      finishReason: "length",
    }),
  ).toContain("可能未完整生成");
});

test("saved scoped and independent answers keep stable document references and captured evidence", () => {
  const target = {
    documentId: "47f3590f-53f5-4d78-bdf3-2c52db06d6ab",
    hash: "c".repeat(64),
    startLine: 3,
    endLine: 6,
  };
  const href = answerSourceUrl(target);
  expect(href).toBeTruthy();
  const scoped = answerMarkdown(
    "结论。[1]",
    "问题",
    [{ ...source, ...target }],
    snapshot,
  );
  expect(scoped).toContain(`](${href})`);
  expect(scoped).toContain("生成时摘录 ` 120万元 `");
  expect(scoped).not.toContain("季度 数据.md");
  const general = answerMarkdown("结论。[1]", "问题", [], snapshot, "", true, {
    externalSources: [
      {
        kind: "document",
        id: `${target.documentId}:3-6`,
        citation: 1,
        label: "旧文件名.md",
        documentId: target.documentId,
        contentHash: target.hash,
        excerpt: "`路径` [不执行](https://example.org)\n" + "原".repeat(500),
      },
      {
        kind: "attachment",
        id: "temporary",
        citation: 2,
        label: "附件",
        excerpt: "当时附件",
        url: "https://example.org/forbidden",
      },
      {
        kind: "web",
        id: "page",
        citation: 3,
        label: "网页",
        url: "https://example.org/reference",
      },
    ],
  });
  expect(general).toContain(`1. 文档 · [旧文件名.md](${href}) · 第 3–6 行`);
  expect(general).toContain(
    "生成时摘录 `` `路径` [不执行](https://example.org)",
  );
  expect(general).not.toContain("原".repeat(500));
  expect(general).toContain("2. 临时文件 · 附件");
  expect(general).not.toContain("/forbidden");
  expect(general).toContain("3. 网页 · [网页](https://example.org/reference)");
});

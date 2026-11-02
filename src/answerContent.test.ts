import { expect, test } from "vitest";
import {
  answerFileName,
  answerMarkdown,
  type AnswerSnapshot,
} from "./answerContent";
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

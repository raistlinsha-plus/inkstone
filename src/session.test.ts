import { expect, test } from "vitest";
import { DocumentSession } from "./session";
test("history availability follows edit, undo, redo and a new edit after undo", () => {
  const doc = new DocumentSession("中文");
  expect(doc.canUndo).toBe(false);
  expect(doc.canRedo).toBe(false);
  doc.commit("中文修改");
  expect(doc.canUndo).toBe(true);
  doc.undo();
  expect(doc.content).toBe("中文");
  expect(doc.canRedo).toBe(true);
  doc.redo();
  expect(doc.content).toBe("中文修改");
  doc.undo();
  doc.commit("另一稿");
  expect(doc.canRedo).toBe(false);
});

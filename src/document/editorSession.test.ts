// @vitest-environment jsdom
import { afterEach, expect, test } from "vitest";
import { readEditorSession, saveEditorSession } from "./editorSession";

afterEach(() => localStorage.clear());

test("switching documents does not inherit the other document's position", () => {
  saveEditorSession("space", "a.md", "source", { selection: 88, scroll: 42 });
  saveEditorSession("space", "a.md", "split");
  expect(readEditorSession("space")).toEqual({
    path: "a.md",
    mode: "split",
    selection: 88,
    scroll: 42,
  });
  saveEditorSession("space", "b.md", "visual");
  expect(readEditorSession("space")).toEqual({
    path: "b.md",
    mode: "visual",
    selection: 0,
    scroll: 0,
  });
  expect(readEditorSession("another-space")).toBeUndefined();
});

test("malformed preferences do not block restoring a valid document path", () => {
  localStorage.setItem(
    "inkstone:session:space",
    '{"path":"old.txt","mode":"bad","selection":-3,"scroll":"4"}',
  );
  expect(readEditorSession("space")).toEqual({
    path: "old.txt",
    mode: undefined,
    selection: 0,
    scroll: 0,
  });
  localStorage.setItem("inkstone:session:space", "{");
  expect(readEditorSession("space")).toBeUndefined();
});

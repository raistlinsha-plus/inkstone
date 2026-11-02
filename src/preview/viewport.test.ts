// @vitest-environment jsdom
import { afterEach, expect, test } from "vitest";
import { graphViewport, loadViewport, saveViewport } from "./viewport";
afterEach(() => localStorage.clear());
test("reading preferences reject nonfinite and unreasonable transforms", () => {
  expect(graphViewport({ x: 0, y: 2, scale: 1 })).toEqual({
    x: 0,
    y: 2,
    scale: 1,
  });
  for (const value of [
    null,
    {},
    { x: Infinity, y: 0, scale: 1 },
    { x: 0, y: 0, scale: 0 },
    { x: 0, y: 0, scale: 100 },
  ])
    expect(graphViewport(value)).toBeNull();
});
test("a reopened document restores only its own numeric reading preference", () => {
  saveViewport("project-a/doc:0", { x: 12, y: 30, scale: 0.8 });
  expect(loadViewport("project-a/doc:0")).toEqual({ x: 12, y: 30, scale: 0.8 });
  expect(loadViewport("project-b/doc:0")).toBeNull();
  localStorage.setItem("inkstone.graph-view.v1:bad", "not json");
  expect(loadViewport("bad")).toBeNull();
});

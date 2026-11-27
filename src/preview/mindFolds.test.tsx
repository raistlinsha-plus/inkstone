// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { readMermaidMind } from "../content/mermaidMindDocument";
import StandaloneMindmap from "./StandaloneMindmap";
import { exportSvg } from "./Graph";
import { mindBranches, visibleMind } from "./mindFolds";

vi.mock("./Graph", () => ({
  default: () => null,
  exportSvg: vi.fn(async () => {}),
}));
afterEach(cleanup);
const source = "mindmap\n  Root\n    A\n      Child\n        Leaf\n    B\n";
const topic = (name: string) => screen.getByRole("treeitem", { name });

test("folding a branch hides its descendants, retains them in SVG, and reveals them when adding a child", async () => {
  const apply = vi.fn();
  render(
    <StandaloneMindmap
      title="Root"
      viewKey="test/fold"
      source={source}
      format="mermaid"
      onApply={apply}
      onError={vi.fn()}
      onHistory={vi.fn()}
    />,
  );
  fireEvent.click(within(topic("A")).getByRole("button", { name: "收起分支" }));
  expect(topic("A").getAttribute("aria-expanded")).toBe("false");
  expect(screen.queryByRole("treeitem", { name: "Child" })).toBeNull();
  expect(
    within(topic("A")).getByRole("button", { name: "展开 2 个节点" }),
  ).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "导出 SVG" }));
  const svg = new DOMParser().parseFromString(
    vi.mocked(exportSvg).mock.calls.at(-1)![0],
    "image/svg+xml",
  );
  expect(svg.querySelector("parsererror")).toBeNull();
  expect([...svg.querySelectorAll("text")].map((el) => el.textContent)).toEqual(
    ["Root", "A", "Child", "Leaf", "B"],
  );
  expect(svg.querySelector("[role=button]")).toBeNull();
  expect(topic("A").getAttribute("aria-expanded")).toBe("false");
  fireEvent.keyDown(topic("A"), { key: "/", metaKey: true });
  expect(topic("Leaf")).toBeTruthy();
  fireEvent.keyDown(topic("A"), { key: "/", ctrlKey: true });
  fireEvent.keyDown(topic("A"), { key: "Tab" });
  expect(topic("Leaf")).toBeTruthy();
  expect(screen.getByRole("textbox")).toBeTruthy();
  expect(apply).not.toHaveBeenCalled();
});

test("source line changes retain meaningful folds and discard ambiguous duplicate paths", () => {
  const before = readMermaidMind(source)!;
  const initial = mindBranches(before);
  const a = before.children[0];
  const folds = new Set([initial.get(a.id)!.key]);
  const after = readMermaidMind(
    source.replace("    A", "    Earlier\n      X\n    A"),
  )!;
  const projected = visibleMind(after, mindBranches(after), folds);
  expect(projected.children[0].children.map((n) => n.label)).toEqual(["X"]);
  expect(projected.children[1].children).toEqual([]);
  const withDuplicate = source.replace("    B", "    A\n      Other");
  const oldDuplicates = readMermaidMind(withDuplicate)!;
  const duplicateFold = mindBranches(oldDuplicates).get(
    oldDuplicates.children[0].id,
  )!.key;
  const edited = readMermaidMind(
    withDuplicate.replace("    A\n", "    A\n      New\n"),
  )!;
  expect(
    visibleMind(
      edited,
      mindBranches(edited),
      new Set([duplicateFold]),
    ).children.every((n) => n.children.length),
  ).toBe(true);
});

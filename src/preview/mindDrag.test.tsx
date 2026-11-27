// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import EditableMindCanvas from "./EditableMindCanvas";

vi.mock("./Graph", () => ({ exportSvg: vi.fn() }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.clear(); });

function canvas() {
  const onPosition = vi.fn();
  const onChange = vi.fn(() => ({ source: "edited", selection: "b" }));
  render(<EditableMindCanvas tree={{ id: "r", label: "Root", movable: false, children: [
    { id: "a", label: "Branch", children: [{ id: "b", label: "Leaf", children: [] }] },
  ] }} source="map" viewKey="drag-test" style="classic" onStyle={vi.fn()} onChange={onChange}
    onPosition={onPosition} onError={vi.fn()} onHistory={vi.fn()} />);
  const drawing = screen.getByRole("tree");
  const stage = drawing.parentElement!;
  const root = screen.getByRole("treeitem", { name: "Root" });
  const branch = screen.getByRole("treeitem", { name: "Branch" });
  const leaf = screen.getByRole("treeitem", { name: "Leaf" });
  const hit = vi.fn((): Element | null => drawing);
  Object.defineProperty(document, "elementFromPoint", { configurable: true, value: hit });
  for (const target of [stage, root, branch, leaf]) {
    Object.assign(target, { setPointerCapture: vi.fn(), hasPointerCapture: () => false });
  }
  return { root, branch, leaf, stage, hit, onPosition, onChange };
}

function pointer(target: Element, type: string, x: number, y: number) {
  const event = new MouseEvent("pointer" + type, { bubbles: true, clientX: x, clientY: y, button: 0 });
  Object.defineProperties(event, { pointerId: { value: 1 }, isPrimary: { value: true } });
  fireEvent(target, event);
}

test("a root dropped on the canvas moves in model units at the saved zoom", () => {
  localStorage.setItem("inkstone.graph-view.v1:drag-test:editable-canvas", JSON.stringify({ x: 20, y: 5, scale: 2 }));
  const { root, stage, onPosition, onChange } = canvas();
  pointer(root, "down", 35, 80);
  pointer(stage, "move", 75, 55);
  pointer(stage, "up", 65, 60);
  expect(onPosition).toHaveBeenCalledExactlyOnceWith("r", 15, -10);
  expect(onChange).not.toHaveBeenCalled();
});

test("the release target wins over the last move and an invalid descendant cannot reparent its ancestor", () => {
  const { branch, leaf, stage, hit, onPosition, onChange } = canvas();
  pointer(branch, "down", 27, 11);
  pointer(stage, "move", 44, 19);
  hit.mockReturnValue(leaf);
  pointer(stage, "up", 51, 26);
  expect(onPosition).not.toHaveBeenCalled();
  expect(onChange).not.toHaveBeenCalled();
  pointer(leaf, "down", 45, 13);
  pointer(stage, "move", 62, 22);
  hit.mockReturnValue(branch);
  pointer(stage, "up", 73, 26);
  expect(onChange).toHaveBeenCalledExactlyOnceWith({ type: "move", id: "b", target: "a", placement: "after" });
  expect(onPosition).not.toHaveBeenCalled();
});

test("small deliberate moves inside the original hit box can reposition, cancellation never writes", () => {
  const { root, stage, hit, onPosition } = canvas();
  hit.mockReturnValue(root);
  pointer(root, "down", 80, 20);
  pointer(stage, "move", 90, 20);
  pointer(stage, "up", 90, 20);
  expect(onPosition).toHaveBeenCalledTimes(1);
  pointer(root, "down", 80, 20);
  pointer(stage, "move", 95, 28);
  pointer(stage, "cancel", 95, 28);
  pointer(stage, "up", 100, 20);
  expect(onPosition).toHaveBeenCalledTimes(1);
});

test("release past the drag threshold works when the OS coalesces moves; an ordinary click never writes", () => {
  localStorage.setItem("inkstone.graph-view.v1:drag-test:editable-canvas", JSON.stringify({ x: 0, y: 0, scale: 1 }));
  const { branch, stage, onPosition, onChange } = canvas();
  pointer(branch, "down", 30, 20);
  pointer(stage, "up", 32, 22);
  expect(onPosition).not.toHaveBeenCalled();
  pointer(branch, "down", 30, 20);
  pointer(stage, "up", 70, 30);
  expect(onPosition).toHaveBeenCalledExactlyOnceWith("a", 40, 10);
  expect(onChange).not.toHaveBeenCalled();
});

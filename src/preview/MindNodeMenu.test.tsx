// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import StandaloneMindmap from "./StandaloneMindmap";
vi.mock("./Graph", () => ({ default: () => null }));

afterEach(cleanup);
function setup(source = "# Map\n\n- A\n- B\n  - Child\n- C\n") {
  const onApply = vi.fn();
  const props = { source, title: "Map", viewKey: "menu-" + source, onHistory: vi.fn(), onApply, onError: vi.fn() };
  const view = render(<StandaloneMindmap {...props} />);
  return { ...view, props, onApply };
}
const topic = (name: string) => screen.getByRole("treeitem", {name});

test("right click selects the target and moves its entire branch, with no write while browsing the menu", () => {
  const { onApply, props } = setup();
  fireEvent.contextMenu(topic("B"), { clientX: 185, clientY: 213 });
  expect(topic("B").getAttribute("aria-selected")).toBe("true");
  const menu = screen.getByRole("menu", {name:"B的节点操作"});
  expect(onApply).not.toHaveBeenCalled();
  fireEvent.click(within(menu).getByRole("menuitem", {name:"上移"}));
  expect(onApply).toHaveBeenCalledWith(props.source, "# Map\n\n- B\n  - Child\n- A\n- C\n");
  expect(screen.queryByRole("menu")).toBeNull();
});

test("root menu skips disabled items and restores keyboard focus on Escape", () => {
  setup();
  const root = topic("Map");
  fireEvent.keyDown(root, {key:"F10",shiftKey:true});
  const menu = screen.getByRole("menu", {name:"Map的节点操作"});
  const first = within(menu).getByRole("menuitem", {name:"新增子节点"});
  expect(document.activeElement).toBe(first);
  expect((within(menu).getByRole("menuitem", {name:"上移"}) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.keyDown(first, {key:"ArrowUp"});
  expect(document.activeElement).toBe(within(menu).getByRole("menuitem", {name:"收起分支"}));
  fireEvent.keyDown(document.activeElement!, {key:"Escape"});
  expect(screen.queryByRole("menu")).toBeNull();
  expect(document.activeElement).toBe(root);
});

test("menu closes on outside interaction and discards its target when the document changes", () => {
  const {props, rerender, onApply} = setup();
  fireEvent.contextMenu(topic("A"));
  expect((screen.getByRole("menuitem",{name:"上移"}) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.pointerDown(document.body);
  expect(screen.queryByRole("menu")).toBeNull();
  fireEvent.keyDown(topic("C"), {key:"ContextMenu"});
  expect((screen.getByRole("menuitem",{name:"下移"}) as HTMLButtonElement).disabled).toBe(true);
  rerender(<StandaloneMindmap {...props} source={props.source.replace("- C","- D")} />);
  expect(screen.queryByRole("menu")).toBeNull();
  expect(onApply).not.toHaveBeenCalled();
});

test("delete on the menu confirms before the branch can be removed", () => {
  const {onApply} = setup();
  fireEvent.contextMenu(topic("B"));
  fireEvent.click(screen.getByRole("menuitem", {name:"删除分支"}));
  expect(screen.queryByRole("menu")).toBeNull();
  expect(screen.getByRole("button", {name:"确认删除"})).toBeTruthy();
  expect(onApply).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", {name:"取消"}));
});

test("Option/Alt plus arrow moves the selected branch and leaves boundary nodes in place", () => {
  const { props, onApply } = setup();
  fireEvent.keyDown(topic("A"), {key:"ArrowUp", altKey:true});
  expect(onApply).not.toHaveBeenCalled();
  fireEvent.keyDown(topic("B"), {key:"ArrowDown", altKey:true});
  expect(onApply).toHaveBeenCalledWith(props.source, "# Map\n\n- A\n- C\n- B\n  - Child\n");
});

test("the node context menu folds and unfolds a branch without writing the document; leaf menus omit the command", () => {
  const {onApply} = setup();
  fireEvent.contextMenu(topic("B"));
  fireEvent.click(screen.getByRole("menuitem", {name:"收起分支"}));
  expect(screen.queryByRole("treeitem",{name:"Child"})).toBeNull();
  fireEvent.contextMenu(topic("B"));
  fireEvent.click(screen.getByRole("menuitem",{name:"展开分支"}));
  expect(topic("Child")).toBeTruthy();
  expect(onApply).not.toHaveBeenCalled();
  fireEvent.contextMenu(topic("Child"));
  expect(screen.queryByRole("menuitem", {name:"收起分支"})).toBeNull();
});

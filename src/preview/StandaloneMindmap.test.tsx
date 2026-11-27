// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import StandaloneMindmap from "./StandaloneMindmap";
import { editMind, outlineTree } from "../content/mindmap";
vi.mock("./Graph", () => ({ default: () => null }));
afterEach(cleanup);

test("an unfinished child name survives leaving the canvas and cannot overwrite a changed source", () => {
  const source = "# 想法\n\n- A\n";
  const props = {
    title: "想法",
    source,
    onApply: vi.fn(),
    onError: vi.fn(),
    onHistory: vi.fn(),
    viewKey: "draft-check",
  };
  const first = render(<StandaloneMindmap {...props} />);
  fireEvent.click(screen.getByRole("button", { name: "新增子节点" }));
  fireEvent.change(screen.getByRole("textbox"), {
    target: { value: "中文命名" },
  });
  first.unmount();
  const second = render(<StandaloneMindmap {...props} />);
  expect((screen.getByRole("textbox") as HTMLInputElement).value).toEqual(
    "中文命名",
  );
  second.rerender(
    <StandaloneMindmap {...props} source={source.replace("- A", "- B")} />,
  );
  expect(
    (screen.getByRole("button", { name: "保存" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  expect(props.onApply).not.toHaveBeenCalled();
});

test("adding under a file with multiple top-level branches preserves its existing headings", () => {
  const source = "# A\r\n\r\n- detail\r\n\r\n# B\r\n";
  const next = editMind(source, outlineTree(source), "child", "C[1]");
  expect(next.startsWith(source)).toBe(true);
  expect(outlineTree(next).children.map((n) => n.label)).toEqual([
    "A",
    "B",
    "C[1]",
  ]);
  expect(next).toContain("\r\n# C\\[1\\]\r\n");
});

test.each(["markdown", "mermaid"] as const)("continues writing siblings and children with the committed source in %s", (format) => {
  const original = format === "markdown" ? "# Map\n\n- Topic\n" : "mindmap\n  root((Map))\n    Topic\n";
  let source = original;
  function view() {
    return <StandaloneMindmap source={source} title="Map" format={format} viewKey={"continuous-" + format}
      onApply={(base, next) => { expect(base).toEqual(source); source = next; }}
      onError={message => { throw new Error(message); }} onHistory={vi.fn()} />;
  }
  const app = render(view());
  fireEvent.keyDown(screen.getByRole("treeitem", { name: "Topic" }), {key:"Enter"});
  const field = () => screen.getByRole("textbox") as HTMLInputElement;
  fireEvent.change(field(), {target:{value:"读书笔记"}});
  fireEvent.keyDown(field(), {key:"Enter", shiftKey:true, isComposing:true, keyCode:229});
  expect(source).toBe(original);
  fireEvent.keyUp(field(), {key:"Enter"});
  fireEvent.keyDown(field(), {key:"Enter", shiftKey:true});
  app.rerender(view());
  expect(field().value).toBe("");
  fireEvent.change(field(), {target:{value:"Plan"}});
  fireEvent.keyDown(field(), {key:"Enter", metaKey:true});
  app.rerender(view());
  expect(field().value).toBe("");
  fireEvent.change(field(), {target:{value:"Child"}});
  fireEvent.click(screen.getByRole("button",{name:"保存"}));
  app.rerender(view());
  expect(screen.getByRole("treeitem",{name:"Child"}).getAttribute("aria-level")).toBe("3");
  expect(screen.getByRole("treeitem",{name:"读书笔记"}).getAttribute("aria-level")).toBe("2");
  expect(screen.queryByRole("textbox")).toBeNull();
});

test("a legacy circular center fits its title and shares the selection frame, while circular subtopics keep their shape", () => {
  const onApply = vi.fn();
  render(<StandaloneMindmap title="阅读" format="mermaid" viewKey="legacy-center"
    source={"mindmap\n  root((假期阅读安排))\n    child((书单))\n"} onApply={onApply}
    onError={vi.fn()} onHistory={vi.fn()} />);
  const center = screen.getByRole("treeitem", {name:"假期阅读安排"});
  const frame = center.querySelector(":scope > rect:not([data-ui])")!;
  const selection = center.querySelector(".mind-node-highlight")!;
  expect(center.querySelector(":scope > ellipse")).toBeNull();
  expect(Number(frame.getAttribute("width"))).toBeGreaterThan(Number(frame.getAttribute("height")) * 2);
  for (const attr of ["width", "height", "rx"]) expect(selection.getAttribute(attr)).toBe(frame.getAttribute(attr));
  expect(screen.getByRole("treeitem", {name:"书单"}).querySelector("ellipse")).toBeTruthy();
  expect(onApply).not.toHaveBeenCalled();
});

test("a WebKit pointer blur without a new focus target keeps the style option mounted until click", () => {
  const source = "mindmap\n  root((Map))\n    A\n";
  const onApply = vi.fn();
  render(<StandaloneMindmap title="Map" format="mermaid" viewKey="webkit-style"
    source={source} onApply={onApply} onError={vi.fn()} onHistory={vi.fn()} />);
  const toggle = screen.getByRole("button", { name: "样式" });
  fireEvent.click(toggle);
  const color = screen.getByRole("menuitemradio", { name: "彩色分支" });
  fireEvent.pointerDown(color);
  fireEvent.mouseDown(color);
  fireEvent.blur(document.activeElement!, { relatedTarget: null });
  expect(color.isConnected).toBe(true);
  fireEvent.mouseUp(color);
  fireEvent.click(color);
  expect(onApply).toHaveBeenCalledWith(source, source.replace("mindmap\n", "mindmap\n%% inkstone-mind-style: color\n"));
  expect(screen.queryByRole("menu")).toBeNull();
  expect(document.activeElement).toBe(toggle);
  fireEvent.click(toggle);
  fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
  expect(document.activeElement).toBe(screen.getByRole("menuitemradio", { name: "彩色分支" }));
  fireEvent.keyDown(document.activeElement!, { key: "Escape" });
  expect(screen.queryByRole("menu")).toBeNull();
  expect(document.activeElement).toBe(toggle);
  fireEvent.click(toggle);
  fireEvent.pointerDown(document.body);
  expect(screen.queryByRole("menu")).toBeNull();
});

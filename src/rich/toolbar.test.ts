// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vitest";
import { fireEvent, getByRole, queryByRole } from "@testing-library/react";
import { enhanceFormattingToolbar } from "./toolbar";

function mountedBar(startWidth: number) {
  let width = startWidth;
  const bar = document.createElement("div");
  bar.innerHTML =
    '<div class="top-bar-inner"><div class="top-bar-heading-selector"><button class="top-bar-heading-button">正文</button></div>' +
    Array.from(
      { length: 8 },
      () => '<button class="top-bar-item"><svg></svg></button>',
    ).join("") +
    "</div>";
  document.body.append(bar);
  vi.spyOn(bar, "getBoundingClientRect").mockImplementation(() => ({
    width,
    height: 32,
    top: 0,
    bottom: 32,
    left: 0,
    right: width,
    x: 0,
    y: 0,
    toJSON() {},
  }));
  const onCommand = vi.fn();
  const toolbar = enhanceFormattingToolbar(bar, onCommand);
  return {
    bar,
    onCommand,
    toolbar,
    resize: (next: number) => {
      width = next;
      fireEvent(window, new Event("resize"));
    },
  };
}
afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

test("a wide toolbar keeps all original commands and no overflow trigger", () => {
  const { bar, toolbar } = mountedBar(640);
  expect(getByRole(bar, "button", { name: "粗体" }).hidden).toBe(false);
  expect(getByRole(bar, "button", { name: "链接" }).hidden).toBe(false);
  expect(queryByRole(bar, "button", { name: "更多文字格式" })).toBeNull();
  expect(bar.querySelectorAll(".top-bar-item")).toHaveLength(8);
  toolbar.destroy();
});

test("narrow overflow invokes the original command, preserves selected state and closes", () => {
  vi.stubGlobal("PointerEvent", MouseEvent);
  const { bar, toolbar, onCommand } = mountedBar(220);
  const original = bar.querySelectorAll<HTMLButtonElement>(".top-bar-item")[1];
  original.classList.add("active");
  toolbar.refresh();
  const pointer = vi.fn();
  original.addEventListener("pointerdown", pointer);
  const more = getByRole(bar, "button", { name: "更多文字格式" });
  fireEvent.click(more);
  const option = getByRole(bar, "menuitemcheckbox", { name: "斜体" });
  expect(option.getAttribute("aria-checked")).toBe("true");
  fireEvent.click(option);
  expect(pointer).toHaveBeenCalledTimes(1);
  expect(onCommand).toHaveBeenCalledWith(original);
  expect(queryByRole(bar, "menu")).toBeNull();
  expect(more.getAttribute("aria-expanded")).toBe("false");
  toolbar.destroy();
});

test("overflow supports arrows and Escape returns to its trigger", () => {
  const { bar, toolbar } = mountedBar(220);
  const more = getByRole(bar, "button", { name: "更多文字格式" });
  more.focus();
  fireEvent.keyDown(more, { key: "ArrowDown" });
  expect(document.activeElement).toBe(
    getByRole(bar, "menuitemcheckbox", { name: "斜体" }),
  );
  fireEvent.keyDown(document.activeElement!, { key: "End" });
  expect(document.activeElement).toBe(
    getByRole(bar, "menuitemcheckbox", { name: "链接" }),
  );
  fireEvent.keyDown(document.activeElement!, { key: "Escape" });
  expect(document.activeElement).toBe(more);
  expect(queryByRole(bar, "menu")).toBeNull();
  toolbar.destroy();
});

test("resizing reveals hidden controls without duplicating or discarding commands", () => {
  const { bar, toolbar, resize } = mountedBar(220);
  expect(queryByRole(bar, "button", { name: "链接" })).toBeNull();
  resize(640);
  expect(getByRole(bar, "button", { name: "链接" }).hidden).toBe(false);
  expect(queryByRole(bar, "button", { name: "更多文字格式" })).toBeNull();
  resize(220);
  fireEvent.click(getByRole(bar, "button", { name: "更多文字格式" }));
  expect(getByRole(bar, "menuitemcheckbox", { name: "链接" })).toBeTruthy();
  expect(bar.querySelectorAll(".top-bar-item")).toHaveLength(8);
  toolbar.destroy();
});

test("IME arrows do not open overflow, and widening an open menu keeps focus on visible controls", () => {
  const { bar, toolbar, resize } = mountedBar(220);
  const more = getByRole(bar, "button", { name: "更多文字格式" });
  more.focus();
  fireEvent.keyDown(more, { key: "ArrowDown", isComposing: true });
  expect(queryByRole(bar, "menu")).toBeNull();
  fireEvent.keyDown(more, { key: "ArrowDown" });
  expect(document.activeElement?.getAttribute("role")).toBe("menuitemcheckbox");
  resize(640);
  expect(queryByRole(bar, "menu")).toBeNull();
  expect(bar.contains(document.activeElement)).toBe(true);
  expect((document.activeElement as HTMLButtonElement).hidden).toBe(false);
  toolbar.destroy();
});

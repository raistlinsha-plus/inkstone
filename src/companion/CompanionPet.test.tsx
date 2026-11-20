// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import CompanionPet from "./CompanionPet";
import { petPanelFrame, petFrame, readPetPlacement } from "./petPlacement";

const props = {
  role: "motuan" as const,
  outfit: 0,
  moving: true,
  quiet: false,
  milestone: false,
  activity: "idle" as const,
  busy: false,
  onQuiet: vi.fn(),
  onHide: vi.fn(),
  onStories: vi.fn(),
  onRecord: vi.fn(),
};
const avatar = () => screen.getByRole("button", { name: "墨团桌宠" });
const anchor = () => avatar().parentElement!;
const sprite = () => avatar().querySelector("[data-state]")!;
const positionKey = "inkstone:companion:pet-placement";

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

test("drag snaps to the nearest edge and restores relative height across window sizes", () => {
  let width = 900,
    height = 550;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      const editor = this.classList.contains("editor-panes");
      return new DOMRect(
        100,
        editor ? 100 : 40,
        width,
        editor ? height : height + 90,
      );
    },
  );
  const ui = () =>
    render(
      <main className="main-content">
        <div className="editor-panes" />
        <CompanionPet {...props} />
      </main>,
    );
  const first = ui();
  const pet = avatar();
  pet.setPointerCapture = vi.fn();
  expect(anchor().dataset.form).toBe("sprite");
  fireEvent.pointerDown(pet, {
    pointerId: 1,
    button: 0,
    clientX: 961,
    clientY: 593,
  });
  fireEvent.pointerMove(pet, { pointerId: 1, clientX: 125, clientY: 325 });
  expect(sprite().getAttribute("data-state")).toBe("held");
  fireEvent.pointerUp(pet, { pointerId: 1, clientX: 125, clientY: 325 });
  fireEvent.click(pet, { detail: 1 });
  expect(pet.getAttribute("aria-expanded")).toBe("false");
  const stored = readPetPlacement();
  expect(stored.side).toBe("left");
  expect(stored.heightRatio).toBeGreaterThan(0.3);
  expect(stored.heightRatio).toBeLessThan(0.4);
  first.unmount();
  width = 490;
  height = 340;
  ui();
  expect(anchor().dataset.form).toBe("bookmark");
  expect(anchor().dataset.side).toBe("left");
  const expected = petFrame(
    { left: 0, top: 60, width, height, compact: true },
    stored,
  );
  expect(parseFloat(anchor().style.top)).toBeCloseTo(expected.y);
  width = 900;
  fireEvent(window, new Event("resize"));
  expect(anchor().dataset.form).toBe("sprite");
  expect(readPetPlacement()).toEqual(stored);
});

test("damaged storage falls back, and the focused pet can move with arrow keys", () => {
  for (const bad of [
    "{",
    "null",
    '{"side":"left","heightRatio":"0.4"}',
    '{"side":"center","heightRatio":0.5}',
    '{"side":"right","heightRatio":2}',
  ]) {
    localStorage.setItem(positionKey, bad);
    expect(readPetPlacement()).toEqual({ side: "right", heightRatio: 0.93 });
  }
  render(<CompanionPet {...props} />);
  const pet = avatar();
  pet.focus();
  fireEvent.keyDown(pet, { key: "ArrowLeft", isComposing: true });
  expect(anchor().dataset.side).toBe("right");
  act(() => {
    fireEvent.keyDown(pet, { key: "ArrowLeft" });
    fireEvent.keyDown(pet, { key: "ArrowUp" });
  });
  expect(readPetPlacement().side).toBe("left");
  expect(readPetPlacement().heightRatio).toBeCloseTo(0.83);
  expect(document.activeElement).toBe(pet);
  expect(pet.getAttribute("aria-expanded")).toBe("false");
});

test("menu Escape respects IME and outside clicks leave the editor caret alone", () => {
  render(
    <main>
      <textarea aria-label="编辑" defaultValue="写到这里" />
      <CompanionPet {...props} />
    </main>,
  );
  const editor = screen.getByRole("textbox") as HTMLTextAreaElement;
  const pet = avatar();
  editor.focus();
  editor.setSelectionRange(1, 3);
  pet.setPointerCapture = vi.fn();
  fireEvent.pointerDown(pet, { pointerId: 1, button: 0 });
  fireEvent.pointerUp(pet, { pointerId: 1 });
  fireEvent.click(pet, { detail: 1 });
  expect(document.activeElement).toBe(editor);
  const action = screen.getByRole("button", { name: "摸摸" });
  action.focus();
  fireEvent.keyDown(action, { key: "Escape", keyCode: 229 });
  expect(pet.getAttribute("aria-expanded")).toBe("true");
  fireEvent.keyDown(action, { key: "Escape" });
  expect(document.activeElement).toBe(editor);
  expect([editor.selectionStart, editor.selectionEnd]).toEqual([1, 3]);
  fireEvent.click(pet);
  fireEvent.pointerDown(editor);
  expect(screen.queryByRole("button", { name: "摸摸" })).toBeNull();
  expect(document.activeElement).toBe(editor);
});

test("only a new working-to-ready transition gives one silent ready pose", () => {
  vi.useFakeTimers();
  const page = (
    activity: "working" | "ready" | "blocked" | "needs_input",
    moving = true,
  ) => (
    <main>
      <input aria-label="编辑" />
      <CompanionPet {...props} moving={moving} activity={activity} />
    </main>
  );
  const ui = render(page("ready"));
  const editor = screen.getByRole("textbox");
  editor.focus();
  expect(sprite().getAttribute("data-state")).toBe("idle");
  ui.rerender(page("working"));
  expect(sprite().getAttribute("data-state")).toBe("reading");
  ui.rerender(page("blocked"));
  expect(sprite().getAttribute("data-state")).toBe("idle");
  ui.rerender(page("needs_input"));
  ui.rerender(page("ready"));
  expect(sprite().getAttribute("data-state")).toBe("idle");
  ui.rerender(page("working"));
  ui.rerender(page("ready", false));
  expect(sprite().getAttribute("data-state")).toBe("ready");
  expect(sprite().getAttribute("data-motion")).toBe("static");
  expect(screen.queryByRole("status")).toBeNull();
  expect(document.activeElement).toBe(editor);
  act(() => vi.advanceTimersByTime(1500));
  ui.rerender(page("ready"));
  expect(sprite().getAttribute("data-state")).toBe("idle");
});

test("a fast answer supersedes earlier greetings and does not replay them", () => {
  vi.useFakeTimers();
  const ui = render(<CompanionPet {...props} />);
  fireEvent.click(avatar());
  const greet = screen.getByRole("button", { name: "摸摸" });
  fireEvent.click(greet);
  expect(sprite().getAttribute("data-state")).toBe("happy");
  ui.rerender(<CompanionPet {...props} activity="working" />);
  expect(sprite().getAttribute("data-state")).toBe("reading");
  fireEvent.click(greet);
  expect(sprite().getAttribute("data-state")).toBe("happy");
  ui.rerender(<CompanionPet {...props} activity="ready" />);
  expect(sprite().getAttribute("data-state")).toBe("ready");
  act(() => vi.advanceTimersByTime(1100));
  expect(sprite().getAttribute("data-state")).toBe("idle");
});

test("pet panel stays within the editor on either edge and in a short split window", () => {
  for (const width of [150, 480, 1100])
    for (const height of [32, 150, 800])
      for (const side of ["left", "right"] as const)
        for (const heightRatio of [0, 0.3, 1]) {
          const area = {
            left: 22,
            top: 119,
            width,
            height,
            compact: width < 640,
          };
          const place = { side, heightRatio };
          const pet = petFrame(area, place),
            panel = petPanelFrame(area, place);
          expect(pet.x + panel.left).toBeGreaterThanOrEqual(area.left);
          expect(pet.x + panel.left + panel.width).toBeLessThanOrEqual(
            area.left + width,
          );
          const top =
            panel.top === 0 ? pet.y : pet.y + pet.height - panel.maxHeight;
          expect(top).toBeGreaterThanOrEqual(area.top - 1e-6);
          expect(top + panel.maxHeight).toBeLessThanOrEqual(
            area.top + height + 1e-6,
          );
        }
});

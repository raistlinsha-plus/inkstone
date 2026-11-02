// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { imeBoundary, isImeEvent } from "./ime";
import ModalDialog from "../ModalDialog";
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
test("IME Escape and WebKit 229 cannot close a modal; ordinary Escape still can", () => {
  const close = vi.fn();
  render(
    <ModalDialog label="名称" onClose={close}>
      <input aria-label="标题" />
    </ModalDialog>,
  );
  const input = screen.getByLabelText("标题");
  fireEvent.keyDown(input, { key: "Escape", isComposing: true });
  fireEvent.keyDown(input, { key: "Escape", keyCode: 229 });
  expect(close).not.toHaveBeenCalled();
  fireEvent.keyDown(input, { key: "Escape" });
  expect(close).toHaveBeenCalledOnce();
});
test("candidate commit does not submit a form, subsequent deliberate submit works", () => {
  let frame: FrameRequestCallback;
  vi.stubGlobal("requestAnimationFrame", (f: FrameRequestCallback) => {
    frame = f;
    return 1;
  });
  const submit = vi.fn((e) => e.preventDefault());
  render(
    <div {...imeBoundary}>
      <form aria-label="重命名" onSubmit={submit}>
        <input aria-label="标题" />
        <button>保存</button>
      </form>
    </div>,
  );
  const input = screen.getByLabelText("标题");
  input.focus();
  fireEvent.compositionStart(input);
  fireEvent.submit(screen.getByRole("form"));
  expect(submit).not.toHaveBeenCalled();
  fireEvent.compositionEnd(input);
  fireEvent.submit(screen.getByRole("form"));
  expect(submit).not.toHaveBeenCalled();
  frame!(0);
  fireEvent.submit(screen.getByRole("form"));
  expect(submit).toHaveBeenCalledOnce();
});
test("legacy WebKit keyCode=229 is recognized without a composition flag", () =>
  expect(isImeEvent({ keyCode: 229 })).toBe(true));

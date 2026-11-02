// @vitest-environment jsdom
import { fireEvent, render, cleanup } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import ModalDialog from "./ModalDialog";
afterEach(cleanup);
test("a child autoFocus cannot replace the outside trigger in the return-focus boundary", () => {
  const trigger = document.createElement("button");
  document.body.append(trigger);
  trigger.focus();
  const { unmount, getByRole } = render(
    <ModalDialog label="自动聚焦" onClose={() => {}}>
      <input autoFocus aria-label="文件名" />
    </ModalDialog>,
  );
  expect(document.activeElement).toBe(getByRole("textbox"));
  unmount();
  expect(document.activeElement).toBe(trigger);
  trigger.remove();
});
test("modal contains keyboard focus, hides background, and restores trigger on close", () => {
  const trigger = document.createElement("button");
  document.body.append(trigger);
  trigger.focus();
  const close = vi.fn();
  const { getByRole, unmount } = render(
    <ModalDialog label="测试弹窗" onClose={close}>
      <button>首项</button>
      <button>末项</button>
    </ModalDialog>,
  );
  const first = getByRole("button", { name: "首项" }),
    last = getByRole("button", { name: "末项" });
  expect(document.activeElement).toBe(first);
  expect(trigger.hasAttribute("inert")).toBe(true);
  last.focus();
  fireEvent.keyDown(last, { key: "Tab" });
  expect(document.activeElement).toBe(first);
  fireEvent.keyDown(first, { key: "Tab", shiftKey: true });
  expect(document.activeElement).toBe(last);
  fireEvent.keyDown(last, { key: "Escape" });
  expect(close).toHaveBeenCalledOnce();
  unmount();
  expect(trigger.hasAttribute("inert")).toBe(false);
  expect(document.activeElement).toBe(trigger);
  trigger.remove();
});
test("busy modal keeps Escape inside without closing", () => {
  const close = vi.fn();
  const { getByRole } = render(
    <ModalDialog label="处理中" onClose={close} busy>
      <button>停止</button>
    </ModalDialog>,
  );
  fireEvent.keyDown(getByRole("button"), { key: "Escape" });
  expect(close).not.toHaveBeenCalled();
});
test("focus trap skips controls disabled by a fieldset", () => {
  const { getByRole } = render(
    <ModalDialog label="正在连接" onClose={() => {}} busy>
      <fieldset disabled>
        <input aria-label="服务地址" />
        <button>测试</button>
      </fieldset>
      <button>停止连接</button>
    </ModalDialog>,
  );
  const stop = getByRole("button", { name: "停止连接" });
  expect(document.activeElement).toBe(stop);
  fireEvent.keyDown(stop, { key: "Tab" });
  expect(document.activeElement).toBe(stop);
  fireEvent.keyDown(stop, { key: "Tab", shiftKey: true });
  expect(document.activeElement).toBe(stop);
});
test("the top dialog owns background isolation when another dialog finishes", () => {
  const trigger = document.createElement("button");
  document.body.append(trigger);
  trigger.focus();
  const dialogs = (first: boolean) => (
    <>
      {first && (
        <ModalDialog label="模型设置" onClose={() => {}}>
          <button>保存设置</button>
        </ModalDialog>
      )}
      <ModalDialog label="导入" onClose={() => {}}>
        <button>导入文件</button>
      </ModalDialog>
    </>
  );
  const { getByRole, rerender, unmount } = render(dialogs(true));
  const top = getByRole("dialog", { name: "导入" });
  expect(top.closest("[inert]")).toBeNull();
  expect(document.activeElement).toBe(
    getByRole("button", { name: "导入文件" }),
  );
  rerender(dialogs(false));
  expect(trigger.hasAttribute("inert")).toBe(true);
  expect(top.closest("[inert]")).toBeNull();
  unmount();
  expect(trigger.hasAttribute("inert")).toBe(false);
  expect(document.activeElement).toBe(trigger);
  trigger.remove();
});
test("Tab stays in the modal when a pending save disables every control", () => {
  const content = (busy: boolean) => (
    <ModalDialog label="保存中" onClose={() => {}} busy={busy}>
      <button disabled={busy}>保存</button>
    </ModalDialog>
  );
  const { getByRole, rerender } = render(content(false));
  const button = getByRole("button");
  button.focus();
  rerender(content(true));
  fireEvent.keyDown(button, { key: "Tab" });
  expect(document.activeElement).toBe(getByRole("dialog"));
});

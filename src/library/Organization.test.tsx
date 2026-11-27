// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { SpaceManager } from "./Organization";
import type { LibraryView } from "../library";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  invoke.mockReset();
});

const view: LibraryView = {
  projects: [
    { id: "a", title: "阅读" },
    { id: "b", title: "笔记" },
    { id: "c", title: "历史", archived: true },
  ],
  documents: [],
  pendingImports: [],
};
function show() {
  const close = vi.fn();
  render(
    <SpaceManager
      view={view}
      onClose={close}
      onEnter={vi.fn()}
      onRefresh={async () => {}}
    />,
  );
  return close;
}
const button = (name: string) => screen.getByRole("button", { name });
const search = () => screen.getByRole("searchbox", { name: "搜索空间名称" });

test("space search retains focus on clear; row actions support arrows, outside dismissal and layered Escape", () => {
  const close = show();
  expect(document.activeElement).toBe(search());
  button("新建空间").focus();
  fireEvent.click(search().closest(".space-search")!);
  expect(document.activeElement).toBe(search());
  fireEvent.change(search(), { target: { value: "无匹配项" } });
  expect(screen.getByRole("status").textContent).toBe("没有匹配的空间");
  expect(document.activeElement).toBe(search());
  fireEvent.change(search(), { target: { value: "笔" } });
  expect(screen.queryByRole("button", { name: "阅读" })).toBeNull();
  fireEvent.click(button("清除搜索"));
  expect(document.activeElement).toBe(search());
  const more = button("阅读的更多操作");
  fireEvent.keyDown(more, { key: "ArrowDown" });
  expect(document.activeElement).toBe(
    screen.getByRole("menuitem", { name: "置顶" }),
  );
  fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
  expect(document.activeElement).toBe(
    screen.getByRole("menuitem", { name: "重命名" }),
  );
  fireEvent.keyDown(document.activeElement!, { key: "Escape" });
  expect(screen.queryByRole("menu")).toBeNull();
  expect(document.activeElement).toBe(more);
  expect(close).not.toHaveBeenCalled();
  fireEvent.click(more);
  fireEvent.pointerDown(search());
  expect(screen.queryByRole("menu")).toBeNull();
  fireEvent.keyDown(search(), { key: "Escape" });
  expect(close).toHaveBeenCalledOnce();
});

test("the last row menu opens above its trigger within the dialog", () => {
  show();
  const more = button("笔记的更多操作");
  vi.spyOn(more, "getBoundingClientRect").mockReturnValue(
    new DOMRect(255, 372, 30, 30),
  );
  vi.spyOn(screen.getByRole("region", {name:"我的空间"}), "getBoundingClientRect").mockReturnValue(
    new DOMRect(0, 75, 300, 340),
  );
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(
    function (this: HTMLElement) {
      return this.getAttribute("role") === "menu" ? 112 : 30;
    },
  );
  fireEvent.click(more);
  expect(screen.getByRole("menu").style.top).toBe("181px");
});

test("rename edits the original row, preselects its name and keeps duplicate errors and IME cancellation inside the field", async () => {
  const close = show();
  fireEvent.click(button("已归档"));
  fireEvent.click(button("历史的更多操作"));
  fireEvent.click(screen.getByRole("menuitem", { name: "重命名" }));
  const input = screen.getByRole("textbox", {
    name: "空间名称",
  }) as HTMLInputElement;
  const row = input.closest(".space-record")!;
  expect(input.value).toBe("历史");
  expect(input.selectionStart).toBe(0);
  expect(input.selectionEnd).toBe(2);
  fireEvent.change(input, { target: { value: "阅读" } });
  fireEvent.submit(input.closest("form")!);
  expect(within(row as HTMLElement).getByRole("alert").textContent).toBe(
    "空间名称重复",
  );
  expect(invoke).not.toHaveBeenCalled();
  fireEvent.compositionStart(input);
  fireEvent.keyDown(input, { key: "Escape", keyCode: 229 });
  fireEvent.compositionEnd(input);
  fireEvent.submit(input.closest("form")!);
  expect(invoke).not.toHaveBeenCalled();
  fireEvent.keyUp(input, { key: "Enter" });
  fireEvent.keyDown(input, { key: "Escape" });
  expect(screen.queryByLabelText("空间名称")).toBeNull();
  expect(document.activeElement).toBe(button("历史的更多操作"));
  expect(close).not.toHaveBeenCalled();
  fireEvent.click(button("历史的更多操作"));
  fireEvent.click(screen.getByRole("menuitem", { name: "重命名" }));
  const changed = screen.getByRole("textbox", { name: "空间名称" });
  fireEvent.change(changed, { target: { value: "归档资料" } });
  fireEvent.submit(changed.closest("form")!);
  await waitFor(() => expect(screen.queryByLabelText("空间名称")).toBeNull());
  expect(invoke).toHaveBeenCalledWith("library_rename_project", {
    id: "c",
    title: "归档资料",
  });
  expect(button("已归档").getAttribute("aria-pressed")).toBe("true");
});

test("creating a space shows a labeled form, ignores candidate Enter and submits once", async () => {
  show();
  invoke.mockResolvedValue({ id: "d" });
  fireEvent.click(button("新建空间"));
  const field = screen.getByRole("textbox", { name: "空间名称" });
  fireEvent.change(field, { target: { value: "写作" } });
  const form = field.closest("form")!;
  fireEvent.compositionStart(field);
  fireEvent.submit(form);
  expect(invoke).not.toHaveBeenCalled();
  fireEvent.compositionEnd(field);
  fireEvent.keyUp(field, { key: "Enter" });
  fireEvent.click(button("创建"));
  fireEvent.submit(form);
  await waitFor(() => expect(screen.queryByLabelText("空间名称")).toBeNull());
  expect(invoke).toHaveBeenCalledTimes(1);
  expect(invoke).toHaveBeenCalledWith("library_create_project", {
    title: "写作",
  });
});

test("a renamed search result stays visible and keeps keyboard focus", async () => {
  const current = { ...view, projects: view.projects.map(project => ({ ...project })) };
  const props = {
    view: current, onEnter: vi.fn(), onClose: vi.fn(),
    onRefresh: async () => {
      current.projects[0].title = "待读";
    },
  };
  render(<SpaceManager {...props} />);
  fireEvent.change(search(), { target: { value: "阅读" } });
  fireEvent.click(button("阅读的更多操作"));
  fireEvent.click(screen.getByRole("menuitem", { name: "重命名" }));
  const field = screen.getByRole("textbox", { name: "空间名称" });
  fireEvent.change(field, { target: { value: "待读" } });
  fireEvent.submit(field.closest("form")!);
  await waitFor(() => expect(document.activeElement).toBe(button("待读的更多操作")));
  expect((search() as HTMLInputElement).value).toBe("");
});

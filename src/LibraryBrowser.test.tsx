// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
const api = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: api.invoke }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ save: vi.fn() }));
import LibraryBrowser from "./LibraryBrowser";
import type { LibraryDocument } from "./library";
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
function renderLibrary(
  refresh: () => Promise<void>,
  documents: LibraryDocument[] = [],
) {
  const onProject = vi.fn(),
    onError = vi.fn(),
    onMutationBusy = vi.fn();
  render(
    <LibraryBrowser
      compact
      view={{
        projects: [{ id: "s1", title: "旧空间" }],
        documents,
        pendingImports: [],
      }}
      projectId="s1"
      busy={false}
      onProject={onProject}
      onOpen={() => {}}
      onNew={() => {}}
      onImport={() => {}}
      onRefresh={refresh}
      onTrash={async () => {}}
      onBeforeAction={async () => true}
      onError={onError}
      onMutationBusy={onMutationBusy}
    />,
  );
  return { onProject, onError, onMutationBusy };
}
test("space creation is single flight and stays guarded until its list refresh completes", async () => {
  let commit!: (v: unknown) => void, refresh!: () => void;
  const creation = new Promise((r) => {
    commit = r;
  });
  api.invoke.mockImplementation((name: string) =>
    name === "library_create_project"
      ? creation
      : Promise.resolve({
          version: 1,
          sort: "nameAsc",
          pinnedCollapsed: false,
        }),
  );
  const props = renderLibrary(
    () =>
      new Promise((r) => {
        refresh = r;
      }),
  );
  fireEvent.click(screen.getByRole("button", { name: "新建空间" }));
  fireEvent.change(screen.getByLabelText("空间名称"), {
    target: { value: "新空间" },
  });
  const form = screen.getByLabelText("空间名称").closest("form")!;
  fireEvent.submit(form);
  fireEvent.submit(form);
  await waitFor(() =>
    expect(
      api.invoke.mock.calls.filter(
        ([name]) => name === "library_create_project",
      ),
    ).toHaveLength(1),
  );
  await act(async () => commit({ id: "s2" }));
  expect(props.onMutationBusy.mock.calls).toEqual([[true]]);
  expect(screen.queryByLabelText("空间名称")).toBeNull();
  await act(async () => refresh());
  await waitFor(() => expect(props.onProject).toHaveBeenCalledWith("s2", true));
  expect(api.invoke).toHaveBeenCalledWith("library_create_project", {
    title: "新空间",
  });
});
test("a failed refresh after a committed space never leaves a repeatable create form", async () => {
  api.invoke.mockImplementation(async (name: string) =>
    name === "library_create_project"
      ? { id: "s2" }
      : { version: 1, sort: "nameAsc", pinnedCollapsed: false },
  );
  const props = renderLibrary(async () => {
    throw Error("刷新中断");
  });
  fireEvent.click(screen.getByRole("button", { name: "新建空间" }));
  fireEvent.change(screen.getByLabelText("空间名称"), {
    target: { value: "新空间" },
  });
  fireEvent.submit(screen.getByLabelText("空间名称").closest("form")!);
  await waitFor(() => expect(props.onError).toHaveBeenCalled());
  expect(String(props.onError.mock.calls[0][0])).toContain("空间已保存");
  expect(screen.queryByLabelText("空间名称")).toBeNull();
  expect(
    api.invoke.mock.calls.filter(([name]) => name === "library_create_project"),
  ).toHaveLength(1);
});

test("the workbench scopes recent documents, pinning and type views without repeating sidebar controls", async () => {
  const make = (id: string, path: string, projectId = "s1") => ({
    id,
    path,
    title: path,
    projectId,
    source: "",
    updated: 1,
    opened: 1,
    status: "ready" as const,
  });
  const pin = vi.fn().mockResolvedValue(undefined);
  render(
    <LibraryBrowser
      view={{
        projects: [
          { id: "s1", title: "研究" },
          { id: "s2", title: "私人" },
        ],
        documents: [
          make("m", "guide.md"),
          make("j", "report.json"),
          make("x", "other.md", "s2"),
        ],
        pendingImports: [],
      }}
      projectId="s1"
      pins={["m"]}
      onPin={pin}
      busy={false}
      onProject={() => {}}
      onOpen={() => {}}
      onNew={() => {}}
      onImport={() => {}}
      onRefresh={async () => {}}
      onTrash={async () => {}}
      onBeforeAction={async () => true}
      onError={() => {}}
    />,
  );
  expect(screen.queryByText("other.md")).toBeNull();
  expect(screen.queryByLabelText("文档空间")).toBeNull();
  expect(screen.queryByPlaceholderText("查找文档标题…")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "置顶" }));
  expect(screen.queryByText("report.json")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "文档操作 guide.md" }));
  fireEvent.click(screen.getByRole("menuitem", { name: "取消置顶" }));
  await waitFor(() => expect(pin).toHaveBeenCalledWith("m", false));
  fireEvent.click(screen.getByRole("button", { name: "全部资料" }));
  fireEvent.click(screen.getByRole("button", { name: "JSON" }));
  expect(screen.queryByText("guide.md")).toBeNull();
  expect(screen.getByText("report.json")).toBeTruthy();
});

test("document actions dismiss on the first outside click or key without stealing the new focus or clearing a rename", async () => {
  const doc = (id: string) => ({
    id,
    title: id + ".md",
    path: id + ".md",
    projectId: "s1",
    status: "ready" as const,
    source: "",
    updated: 1,
    opened: 1,
  });
  renderLibrary(async () => {}, [doc("one"), doc("two")]);
  const one = screen.getByRole("button", { name: "文档操作 one.md" });
  const two = screen.getByRole("button", { name: "文档操作 two.md" });
  const search = screen.getByRole("textbox", { name: "查找文档" });
  fireEvent.click(one);
  expect(screen.getByRole("menu")).toBeTruthy();
  fireEvent.pointerMove(search);
  expect(screen.getByRole("menu")).toBeTruthy();
  fireEvent.pointerDown(search);
  expect(screen.queryByRole("menu")).toBeNull();
  act(() => search.focus());
  fireEvent.click(search);
  fireEvent.change(search, { target: { value: "o" } });
  expect(document.activeElement).toBe(search);
  fireEvent.click(one);
  fireEvent.pointerDown(two);
  fireEvent.click(two);
  expect(screen.getByRole("menu", { name: "two.md的操作" })).toBeTruthy();
  expect(one.getAttribute("aria-expanded")).toBe("false");
  const rename = screen.getByRole("menuitem", { name: "重命名标题" });
  expect(document.activeElement).toBe(rename);
  fireEvent.keyDown(rename, { key: "ArrowUp" });
  expect(document.activeElement?.textContent).toBe("移到回收站");
  fireEvent.keyDown(document.activeElement!, {
    key: "Escape",
    isComposing: true,
  });
  expect(screen.getByRole("menu")).toBeTruthy();
  fireEvent.keyDown(document.activeElement!, { key: "Escape" });
  expect(screen.queryByRole("menu")).toBeNull();
  expect(document.activeElement).toBe(two);
  fireEvent.keyDown(two, { key: "ArrowUp" });
  fireEvent.click(screen.getByRole("menuitem", { name: "重命名标题" }));
  const draft = screen.getByRole("textbox", { name: "新文档标题" });
  expect(document.activeElement).toBe(draft);
  fireEvent.change(draft, { target: { value: "草稿" } });
  fireEvent.pointerDown(search);
  expect((draft as HTMLInputElement).value).toBe("草稿");
});

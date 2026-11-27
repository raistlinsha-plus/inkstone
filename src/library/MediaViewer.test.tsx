// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import MediaViewer from "./MediaViewer";
import DirectImagePreview from "./DirectImagePreview";
import { FolderTree } from "./Organization";
import { selectDocuments } from "./selectors";
import type { LibraryDocument } from "../library";
const request = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke: request }));
afterEach(() => {
  cleanup();
  request.mockReset();
});
const doc = (name: string): LibraryDocument => ({
  id: name,
  title: name,
  path: "documents/id/" + name,
  source: "",
  updated: 0,
  opened: 0,
  projectId: "inbox",
  status: "ready",
});
test("browse only images and attach a visual description after explicit confirmation", async () => {
  const first = doc("A.heic.md"),
    second = doc("B.png.md"),
    note = doc("note.md"),
    map = doc("Ideas.mindmap.md");
  const documents = [second, note, map, first];
  expect(
    selectDocuments(documents, "inbox", "all", "nameAsc", "", [], "image"),
  ).toEqual([first, second]);
  expect(
    selectDocuments(documents, "inbox", "all", "nameAsc", "", [], "md"),
  ).toEqual([note]);
  const open = vi.fn(),
    append = vi.fn();
  request.mockImplementation(async (cmd) =>
    cmd === "resolve_image" ? "data:image/jpeg;base64,/9j/" : "会议白板",
  );
  render(
    <MediaViewer
      path={first.path}
      content="## 图中文字\n本周计划"
      documents={documents}
      open={open}
      append={append}
    />,
  );
  await screen.findByRole("img", { name: "A.heic" });
  fireEvent.click(screen.getByRole("button", { name: "下一张" }));
  expect(open).toHaveBeenCalledWith(second);
  expect(request).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "分析图片" }));
  fireEvent.click(screen.getByRole("button", { name: "发送图片" }));
  await screen.findByText("会议白板");
  expect(append).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "保存描述并用于检索" }));
  expect(append).toHaveBeenCalledWith(expect.stringContaining("会议白板"));
});
test("collapse a folder hides its documents and descendants without hiding root files", () => {
  render(
    <FolderTree
      folders={["年度", "年度/研究"]}
      selected=""
      onSelect={() => {}}
      renderFiles={(path) => <span>{path || "根"}的资料</span>}
    />,
  );
  expect(screen.getByText("年度/研究的资料")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "年度", expanded: true }));
  expect(screen.queryByText("年度/研究的资料")).toBeNull();
  expect(screen.getByText("根的资料")).toBeTruthy();
});

test("adding an existing photo opens its saved location and never moves it to the target folder", async () => {
  const saved = doc("Board.heic.md");
  const onOpen = vi.fn();
  const onImport = vi.fn(async () => {
    throw new Error("刷新失败");
  });
  request.mockImplementation(async (cmd) => {
    if (cmd === "media_preview") return "data:image/jpeg;base64,/9j/";
    if (cmd === "media_import")
      return { document: saved, existing: true, actualFolder: "资料/白板" };
    throw new Error("unexpected mutation: " + cmd);
  });
  render(
    <DirectImagePreview
      files={["/board.heic"]}
      projectId="inbox"
      projectTitle="我的文档"
      folder="工作/年度"
      locations={{ [saved.id]: "旧位置" }}
      onOpen={onOpen}
      onImport={onImport}
      onClose={vi.fn()}
    />,
  );
  await screen.findByRole("img", { name: "board.heic" });
  fireEvent.click(screen.getByRole("button", { name: "加入当前空间" }));
  const existing = await screen.findByRole("button", { name: "打开已有图片" });
  expect(screen.getByRole("status").textContent).toContain("资料/白板");
  expect((await screen.findByRole("alert")).textContent).toContain("刷新失败");
  fireEvent.click(existing);
  expect(onOpen).toHaveBeenCalledWith(saved);
  expect(onImport).toHaveBeenCalledOnce();
  expect(request.mock.calls.map(([name]) => name)).toEqual([
    "media_preview",
    "media_import",
  ]);
});

test("an indexing warning keeps a newly saved photo openable without importing it twice", async () => {
  const document = doc("Board.png.md");
  const open = vi.fn();
  request.mockImplementation(async (cmd) =>
    cmd === "media_preview"
      ? "preview.jpg"
      : {
          document,
          existing: false,
          actualFolder: "A",
          warning: "图片已保存，本地索引待更新。",
        },
  );
  render(
    <DirectImagePreview
      files={["/board.png"]}
      projectId="inbox"
      projectTitle="资料"
      folder="A"
      locations={{}}
      onClose={() => {}}
      onOpen={open}
      onImport={async () => {}}
    />,
  );
  await screen.findByRole("img", { name: "board.png" });
  fireEvent.click(screen.getByRole("button", { name: "加入当前空间" }));
  await screen.findByText("图片已保存，本地索引待更新。");
  const added = screen.getByRole("button", {
    name: "已加入空间",
  }) as HTMLButtonElement;
  expect(added.disabled).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "打开图片" }));
  expect(open).toHaveBeenCalledWith(document);
  expect(request).toHaveBeenCalledTimes(2);
});

test("a pending result stays with its own image across navigation and a failed save can be retried", async () => {
  const a = doc("Chart A.png.md"),
    b = doc("Chart B.png.md");
  let resolveResult!: (answer: string) => void;
  request.mockImplementation((cmd) =>
    cmd === "media_describe"
      ? new Promise<string>((resolve) => {
          resolveResult = resolve;
        })
      : Promise.resolve("data:image/jpeg;base64,/9j/"),
  );
  const append = vi
    .fn()
    .mockRejectedValueOnce(new Error("磁盘忙"))
    .mockResolvedValueOnce(undefined);
  const view = (item: LibraryDocument) => (
    <MediaViewer
      key={item.path}
      path={item.path}
      content={"## 图中文字\n本地图表"}
      documents={[a, b]}
      open={vi.fn()}
      append={append}
    />
  );
  const { rerender } = render(view(a));
  await screen.findByRole("img", { name: "Chart A.png" });
  fireEvent.click(screen.getByRole("button", { name: "分析图片" }));
  fireEvent.change(screen.getByRole("textbox", { name: "问题" }), {
    target: { value: "增长了多少？" },
  });
  fireEvent.click(screen.getByRole("button", { name: "发送图片" }));
  rerender(view(b));
  await screen.findByRole("img", { name: "Chart B.png" });
  resolveResult("增长了两成");
  fireEvent.click(screen.getByRole("button", { name: "查看文字" }));
  expect(screen.queryByText("增长了两成")).toBeNull();
  rerender(view(a));
  await screen.findByText("增长了两成");
  expect(
    (screen.getByRole("textbox", { name: "问题" }) as HTMLTextAreaElement)
      .value,
  ).toBe("增长了多少？");
  fireEvent.click(screen.getByRole("button", { name: "保存描述并用于检索" }));
  expect((await screen.findByRole("alert")).textContent).toContain("磁盘忙");
  fireEvent.click(screen.getByRole("button", { name: "保存描述并用于检索" }));
  await screen.findByText("本地图表");
  expect(append).toHaveBeenCalledTimes(2);
});

test("single images omit navigation and citations expose OCR and saved descriptions separately", async () => {
  request.mockResolvedValue("data:image/jpeg;base64,/9j/");
  const file = doc("Travel.heif.md");
  render(
    <MediaViewer
      path={file.path}
      documents={[file]}
      content={"## 图中文字\n原文\n\n## Model description\n\n保存的描述"}
      citationLine={6}
      open={vi.fn()}
      append={vi.fn()}
    />,
  );
  await screen.findByRole("img", { name: "Travel.heif" });
  expect(screen.queryByRole("button", { name: "上一张" })).toBeNull();
  expect(screen.getByText("原文")).toBeTruthy();
  expect(screen.getByText("保存的描述")).toBeTruthy();
  expect(request.mock.calls.map((c) => c[0])).toEqual(["resolve_image"]);
});

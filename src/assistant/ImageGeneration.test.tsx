// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  render,
  fireEvent,
  screen,
  waitFor,
  cleanup,
} from "@testing-library/react";
import ImageGeneration from "./ImageGeneration";
import { invoke } from "@tauri-apps/api/core";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const config = {
  model: "gpt-image-test",
  useChatKey: false,
  baseUrl: "https://images.invalid/v1",
};
const setup = () => {
  const close = vi.fn();
  const props = {
    projects: [
      { id: "inbox", title: "我的文档" },
      { id: "archive", title: "Old", archived: true },
    ],
    projectId: "inbox",
    onRefresh: vi.fn(async () => {}),
    onOpen: vi.fn(),
    onClose: close,
  };
  const view = render(<ImageGeneration {...props} />);
  return { ...props, ...view };
};
beforeEach(() => {
  vi.mocked(invoke).mockImplementation(async (command) => {
    if (command === "image_generation_settings")
      return { config, chatEnabled: false, chatBaseUrl: "", hasKey: true };
    if (command === "library_layout")
      return { folders: ["Design"], locations: {} };
    if (command === "image_generation_preview")
      return "data:image/png;base64,AA";
    if (command === "image_generation_save")
      return {
        document: { id: "asset", title: "海报.png.md" },
        actualFolder: "Design",
        existing: false,
      };
    if (command === "image_generation_cancel") return;
    throw Error(String(command));
  });
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
it("shows a preview before saving and opens the saved resource", async () => {
  const view = setup();
  fireEvent.change(screen.getByLabelText("图片描述"), {
    target: { value: "阅读节海报" },
  });
  await screen.findByText("gpt-image-test");
  fireEvent.click(screen.getByRole("button", { name: "生成预览" }));
  await screen.findByRole("img", { name: "阅读节海报" });
  expect(
    vi.mocked(invoke).mock.calls.some(([op]) => op === "image_generation_save"),
  ).toBe(false);
  expect(screen.queryByText("Old")).toBeNull();
  fireEvent.change(screen.getByLabelText("图片名称"), {
    target: { value: "海报" },
  });
  fireEvent.change(screen.getByLabelText("文件夹"), {
    target: { value: "Design" },
  });
  fireEvent.click(screen.getByRole("button", { name: "保存到空间" }));
  const open = await screen.findByRole("button", { name: "打开图片" });
  expect(invoke).toHaveBeenCalledWith("image_generation_save", {
    projectId: "inbox",
    folder: "Design",
    title: "海报",
    preview: "data:image/png;base64,AA",
  });
  fireEvent.click(open);
  expect(view.onOpen).toHaveBeenCalledWith({
    id: "asset",
    title: "海报.png.md",
  });
});
it("cancels a running generation when the user dismisses the dialog", async () => {
  const original = vi.mocked(invoke).getMockImplementation()!;
  vi.mocked(invoke).mockImplementation((command, ...args) =>
    command === "image_generation_preview"
      ? new Promise(() => {})
      : original(command, ...args),
  );
  const view = setup();
  fireEvent.change(screen.getByLabelText("图片描述"), {
    target: { value: "A lantern" },
  });
  await screen.findByText("gpt-image-test");
  fireEvent.click(screen.getByRole("button", { name: "生成预览" }));
  await screen.findByText("正在生成…");
  fireEvent.click(screen.getByRole("button", { name: "取消" }));
  expect(view.onClose).toHaveBeenCalledOnce();
  view.unmount();
  await waitFor(() =>
    expect(invoke).toHaveBeenCalledWith("image_generation_cancel", {
      requestId: expect.any(String),
    }),
  );
  expect(
    vi.mocked(invoke).mock.calls.some(([op]) => op === "image_generation_save"),
  ).toBe(false);
});

async function makePreview() {
  fireEvent.change(screen.getByLabelText("图片描述"), {
    target: { value: "Lamp" },
  });
  await screen.findByText("gpt-image-test");
  fireEvent.click(screen.getByRole("button", { name: "生成预览" }));
  await screen.findByRole("img", { name: "Lamp" });
}
it("retries a failed destination lookup without generating or saving again", async () => {
  const original = vi.mocked(invoke).getMockImplementation()!;
  let failLayout = true;
  vi.mocked(invoke).mockImplementation((command, ...args) => {
    if (command === "library_layout" && failLayout)
      return Promise.reject(Error("offline folder"));
    return original(command, ...args);
  });
  setup();
  await makePreview();
  expect(screen.getByRole("alert").textContent).toContain("offline folder");
  expect(
    (screen.getByRole("button", { name: "保存到空间" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  failLayout = false;
  fireEvent.click(screen.getByRole("button", { name: "重试目录" }));
  await screen.findByRole("option", { name: "Design" });
  expect(screen.getByRole("img", { name: "Lamp" })).toBeTruthy();
  expect(
    (screen.getByRole("button", { name: "保存到空间" }) as HTMLButtonElement)
      .disabled,
  ).toBe(false);
  expect(vi.mocked(invoke).mock.calls.map(([op]) => op)).toEqual([
    "image_generation_settings",
    "library_layout",
    "image_generation_preview",
    "library_layout",
  ]);
});
it.each(["Escape", "backdrop", "close", "cancel"])(
  "guards an unsaved preview on %s",
  async (action) => {
    const view = setup();
    await makePreview();
    function dismiss() {
      if (action === "Escape") fireEvent.keyDown(document, { key: "Escape" });
      else if (action === "backdrop")
        fireEvent.mouseDown(
          screen.getByRole("dialog").closest(".modal-backdrop")!,
        );
      else
        fireEvent.click(
          screen.getByRole("button", {
            name: action === "close" ? "关闭" : "取消",
          }),
        );
    }
    dismiss();
    const keep = screen.getByRole("button", { name: "继续编辑" });
    expect(document.activeElement).toBe(keep);
    fireEvent.click(keep);
    expect(screen.getByRole("img", { name: "Lamp" })).toBeTruthy();
    dismiss();
    expect(view.onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "放弃预览" }));
    expect(view.onClose).toHaveBeenCalledOnce();
  },
);
it("keeps the previous preview on canceling or failing a paid replacement", async () => {
  setup();
  await makePreview();
  fireEvent.click(screen.getByRole("button", { name: "修改描述" }));
  fireEvent.change(screen.getByLabelText("图片描述"), {
    target: { value: "Blue lamp" },
  });
  fireEvent.click(screen.getByRole("button", { name: "生成预览" }));
  fireEvent.click(screen.getByRole("button", { name: "继续编辑" }));
  expect(
    vi
      .mocked(invoke)
      .mock.calls.filter(([op]) => op === "image_generation_preview"),
  ).toHaveLength(1);
  vi.mocked(invoke).mockRejectedValueOnce(Error("busy"));
  fireEvent.click(screen.getByRole("button", { name: "生成预览" }));
  fireEvent.click(screen.getByRole("button", { name: "重新生成" }));
  await screen.findByRole("alert");
  fireEvent.click(screen.getByRole("button", { name: "返回预览" }));
  expect(screen.getByRole("img", { name: "Lamp" })).toBeTruthy();
  expect((screen.getByLabelText("图片名称") as HTMLInputElement).value).toBe(
    "Lamp",
  );
});

it("displays the actual space root when an existing image is found there", async () => {
  setup();
  await makePreview();
  fireEvent.change(screen.getByLabelText("文件夹"), {
    target: { value: "Design" },
  });
  vi.mocked(invoke).mockResolvedValueOnce({
    document: { id: "asset", title: "Lamp.png.md" },
    actualFolder: null,
    existing: true,
  });
  fireEvent.click(screen.getByRole("button", { name: "保存到空间" }));
  const status = await screen.findByRole("status");
  expect(status.textContent).toContain("我的文档");
  expect(status.textContent).not.toContain("Design");
});

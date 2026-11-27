// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { ChatImagePicker, ConfirmChatImage } from "./ChatImagePicker";
import QuestionSources from "./QuestionSources";
import type { LibraryDocument } from "../library";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
afterEach(() => {
  cleanup();
  invoke.mockReset();
});
const photo: LibraryDocument = {
  id: "photo",
  path: "files/board.heic.md",
  title: "board.heic.md",
  projectId: "work",
  source: "managed",
  updated: 0,
  opened: 0,
  status: "ready",
};
const note: LibraryDocument = {
  ...photo,
  id: "note",
  title: "notes.md",
  path: "files/notes.md",
};
const preview = {
  hash: "digest",
  url: "data:image/jpeg;base64,/9j/",
  hasOcr: true,
  hasDescription: false,
};

test("an existing selected note and an image share one turn and only selected local pixels are previewed", async () => {
  invoke.mockResolvedValue(preview);
  const change = vi.fn();
  render(
    <QuestionSources
      view={{
        projects: [
          { id: "work", title: "Work" },
          { id: "personal", title: "Personal" },
        ],
        documents: [
          note,
          photo,
          {
            ...photo,
            id: "other",
            projectId: "personal",
            title: "other.png.md",
          },
        ],
        pendingImports: [],
      }}
      currentProjectId="work"
      selected={{ projectId: "work", documentIds: ["note"] }}
      disabled={false}
      onChange={change}
      onBusy={vi.fn()}
      ensureConversation={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "添加资料" }));
  fireEvent.click(screen.getByRole("button", { name: "从空间选图" }));
  await screen.findByAltText("board.heic");
  expect(screen.queryByRole("button", { name: /other.png/ })).toBeNull();
  expect(
    (screen.getByRole("radio", { name: "已保存的描述" }) as HTMLInputElement)
      .disabled,
  ).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "加入本轮" }));
  expect(change).toHaveBeenCalledWith({
    projectId: "work",
    documentIds: ["note", "photo"],
    image: { documentId: "photo", mode: "ocr" },
  });
  expect(invoke.mock.calls).toEqual([
    ["assistant_image_preview", { projectId: "work", documentId: "photo" }],
  ]);
});

test("a visual request can be cancelled and confirms the model and exact displayed preview", async () => {
  invoke.mockResolvedValue(preview);
  const close = vi.fn(),
    confirm = vi.fn();
  render(
    <ConfirmChatImage
      photo={photo}
      defaultModel="model-a"
      endpoint="https://fixture.invalid/v1"
      onClose={close}
      onConfirm={confirm}
    />,
  );
  expect(screen.getByText("https://fixture.invalid/v1")).toBeTruthy();
  await screen.findByAltText("board.heic");
  fireEvent.click(screen.getByRole("button", { name: "取消" }));
  expect(close).toHaveBeenCalledOnce();
  expect(confirm).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("视觉模型"), {
    target: { value: "model-b" },
  });
  fireEvent.click(screen.getByRole("button", { name: "发送图片" }));
  expect(confirm).toHaveBeenCalledWith("model-b", "digest");
});

test("unavailable previews and empty image folders cannot send", async () => {
  invoke.mockRejectedValue(new Error("unavailable"));
  const pick = vi.fn();
  const { rerender } = render(
    <ChatImagePicker
      docs={[photo]}
      space="Work"
      onPick={pick}
      onClose={vi.fn()}
    />,
  );
  await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
  expect(
    (screen.getByRole("button", { name: "加入本轮" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  rerender(
    <ChatImagePicker docs={[]} space="Work" onPick={pick} onClose={vi.fn()} />,
  );
  expect(screen.getByText(/这个空间还没有图片/)).toBeTruthy();
});

test("Escape from the image picker returns to its composer button and sends nothing", async () => {
  invoke.mockResolvedValue(preview);
  const change = vi.fn();
  render(
    <QuestionSources
      view={{
        projects: [{ id: "work", title: "Work" }],
        documents: [photo],
        pendingImports: [],
      }}
      currentProjectId="work"
      selected={{}}
      disabled={false}
      onChange={change}
      onBusy={vi.fn()}
      ensureConversation={vi.fn()}
    />,
  );
  const trigger = screen.getByRole("button", { name: "添加图片" });
  trigger.focus();
  fireEvent.click(trigger);
  await screen.findByAltText("board.heic");
  fireEvent.keyDown(screen.getByRole("searchbox", { name: "查找图片" }), {
    key: "Escape",
  });
  await waitFor(() => expect(document.activeElement).toBe(trigger));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(change).not.toHaveBeenCalled();
  expect(invoke.mock.calls.map(([command]) => command)).toEqual([
    "assistant_image_preview",
  ]);
});

test("a missing JPEG leaves local OCR and saved descriptions selectable", async () => {
  invoke.mockResolvedValue({
    url: "",
    hash: "",
    hasOcr: true,
    hasDescription: true,
    previewError: "missing",
  });
  const pick = vi.fn();
  render(
    <ChatImagePicker
      docs={[photo]}
      space="Work"
      onPick={pick}
      onClose={vi.fn()}
    />,
  );
  await screen.findByText("JPEG 预览不可用");
  expect(
    (screen.getByRole("radio", { name: "图片预览" }) as HTMLInputElement)
      .disabled,
  ).toBe(true);
  for (const [name, mode] of [
    ["图中文字（OCR）", "ocr"],
    ["已保存的描述", "description"],
  ]) {
    fireEvent.click(screen.getByRole("radio", { name }));
    fireEvent.click(screen.getByRole("button", { name: "加入本轮" }));
    expect(pick).toHaveBeenCalledWith({ documentId: photo.id, mode });
  }
});

test("a displayed JPEG cannot be sent without a visible destination", async () => {
  invoke.mockResolvedValue(preview);
  const confirm = vi.fn();
  render(
    <ConfirmChatImage
      photo={photo}
      endpoint=""
      defaultModel="fixture"
      onClose={vi.fn()}
      onConfirm={confirm}
    />,
  );
  await screen.findByAltText("board.heic");
  const send = screen.getByRole("button", {
    name: "发送图片",
  }) as HTMLButtonElement;
  expect(send.disabled).toBe(true);
  fireEvent.click(send);
  expect(confirm).not.toHaveBeenCalled();
});

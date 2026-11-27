// @vitest-environment jsdom
import { webcrypto } from "node:crypto";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import ChatTaskDialog from "./ChatTaskDialog";
import vectors from "../../evals/v1.2/task-origin-id.json";
import { actionId, choice } from "./chatActions";
import { setLanguagePreference } from "../i18n";
import { scanTrackedTasks } from "../content/tasks";
import type { LibraryView } from "../library";

const ipc = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke: ipc }));
const library: LibraryView = {
  projects: [
    { id: "a", title: "工作" },
    { id: "b", title: "家庭" },
  ],
  documents: [
    {
      projectId: "a",
      id: "guide",
      source: "local",
      path: "guide.md",
      title: "手册",
      status: "ready",
      updated: 1,
      opened: 1,
    },
    {
      projectId: "b",
      id: "plan",
      source: "local",
      path: "plan.md",
      title: "计划",
      status: "ready",
      updated: 1,
      opened: 1,
    },
  ],
  pendingImports: [],
};
const source = {
  conversationId: "session",
  turnId: "turn",
  candidateId: "answer",
  general: true,
};
const text = "🙂 Write a guide. Then send a draft.";
beforeEach(() => {
  setLanguagePreference("en");
  vi.stubGlobal("crypto", webcrypto);
  ipc.mockReset();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  setLanguagePreference("zh-CN");
});
test("general chat requires an explicit destination and selection before a single CAS save", async () => {
  ipc.mockImplementation(async (cmd: string) => {
    if (cmd === "task_document")
      return {
        path: "plan.md",
        hash: "rev",
        content: "# Draft\r\n",
        missing: false,
        draft: null,
      };
    if (cmd === "task_extract")
      return [
        { quote: "Write a guide.", title: "Write a guide" },
        { quote: "send a draft.", title: "Send a draft" },
      ];
    if (cmd === "task_save_from_chat")
      return { hash: "next", indexStale: true };
    throw Error(cmd);
  });
  const onSaved = vi.fn(),
    onClose = vi.fn();
  render(
    <ChatTaskDialog
      message={{ text, source }}
      library={library}
      currentProject="a"
      onClose={onClose}
      beforeSave={() => {}}
      onSaved={onSaved}
    />,
  );
  fireEvent.click(screen.getByText("Extract with chat model"));
  await screen.findByText("Write a guide.");
  const save = screen.getByRole("button", { name: /Save to note/ });
  expect((save as HTMLButtonElement).disabled).toBe(true);
  expect(ipc.mock.calls.some(([cmd]) => cmd === "task_save_from_chat")).toBe(
    false,
  );
  fireEvent.change(screen.getByLabelText("Destination space"), {
    target: { value: "b" },
  });
  fireEvent.change(screen.getByLabelText("Destination Markdown note"), {
    target: { value: "plan" },
  });
  fireEvent.click(screen.getByLabelText("Write a guide."));
  await waitFor(() => expect((save as HTMLButtonElement).disabled).toBe(false));
  fireEvent.change(screen.getAllByLabelText("Task title")[0], {
    target: { value: "Publish the handbook" },
  });
  fireEvent.click(save);
  await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  const saves = ipc.mock.calls.filter(([cmd]) => cmd === "task_save_from_chat");
  expect(saves).toHaveLength(1);
  const args = saves[0][1];
  expect(args).toMatchObject({
    projectId: "b",
    documentId: "plan",
    expectedHash: "rev",
    quotes: [{ startChar: 2, quote: "Write a guide." }],
  });
  expect(scanTrackedTasks(args.content).map((task) => task.title)).toEqual([
    "Publish the handbook",
  ]);
  expect(args.content).not.toContain(source.conversationId);
  expect(onSaved).toHaveBeenCalledTimes(1);
});
test("manual selection needs no provider and durable retry id follows the passage and target", async () => {
  const row = choice(text, text.indexOf("Write"), text.indexOf(" Then"))!;
  expect(row.startChar).toBe(2);
  expect(await actionId(source, "guide", row)).toBe(
    await actionId(source, "guide", { ...row, title: "Another title" }),
  );
  expect(await actionId(source, "plan", row)).not.toBe(
    await actionId(source, "guide", row),
  );
  ipc.mockResolvedValue({
    path: "guide.md",
    hash: "r1",
    content: "# Draft",
    draft: { content: "pending" },
    missing: false,
  });
  render(
    <ChatTaskDialog
      message={{
        text,
        source: { ...source, general: false },
        selection: "Write a guide.",
      }}
      library={library}
      currentProject="a"
      currentPath="guide.md"
      onClose={() => {}}
      beforeSave={() => {}}
      onSaved={() => {}}
    />,
  );
  expect((await screen.findByRole("alert")).textContent).toContain(
    "pending edits",
  );
  expect(
    (screen.getByRole("button", { name: /Save to note/ }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  expect(ipc.mock.calls.map(([cmd]) => cmd)).toEqual(["task_document"]);
});

test("stopping extraction cancels only its request and discards a late suggestion", async () => {
  let finish!: (value: unknown) => void;
  ipc.mockImplementation(async (cmd: string) => {
    if (cmd === "task_extract")
      return new Promise((resolve) => {
        finish = resolve;
      });
    if (cmd === "cancel_chat") return;
    throw Error(cmd);
  });
  render(
    <ChatTaskDialog
      message={{ text, source, question: "Send the note." }}
      library={library}
      currentProject="a"
      onClose={() => {}}
      beforeSave={() => {}}
      onSaved={() => {}}
    />,
  );
  fireEvent.click(screen.getByLabelText("Include my question in extraction"));
  fireEvent.click(screen.getByText("Extract with chat model"));
  const args = ipc.mock.calls.find(([cmd]) => cmd === "task_extract")![1];
  expect(args.includeQuestion).toBe(true);
  fireEvent.click(await screen.findByText("Stop extraction"));
  expect(ipc).toHaveBeenCalledWith("cancel_chat", {
    requestId: args.requestId,
  });
  finish([{ role: "user", title: "Send", quote: "Send the note." }]);
  await waitFor(() => expect(screen.queryByText("Stop extraction")).toBeNull());
  expect(screen.queryByLabelText("Task title")).toBeNull();
  expect(screen.getByRole("status").textContent).toContain("stopped");
});

test("shares persistent action identities with the Rust verifier, including escaped text and a user quote inside an answer", async () => {
  for (const v of vectors) {
    const source = {
      conversationId: v.conversationId,
      turnId: v.turnId,
      candidateId: v.candidateId,
      general: false,
    };
    const row = {
      fromQuestion: v.fromQuestion,
      quote: v.quote,
      startChar: v.startChar,
      title: "Edited title",
      due: "",
      selected: true,
    };
    expect(await actionId(source, v.documentId, row)).toBe(v.expectedId);
  }
});

test("an asset-only active space can create its shared task list only after confirmation", async () => {
  const photo = {
    ...library.documents[0],
    id: "photo",
    path: "image.HEIC 副本2.md",
    title: "Photo",
  };
  const map = { ...photo, id: "map", path: "outline.mindmap.md", title: "Map" };
  const picked = { ...source, general: true };
  const onSaved = vi.fn();
  ipc.mockImplementation(async (cmd) => {
    if (cmd === "task_prepare_chat_note")
      return {
        id: "list",
        data: {
          content: "# Tasks\n",
          hash: "r1",
          path: "Tasks.md",
          missing: false,
        },
      };
    if (cmd === "task_save_from_chat") return { hash: "r2", indexStale: true };
    throw Error(cmd);
  });
  render(
    <ChatTaskDialog
      library={{
        ...library,
        projects: [
          library.projects[0],
          { ...library.projects[1], archived: true },
        ],
        documents: [photo, map, { ...library.documents[0], status: "trashed" }],
      }}
      message={{ text, source: picked, selection: "Write a guide." }}
      currentProject="a"
      currentPath={photo.path}
      onClose={vi.fn()}
      beforeSave={vi.fn()}
      onSaved={onSaved}
    />,
  );
  expect(screen.queryByRole("option", { name: "家庭" })).toBeNull();
  const save = screen.getByRole<HTMLButtonElement>("button", {
    name: /Save to note/,
  });
  expect(save.disabled).toBe(true);
  fireEvent.change(screen.getByLabelText("Destination space"), {
    target: { value: "a" },
  });
  expect(
    screen.getByRole("option", { name: /Task list.*created on save/ }),
  ).toBeTruthy();
  for (const name of ["Photo", "Map", "手册"])
    expect(screen.queryByRole("option", { name })).toBeNull();
  expect(ipc).not.toHaveBeenCalled();
  fireEvent.click(save);
  await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
  expect(ipc.mock.calls.map(([cmd]) => cmd)).toEqual([
    "task_prepare_chat_note",
    "task_save_from_chat",
  ]);
  expect(onSaved.mock.calls[0][0].taskIds).toEqual([
    ipc.mock.calls[1][1].quotes[0].taskId,
  ]);
  expect(ipc.mock.calls[0][1]).toEqual({
    projectId: "a",
    title: "Tasks.md",
    source: picked,
  });
  expect(ipc.mock.calls[1][1]).toMatchObject({
    documentId: "list",
    expectedHash: "r1",
  });
});

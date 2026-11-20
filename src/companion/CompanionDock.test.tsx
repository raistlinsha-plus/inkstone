// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import CompanionDock from "./CompanionDock";
import type { Snapshot } from "./types";
const mocked = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocked.invoke }));
const workspace = {
  root: "/synthetic/space",
  name: "合成空间",
  managedProjectId: "space-1",
  files: [],
  stats: { documents: 1, chunks: 1, vectors: 0, embeddingReady: false },
};
const base = (): Snapshot => ({
  generation: "generation-1",
  revision: 1,
  timezone: "Asia/Shanghai",
  settings: {
    enabled: true,
    characterId: "motuan",
    mode: "focus",
    compact: false,
    reducedMotion: true,
  },
  events: 0,
  days: 0,
  roles: { motuan: { read: [0], choices: {}, outfit: 0 } },
  cards: [],
  preferences: [],
  pending: [],
  eligible: null,
});
let current: Snapshot;
beforeEach(() => {
  current = base();
  mocked.invoke.mockReset();
  mocked.invoke.mockImplementation(
    async (cmd: string, args?: { input?: Record<string, unknown> }) => {
      if (cmd === "companion_state") return structuredClone(current);
      if (cmd === "companion_settings") {
        current = {
          ...current,
          revision: current.revision + 1,
          settings: {
            ...current.settings,
            ...args?.input,
          } as Snapshot["settings"],
        };
        return structuredClone(current);
      }
      if (cmd === "companion_preview")
        return {
          token: "server-token",
          eventId: "server-event",
          suggestedText: "完成一份资料整理",
          day: "2026-11-05",
          canRevise: false,
          expiresAt: 9999999999,
          context: {
            generation: current.generation,
            revision: current.revision,
          },
        };
      throw Error("Unexpected command: " + cmd);
    },
  );
});
afterEach(cleanup);
const mount = (saved = true) =>
  render(
    <CompanionDock
      workspace={workspace}
      documentPath="note.md"
      documentHash="hash"
      saved={saved}
    />,
  );
const sprite = () => document.querySelector("[data-companion-sprite='motuan']");
test("opt-in is explicit and selecting a role does not record work or call a model", async () => {
  current.settings.enabled = false;
  current.roles = {};
  mount();
  fireEvent.click(screen.getByRole("button", { name: "认识同伴" }));
  await screen.findByRole("button", { name: "与墨团相遇" });
  fireEvent.click(screen.getByRole("button", { name: "与墨团相遇" }));
  await screen.findByRole("dialog", { name: "纸页旁的小影子" });
  expect(
    mocked.invoke.mock.calls.every(([name]) =>
      String(name).startsWith("companion_"),
    ),
  ).toBe(true);
  expect(
    mocked.invoke.mock.calls.some(([name]) => name === "companion_confirm"),
  ).toBe(false);
});
test("unsaved work cannot preview a completion", async () => {
  mount(false);
  const button = await screen.findByRole("button", { name: "本次完成" });
  expect((button as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(button);
  expect(
    mocked.invoke.mock.calls.some(([name]) => name === "companion_preview"),
  ).toBe(false);
});
test("preview requires consent and sends server token; a failed write never claims success", async () => {
  mocked.invoke.mockImplementation(async (cmd: string) => {
    if (cmd === "companion_state") return structuredClone(current);
    if (cmd === "companion_preview")
      return {
        token: "server-token",
        eventId: "server-event",
        suggestedText: "完成一份资料整理",
        day: "2026-11-05",
        canRevise: false,
        context: { generation: current.generation, revision: current.revision },
      };
    if (cmd === "companion_confirm")
      throw Error("STORAGE_ERROR：工作已保存，经历待保存");
    throw Error(cmd);
  });
  mount();
  fireEvent.click(await screen.findByRole("button", { name: "本次完成" }));
  const confirm = await screen.findByRole("button", { name: "确认并记录" });
  expect((confirm as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(confirm);
  await screen.findByRole("alert");
  expect(screen.queryByText("经历已记录。新章节会安静留在同伴入口。")).toBe(
    null,
  );
  const call = mocked.invoke.mock.calls.find(
    ([name]) => name === "companion_confirm",
  );
  expect(call?.[1]).toMatchObject({
    workspaceRoot: workspace.root,
    input: { token: "server-token", eventId: "server-event", consent: true },
  });
});
test("a late preview cannot open in a new workspace", async () => {
  let resolve: ((v: unknown) => void) | undefined;
  mocked.invoke.mockImplementation(async (cmd: string) =>
    cmd === "companion_state"
      ? structuredClone(current)
      : new Promise((r) => {
          resolve = r;
        }),
  );
  const ui = mount();
  fireEvent.click(await screen.findByRole("button", { name: "本次完成" }));
  await waitFor(() => expect(resolve).toBeTypeOf("function"));
  ui.rerender(
    <CompanionDock
      workspace={{
        ...workspace,
        root: "/synthetic/other",
        managedProjectId: "space-2",
      }}
      documentPath="other.md"
      documentHash="other"
      saved
    />,
  );
  resolve?.({
    token: "old",
    eventId: "old",
    suggestedText: "旧空间工作",
    context: { generation: "generation-1", revision: 1 },
  });
  await waitFor(() =>
    expect(screen.queryByRole("dialog", { name: "记录本次完成" })).toBe(null),
  );
});
test("closing a chapter does not mark it read", async () => {
  current.eligible = 1;
  current.events = 3;
  current.days = 2;
  mount();
  fireEvent.click(await screen.findByRole("button", { name: "打开新章" }));
  await screen.findByRole("dialog", { name: "捡到一枚书签" });
  fireEvent.click(screen.getByRole("button", { name: "关闭同伴面板" }));
  expect(
    mocked.invoke.mock.calls.some(([name]) => name === "companion_story"),
  ).toBe(false);
});

test("pet status reflects actual work failure without a celebratory line", async () => {
  render(
    <CompanionDock
      workspace={workspace}
      documentPath="note.md"
      documentHash="hash"
      saved
      activity="blocked"
      activityText="模型连接失败，请重试"
    />,
  );
  await screen.findByText("模型连接失败，请重试");
  expect(screen.queryByText("回答已完成，可核对依据")).toBe(null);
  expect(sprite()?.getAttribute("data-state")).toBe("idle");
});

test("Motuan reflects work in a decorative sprite and keeps focus and reduced-motion settings quiet", async () => {
  const props = { workspace, documentPath: "note.md", documentHash: "hash" };
  const ui = render(<CompanionDock {...props} />);
  await waitFor(() =>
    expect(sprite()?.getAttribute("data-state")).toBe("idle"),
  );
  expect(sprite()?.getAttribute("data-motion")).toBe("static");
  expect(sprite()?.getAttribute("aria-hidden")).toBe("true");

  ui.rerender(<CompanionDock {...props} activity="working" />);
  expect(sprite()?.getAttribute("data-state")).toBe("reading");
  expect(
    mocked.invoke.mock.calls.every(([name]) => name === "companion_state"),
  ).toBe(true);

  fireEvent.click(screen.getByRole("button", { name: "同伴设置" }));
  fireEvent.change(screen.getByLabelText("陪伴模式"), {
    target: { value: "gentle" },
  });
  const reduced = screen.getByRole("checkbox", { name: "减少动态效果" });
  await waitFor(() =>
    expect((reduced as HTMLInputElement).disabled).toBe(false),
  );
  expect(sprite()?.getAttribute("data-motion")).toBe("static");
  fireEvent.click(reduced);
  await waitFor(() =>
    expect(sprite()?.getAttribute("data-motion")).toBe("gentle"),
  );
  fireEvent.change(screen.getByLabelText("陪伴模式"), {
    target: { value: "focus" },
  });
  await waitFor(() =>
    expect(sprite()?.getAttribute("data-motion")).toBe("static"),
  );
  fireEvent.click(screen.getByRole("checkbox", { name: /开启角色陪伴/ }));
  await waitFor(() => expect(sprite()).toBe(null));
});

test("Motuan celebrates only a confirmed milestone; ordinary and duplicate completions do not celebrate", async () => {
  const call = mocked.invoke.getMockImplementation()!;
  const confirmResult = vi.fn();
  mocked.invoke.mockImplementation(async (name, args) => {
    if (name === "companion_confirm") {
      return {
        status: await confirmResult(),
        snapshot: structuredClone(current),
      };
    }
    return call(name, args);
  });
  mount();
  const complete = async (kind: "milestone" | "complete") => {
    fireEvent.click(await screen.findByRole("button", { name: "本次完成" }));
    const submit = await screen.findByRole("button", { name: "确认并记录" });
    fireEvent.change(screen.getByLabelText("经历类型"), {
      target: { value: kind },
    });
    fireEvent.click(screen.getByRole("checkbox", { name: /我确认保存/ }));
    fireEvent.click(submit);
  };

  confirmResult.mockResolvedValueOnce("counted");
  await complete("complete");
  await screen.findByText(/经历已记录/);
  expect(sprite()?.getAttribute("data-state")).toBe("idle");

  confirmResult.mockResolvedValueOnce("duplicate");
  await complete("milestone");
  await screen.findByText(/没有重复计入/);
  expect(sprite()?.getAttribute("data-state")).toBe("idle");

  let resolveMilestone!: (status: string) => void;
  confirmResult.mockReturnValueOnce(
    new Promise<string>((resolve) => {
      resolveMilestone = resolve;
    }),
  );
  await complete("milestone");
  expect(sprite()?.getAttribute("data-state")).toBe("idle");
  vi.useFakeTimers();
  try {
    await act(async () => resolveMilestone("counted"));
    expect(sprite()?.getAttribute("data-state")).toBe("milestone");
    act(() => vi.advanceTimersByTime(2600));
    expect(sprite()?.getAttribute("data-state")).toBe("idle");
  } finally {
    vi.useRealTimers();
  }
});

test("Motuan's bonus illustration uses the existing acquaintance unlock and preserves the main story CG", async () => {
  current.eligible = 1;
  current.events = 3;
  current.days = 2;
  const call = mocked.invoke.getMockImplementation()!;
  mocked.invoke.mockImplementation(async (name, args) => {
    if (name === "companion_story") {
      current.roles.motuan = { read: [0, 1], outfit: 1, choices: {} };
      current.eligible = null;
      return structuredClone(current);
    }
    return call(name, args);
  });
  mount();
  fireEvent.click(await screen.findByRole("button", { name: "相册" }));
  const locked = screen.getByRole("button", { name: /墨团 · 纸签下的午后/ });
  expect((locked as HTMLButtonElement).disabled).toBe(true);
  expect(screen.queryByAltText(/圆窗旁打盹/)).toBe(null);
  fireEvent.click(screen.getByRole("button", { name: "关闭同伴面板" }));
  fireEvent.click(screen.getByRole("button", { name: "打开新章" }));
  await screen.findByRole("dialog", { name: "捡到一枚书签" });
  fireEvent.click(screen.getByRole("button", { name: "读完这一章" }));
  fireEvent.click(await screen.findByRole("button", { name: "相册" }));

  const main = screen.getByRole("button", { name: /捡到一枚书签/ });
  expect((main as HTMLButtonElement).disabled).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: /墨团 · 纸签下的午后/ }));
  expect(
    await screen.findByRole("dialog", { name: "墨团 · 纸签下的午后" }),
  ).toBeTruthy();
  expect(screen.getByAltText(/圆窗旁打盹/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "返回相册" }));
  expect(screen.getByRole("button", { name: /捡到一枚书签/ })).toBeTruthy();
});

test("other roles keep their own sprite and story album", async () => {
  current.settings.characterId = "zhiwei";
  mount();
  await waitFor(() =>
    expect(
      document.querySelector('[data-companion-sprite="zhiwei"]'),
    ).toBeTruthy(),
  );
  expect(sprite()).toBe(null);
  fireEvent.click(screen.getByRole("button", { name: "相册" }));
  expect(screen.queryByRole("button", { name: /纸签下的午后/ })).toBe(null);
});

test("the workspace keeps desktop pet opt-in independent of stories and restores the reading position", async () => {
  localStorage.clear();
  current.eligible = 1;
  const surface = {
    open: true,
    showPet: true,
    onOpen: vi.fn(),
    onClose: vi.fn(),
  };
  const props = {
    workspace,
    documentPath: "note.md",
    documentHash: "hash",
    saved: true,
  };
  const ui = render(<CompanionDock {...props} surface={surface} />);
  fireEvent.click(await screen.findByRole("button", { name: "显示桌宠" }));
  ui.rerender(
    <CompanionDock {...props} surface={{ ...surface, open: false }} />,
  );
  const pet = await screen.findByRole("button", { name: "墨团桌宠" });
  pet.focus();
  fireEvent.click(pet);
  const pat = screen.getByRole("button", { name: "摸摸" });
  expect(
    pet.compareDocumentPosition(pat) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  pat.focus();
  fireEvent.keyDown(pat, { key: "Escape" });
  expect(document.activeElement).toBe(pet);
  expect(screen.queryByRole("button", { name: "摸摸" })).toBeNull();
  fireEvent.click(pet);
  fireEvent.click(screen.getByRole("button", { name: "收起桌宠" }));
  expect(screen.queryByRole("button", { name: "墨团桌宠" })).toBeNull();

  ui.rerender(<CompanionDock {...props} surface={surface} />);
  fireEvent.click(await screen.findByRole("button", { name: "故事" }));
  fireEvent.click(screen.getByRole("button", { name: "阅读章节" }));
  expect(document.activeElement?.getAttribute("aria-label")).toBe(
    "捡到一枚书签",
  );
  fireEvent.click(screen.getByRole("button", { name: "继续" }));
  expect(screen.getByText("旁白 · 2 / 5")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "返回章节" }));
  fireEvent.click(screen.getByRole("button", { name: "继续阅读" }));
  expect(screen.getByText("旁白 · 2 / 5")).toBeTruthy();
  expect(
    mocked.invoke.mock.calls.some(([name]) => name === "companion_story"),
  ).toBe(false);
  localStorage.clear();
});

const petSurface = () => ({
  open: false,
  showPet: true,
  onOpen: vi.fn(),
  onClose: vi.fn(),
});
const activeDoc = {
  workspace,
  documentPath: "note.md",
  documentHash: "hash",
  saved: true,
};
function enablePet() {
  localStorage.setItem("inkstone:companion:pet-generation", current.generation);
}
async function openPetReceipt() {
  const pet = await screen.findByRole("button", { name: /桌宠$/ });
  pet.focus();
  fireEvent.click(pet);
  fireEvent.click(screen.getByRole("button", { name: "记录本次完成" }));
  return pet;
}
test.each(["motuan", "yanzhou", "zhiwei"] as const)(
  "a %s page-edge receipt requires consent to the edited text, records once and returns to the selection",
  async (role) => {
    current.settings.characterId = role;
    enablePet();
    const call = mocked.invoke.getMockImplementation()!;
    let finish!: () => void;
    mocked.invoke.mockImplementation((name, args) =>
      name === "companion_confirm"
        ? new Promise((resolve) => {
            finish = () =>
              resolve({
                status: "counted",
                snapshot: structuredClone(current),
              });
          })
        : call(name, args),
    );
    const surface = petSurface();
    render(
      <main className="main-content">
        <div className="editor-container">
          <textarea aria-label="正文" defaultValue="第一行，第二行。" />
        </div>
        <CompanionDock {...activeDoc} surface={surface} />
      </main>,
    );
    const editor = screen.getByRole("textbox", {
      name: "正文",
    }) as HTMLTextAreaElement;
    const container = editor.parentElement!;
    editor.focus();
    editor.setSelectionRange(4, 7, "backward");
    container.scrollTop = 96;
    await openPetReceipt();
    const card = await screen.findByRole("textbox", { name: "拟存经历" });
    expect(document.activeElement).toBe(card);
    const consent = screen.getByRole("checkbox", { name: /我确认保存/ });
    const submit = screen.getByRole("button", { name: "确认并记录" });
    fireEvent.click(consent);
    fireEvent.change(card, { target: { value: "核对了结论与引文" } });
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    expect(
      mocked.invoke.mock.calls.some(([name]) => name === "companion_confirm"),
    ).toBe(false);
    fireEvent.click(consent);
    act(() => {
      fireEvent.click(submit);
      fireEvent.click(submit);
    });
    const writes = mocked.invoke.mock.calls.filter(
      ([name]) => name === "companion_confirm",
    );
    expect(writes).toHaveLength(1);
    expect(writes[0][1]).toEqual({
      workspaceRoot: workspace.root,
      input: {
        context: { generation: current.generation, revision: current.revision },
        token: "server-token",
        eventId: "server-event",
        text: "核对了结论与引文",
        kind: "complete",
        consent: true,
      },
    });
    expect(screen.queryByText(/经历已记录/)).toBeNull();
    editor.setSelectionRange(0, 0);
    container.scrollTop = 0;
    await act(async () => finish());
    expect(await screen.findByText(/经历已记录/)).toBeTruthy();
    expect(
      document
        .querySelector(`[data-companion-sprite="${role}"]`)
        ?.getAttribute("data-state"),
    ).toBe("milestone");
    expect(document.activeElement).toBe(editor);
    expect([
      editor.selectionStart,
      editor.selectionEnd,
      editor.selectionDirection,
      container.scrollTop,
    ]).toEqual([4, 7, "backward", 96]);
    expect(surface.onOpen).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("本次完成经历卡")).toBeNull();
    localStorage.clear();
  },
);
test.each([
  [{ ...activeDoc, saved: false }, "请先保存当前文档"],
  [{ ...activeDoc, saved: false, saving: true }, "正在保存文档"],
  [
    { ...activeDoc, workspace: { ...workspace, managedProjectId: undefined } },
    "仅受管理的文档空间",
  ],
] as const)(
  "an ineligible edge action explains why without creating a receipt (%s)",
  async (props, reason) => {
    enablePet();
    render(<CompanionDock {...props} surface={petSurface()} />);
    await openPetReceipt();
    expect((await screen.findByRole("alert")).textContent).toContain(reason);
    expect(
      mocked.invoke.mock.calls.every(([name]) => name === "companion_state"),
    ).toBe(true);
    localStorage.clear();
  },
);
test("Escape cancels an edge preview; a late response cannot reopen the card or save anything", async () => {
  enablePet();
  const call = mocked.invoke.getMockImplementation()!;
  let finish!: () => void;
  mocked.invoke.mockImplementation((name, args) =>
    name === "companion_preview"
      ? new Promise((resolve) => {
          finish = () => resolve(call(name, args));
        })
      : call(name, args),
  );
  render(<CompanionDock {...activeDoc} surface={petSurface()} />);
  const pet = await openPetReceipt();
  expect(await screen.findByText(/正在核对本次保存/)).toBeTruthy();
  fireEvent.keyDown(document.activeElement!, { key: "Escape" });
  await act(async () => finish());
  expect(screen.queryByLabelText("本次完成经历卡")).toBeNull();
  expect(document.activeElement).toBe(pet);
  expect(
    mocked.invoke.mock.calls.some(([name]) => name === "companion_confirm"),
  ).toBe(false);
  localStorage.clear();
});
test("changing the document dismisses a consented edge preview before it can be submitted", async () => {
  enablePet();
  const surface = petSurface();
  const ui = render(<CompanionDock {...activeDoc} surface={surface} />);
  await openPetReceipt();
  fireEvent.click(await screen.findByRole("checkbox", { name: /我确认保存/ }));
  ui.rerender(
    <CompanionDock {...activeDoc} documentPath="other.md" surface={surface} />,
  );
  expect(screen.queryByRole("button", { name: "确认并记录" })).toBeNull();
  expect(
    mocked.invoke.mock.calls.some(([name]) => name === "companion_confirm"),
  ).toBe(false);
  expect(surface.onOpen).not.toHaveBeenCalled();
  localStorage.clear();
});
test.each([
  ["duplicate", /没有重复计入/],
  ["daily_limit", /有效经历已达上限/],
  ["error", /请重新预览/],
])(
  "a %s result has its own edge notice and never displays the success pose",
  async (result, message) => {
    enablePet();
    const call = mocked.invoke.getMockImplementation()!;
    mocked.invoke.mockImplementation(async (name, args) => {
      if (name !== "companion_confirm") return call(name, args);
      if (result === "error")
        throw new Error("TOKEN_EXPIRED：请重新预览这次经历。");
      return { status: result, snapshot: structuredClone(current) };
    });
    render(<CompanionDock {...activeDoc} surface={petSurface()} />);
    await openPetReceipt();
    fireEvent.click(
      await screen.findByRole("checkbox", { name: /我确认保存/ }),
    );
    fireEvent.click(screen.getByRole("button", { name: "确认并记录" }));
    expect(await screen.findByText(message)).toBeTruthy();
    expect(sprite()?.getAttribute("data-state")).toBe("idle");
    expect(screen.queryByText(/经历已记录/)).toBeNull();
    localStorage.clear();
  },
);

test("a confirmed write that resolves after switching documents refreshes the ledger silently", async () => {
  enablePet();
  const call = mocked.invoke.getMockImplementation()!;
  let finish!: () => void;
  mocked.invoke.mockImplementation((name, args) =>
    name === "companion_confirm"
      ? new Promise((resolve) => {
          finish = () =>
            resolve({ status: "counted", snapshot: structuredClone(current) });
        })
      : call(name, args),
  );
  const surface = petSurface();
  const ui = render(<CompanionDock {...activeDoc} surface={surface} />);
  await openPetReceipt();
  fireEvent.click(await screen.findByRole("checkbox", { name: /我确认保存/ }));
  fireEvent.click(screen.getByRole("button", { name: "确认并记录" }));
  ui.rerender(
    <CompanionDock {...activeDoc} documentPath="other.md" surface={surface} />,
  );
  const reads = mocked.invoke.mock.calls.filter(
    ([name]) => name === "companion_state",
  ).length;
  await act(async () => finish());
  expect(
    mocked.invoke.mock.calls.filter(([name]) => name === "companion_state"),
  ).toHaveLength(reads + 1);
  expect(screen.queryByText(/经历已记录/)).toBeNull();
  expect(sprite()?.getAttribute("data-state")).toBe("idle");
  expect(screen.queryByLabelText("本次完成经历卡")).toBeNull();
  localStorage.clear();
});

test("a skipped chapter can be read again without sending a later chapter's locked choice", async () => {
  current.roles.motuan = {
    read: [0, 1, 2],
    outcomes: { 0: "read", 1: "skipped", 2: "read" },
    choices: { c1: "saved-branch" },
    outfit: 2,
  };
  const call = mocked.invoke.getMockImplementation()!;
  mocked.invoke.mockImplementation(async (name, args) => {
    if (name !== "companion_story") return call(name, args);
    current.roles.motuan!.outcomes![1] = "read";
    return structuredClone(current);
  });
  render(
    <CompanionDock {...activeDoc} surface={{ ...petSurface(), open: true }} />,
  );
  fireEvent.click(await screen.findByRole("button", { name: "故事" }));
  const chapter = screen.getByText("相识 · 已跳过").closest("article")!;
  fireEvent.click(chapter.querySelector("button")!);
  while (screen.queryByRole("button", { name: "继续" }))
    fireEvent.click(screen.getByRole("button", { name: "继续" }));
  fireEvent.click(screen.getByRole("button", { name: "读完本章" }));
  await screen.findByText("相识 · 已读完");
  expect(
    mocked.invoke.mock.calls.find(([name]) => name === "companion_story")?.[1],
  ).toMatchObject({
    input: { characterId: "motuan", stage: 1, skipped: false, choiceId: null },
  });
});

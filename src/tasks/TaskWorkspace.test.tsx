// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useState } from "react";
import ProjectCalendar, {
  type CalendarPatch,
} from "../calendar/ProjectCalendar";
import TaskList from "./TaskList";
import { imeBoundary } from "../platform/ime";
import { taskViewState } from "./project";
import {
  dateInZone,
  monthRange,
  type CalendarDocument,
} from "../content/calendar";
import { scanTrackedTasks, taskLine } from "../content/tasks";
vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => false,
  invoke: async () => null,
}));
afterEach(() => {
  cleanup();
  localStorage.clear();
});
const taskProps = {
  spaceId: "space",
  busy: false,
  onQuickAdd: vi.fn(),
  onCalendar: vi.fn(),
  onUndo: vi.fn(),
  canUndo: false,
  onRefresh: vi.fn(),
  onAskForHelp: vi.fn(),
};

function renderQuickAdd(onQuickAdd: typeof taskProps.onQuickAdd) {
  render(
    <TaskList
      {...taskProps}
      documents={[]}
      onQuickAdd={onQuickAdd}
      onPatch={vi.fn()}
      onOpen={vi.fn()}
    />,
  );
  return screen.getByRole<HTMLInputElement>("textbox", { name: "任务标题" });
}

it("submits a quick entry once and returns from the submit button to a cleared title for the next task", async () => {
  let finish!: () => void;
  const write = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    )
    .mockResolvedValue(undefined);
  const input = renderQuickAdd(write);
  fireEvent.change(input, { target: { value: "   " } });
  expect(screen.queryByRole("button", { name: "添加任务" })).toBeNull();
  fireEvent.submit(input.form!);
  expect(write).not.toHaveBeenCalled();
  fireEvent.change(input, { target: { value: "  发出会议纪要  " } });
  const add = screen.getByRole<HTMLButtonElement>("button", {
    name: "添加任务",
  });
  add.focus();
  fireEvent.click(add);
  fireEvent.submit(input.form!);
  expect(write).toHaveBeenCalledTimes(1);
  expect(write.mock.calls[0][0].title).toBe("发出会议纪要");
  expect(input.value.trim()).toBe("发出会议纪要");
  expect(input.readOnly).toBe(true);
  expect(add.disabled).toBe(true);
  await act(async () => {
    finish();
  });
  await waitFor(() => {
    expect(input.value).toBe("");
    expect(document.activeElement).toBe(input);
  });
  expect(input.readOnly).toBe(false);

  fireEvent.change(input, { target: { value: "预约复盘" } });
  fireEvent.submit(input.form!);
  await waitFor(() => expect(input.value).toBe(""));
  expect(write.mock.calls.map(([draft]) => draft.title)).toEqual([
    "发出会议纪要",
    "预约复盘",
  ]);
  expect(write.mock.calls[1][0].id).not.toBe(write.mock.calls[0][0].id);
});

it("retains the title after a failed quick add and retries the same task ID", async () => {
  const write = vi
    .fn()
    .mockRejectedValueOnce(new Error("保存失败"))
    .mockResolvedValueOnce(undefined);
  const input = renderQuickAdd(write);
  fireEvent.change(input, { target: { value: "保存这条任务" } });
  fireEvent.submit(input.form!);
  expect((await screen.findByRole("alert")).textContent).toContain("保存失败");
  expect(input.value).toBe("保存这条任务");
  fireEvent.click(screen.getByRole("button", { name: "添加任务" }));
  await waitFor(() => expect(input.value).toBe(""));
  expect(write).toHaveBeenCalledTimes(2);
  expect(write.mock.calls[1][0]).toEqual(write.mock.calls[0][0]);
});

it("prevents implicit submission for Chinese candidate confirmation, including WebKit's final key", async () => {
  const write = vi.fn().mockResolvedValue(undefined);
  const input = renderQuickAdd(write);
  fireEvent.change(input, { target: { value: "整理资料" } });
  for (const event of [
    { isComposing: true },
    { isComposing: false, keyCode: 229 },
  ]) {
    // An uncancelled Enter implicitly submits the form in the desktop webview.
    const allowed = fireEvent.keyDown(input, { key: "Enter", ...event });
    expect(allowed).toBe(false);
  }
  expect(write).not.toHaveBeenCalled();
  expect(input.value).toBe("整理资料");
  expect(fireEvent.keyDown(input, { key: "Enter" })).toBe(true);
  fireEvent.submit(input.form!);
  await waitFor(() => expect(input.value).toBe(""));
  expect(write).toHaveBeenCalledTimes(1);
});
it("writes a task to its chosen document, follows a due marker back to its line, completes it and guards a stale detail form", async () => {
  const a = {
    documentId: "a",
    path: "A.md",
    title: "A",
    hash: "1",
    content: "A\n",
  };
  const b = {
    ...a,
    documentId: "b",
    path: "B.md",
    title: "B",
    content: "# **B**\r\n",
  };
  const open = vi.fn(),
    writes: CalendarPatch[] = [];
  function App() {
    const [docs, setDocs] = useState<CalendarDocument[]>([a, b]);
    const [calendar, setCalendar] = useState(false);
    const patch = async (p: CalendarPatch) => {
      writes.push(p);
      setDocs((old) =>
        old.map((d) =>
          d.documentId === p.documentId
            ? { ...d, content: p.content, hash: String(Number(d.hash) + 1) }
            : d,
        ),
      );
    };
    return (
      <>
        <button onClick={() => setCalendar(true)}>Calendar route</button>
        <button
          onClick={() =>
            setDocs((old) => old.map((d) => ({ ...d, hash: "external" })))
          }
        >
          external edit
        </button>
        {calendar ? (
          <ProjectCalendar
            documents={docs}
            initialRange={initialRange}
            onOpen={open}
            onError={() => {}}
            onPatch={patch}
          />
        ) : (
          <TaskList
            {...taskProps}
            documents={docs}
            onOpen={open}
            onPatch={patch}
          />
        )}
      </>
    );
  }
  const initialRange = monthRange(dateInZone());
  render(<App />);
  fireEvent.change(screen.getByLabelText("任务标题"), {
    target: { value: "Revise appendix" },
  });
  fireEvent.change(screen.getByLabelText("新增任务保存到"), {
    target: { value: "b" },
  });
  fireEvent.click(screen.getByRole("button", { name: "添加任务" }));
  await waitFor(() => expect(writes).toHaveLength(1));
  expect(writes[0]).toMatchObject({ documentId: "b", expectedHash: "1" });
  expect(scanTrackedTasks(writes[0].content)[0]).toMatchObject({
    line: 3,
    due: dateInZone(),
    done: false,
  });
  fireEvent.click(screen.getByRole("button", { name: "Calendar route" }));
  fireEvent.click(screen.getByRole("button", { name: "B ↗" }));
  expect(open).toHaveBeenCalledWith({ path: "B.md", line: 3 });
  fireEvent.click(
    screen.getByRole("button", { name: /到期 · Revise appendix/ }),
  );
  fireEvent.click(
    within(screen.getByRole("form", { name: "任务详情" })).getByLabelText(
      "已完成",
    ),
  );
  fireEvent.click(screen.getByRole("button", { name: "保存任务" }));
  await waitFor(() => expect(writes).toHaveLength(2));
  expect(scanTrackedTasks(writes[1].content)[0]).toMatchObject({
    done: true,
    due: dateInZone(),
  });
  fireEvent.click(
    screen.getByRole("button", { name: /到期 · Revise appendix/ }),
  );
  fireEvent.click(screen.getByRole("button", { name: "external edit" }));
  expect(
    (screen.getByRole("button", { name: "保存任务" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
});
it("keeps ordinary checklists separate and allows explicit repair of one duplicated task ID", async () => {
  const line = taskLine({ id: crypto.randomUUID(), title: "same" });
  const content = "- [ ] plain\n" + line + "\n" + line;
  const write = vi.fn().mockResolvedValue(undefined);
  render(
    <TaskList
      {...taskProps}
      documents={[
        { documentId: "a", path: "A.md", title: "A", hash: "h", content },
      ]}
      onPatch={write}
      onOpen={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: /^全部任务/ }));
  expect(screen.queryByLabelText("plain")).toBeNull();
  fireEvent.click(screen.getAllByRole("button", { name: /same.*ID 重复/ })[1]);
  fireEvent.click(screen.getByRole("button", { name: "为这项重新编号" }));
  await waitFor(() => expect(write).toHaveBeenCalledTimes(1));
  const result = scanTrackedTasks(write.mock.calls[0][0].content);
  expect(result.map((r) => r.duplicate)).toEqual([false, false]);
  expect(result[0].id).not.toBe(result[1].id);
});

it("keeps a failed breakdown draft, then saves the edited task and time slot before opening chat", async () => {
  const doc = {
    documentId: "a",
    title: "A",
    path: "A.md",
    hash: "h",
    content: taskLine({ id: crypto.randomUUID(), title: "Review plan" }),
  };
  const help = vi.fn();
  let finish!: () => void;
  const patch = vi
    .fn()
    .mockRejectedValueOnce(new Error("disk busy"))
    .mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
  render(
    <div {...imeBoundary}>
      <TaskList
        {...taskProps}
        documents={[doc]}
        onPatch={patch}
        onOpen={vi.fn()}
        onAskForHelp={help}
      />
    </div>,
  );
  fireEvent.click(screen.getByRole("button", { name: /^全部任务/ }));
  fireEvent.click(screen.getByRole("button", { name: "Review plan" }));
  const form = within(screen.getByRole("form", { name: "任务详情" }));
  const title = form.getByLabelText("任务标题") as HTMLInputElement;
  fireEvent.compositionStart(title);
  fireEvent.keyDown(title, { key: "Escape" });
  fireEvent.compositionEnd(title);
  fireEvent.keyDown(title, { key: "Escape", keyCode: 229 });
  fireEvent.keyUp(title, { key: "Escape" });
  expect(title.isConnected).toBe(true);
  fireEvent.change(title, { target: { value: "Review revised plan" } });
  fireEvent.click(form.getByText("安排执行时段"));
  fireEvent.change(form.getByLabelText("开始", { exact: true }), {
    target: { value: "2026-12-03T11:00" },
  });
  fireEvent.change(form.getByLabelText("结束", { exact: true }), {
    target: { value: "2026-12-03T12:00" },
  });
  const saveAndAsk = form.getByRole("button", { name: "保存并拆解" });
  fireEvent.click(saveAndAsk);
  expect((await form.findByRole("alert")).textContent).toContain("disk busy");
  expect(title.value).toBe("Review revised plan");
  expect(help).not.toHaveBeenCalled();
  fireEvent.click(saveAndAsk);
  expect(help).not.toHaveBeenCalled();
  await act(async () => finish());
  const saved = scanTrackedTasks(patch.mock.calls[1][0].content)[0];
  expect(help).toHaveBeenCalledTimes(1);
  expect(help).toHaveBeenCalledWith(
    expect.objectContaining({ title: "Review revised plan", slot: saved.slot }),
  );
  expect(saved.slot?.start).toContain("2026-12-03T11:00");
  expect(screen.queryByRole("form", { name: "任务详情" })).toBeNull();
});

it("saves a rescheduled task before opening that week and preserves the independent due date", async () => {
  const due = "2026-11-23";
  const source = {
    documentId: "d",
    title: "Research",
    path: "Research.md",
    hash: "h",
    content: taskLine({
      id: crypto.randomUUID(),
      title: "Write interview notes",
      due,
    }),
  };
  const patch = vi.fn().mockResolvedValue(undefined),
    calendar = vi.fn();
  render(
    <TaskList
      {...taskProps}
      documents={[source]}
      onPatch={patch}
      onOpen={vi.fn()}
      onCalendar={calendar}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: /全部任务/ }));
  fireEvent.click(
    screen.getByRole("button", { name: "Write interview notes" }),
  );
  const detail = within(screen.getByRole("dialog"));
  fireEvent.click(detail.getByText("安排执行时段"));
  fireEvent.change(detail.getByLabelText("开始", { exact: true }), {
    target: { value: "2026-12-03T11:00" },
  });
  fireEvent.change(detail.getByLabelText("结束", { exact: true }), {
    target: { value: "2026-12-03T12:00" },
  });
  fireEvent.click(detail.getByRole("button", { name: "保存并在日历中查看" }));
  await waitFor(() => expect(calendar).toHaveBeenCalledWith("2026-12-03"));
  expect(scanTrackedTasks(patch.mock.calls[0][0].content)[0]).toMatchObject({
    due,
    slot: { start: expect.stringContaining("2026-12-03T11:00") },
  });
});

it("today includes a task due last week, a slot spanning today, and a follow-up; future-only tasks stay out", () => {
  const id = () => crypto.randomUUID();
  const r = (task: Record<string, unknown>) => ({
    document: {
      documentId: "d",
      title: "Doc",
      path: "D.md",
      content: "",
      hash: "h",
    },
    task: {
      id: id(),
      title: "Demo",
      done: false,
      line: 1,
      checkFrom: 0,
      titleFrom: 0,
      markerFrom: 0,
      markerTo: 0,
      duplicate: false,
      ...task,
    },
  });
  const status = (task: Record<string, unknown>) =>
    taskViewState(r(task), "2026-11-23", "Asia/Shanghai");
  expect(status({ due: "2026-11-21" })).toMatchObject({
    today: true,
    overdue: true,
  });
  expect(
    status({
      slot: {
        start: "2026-11-22T23:00:00+08:00",
        end: "2026-11-24T01:00:00+08:00",
        zone: "Asia/Shanghai",
      },
    }).today,
  ).toBe(true);
  expect(status({ waiting: true, followOn: "2026-11-23" }).today).toBe(true);
  expect(status({ due: "2026-11-24" })).toMatchObject({
    today: false,
    upcoming: true,
  });
});

it("returns from the source note to the task list and restores only actual edits", () => {
  const id = crypto.randomUUID();
  const doc = {
    documentId: "a",
    path: "A.md",
    title: "A",
    hash: "old",
    content: taskLine({ id, title: "确认手册" }),
  };
  const changed = {
    ...doc,
    hash: "saved",
    content: taskLine({ id, title: "确认手册", done: true }),
  };
  const session = {};
  const open = vi.fn();
  const mount = (source: CalendarDocument) =>
    render(
      <TaskList
        {...taskProps}
        session={session}
        documents={[source]}
        onPatch={vi.fn()}
        onOpen={open}
      />,
    );
  let pane = mount(doc);
  fireEvent.click(screen.getByRole("button", { name: /^全部任务/ }));
  fireEvent.click(screen.getByRole("button", { name: "确认手册" }));
  fireEvent.click(screen.getByRole("button", { name: "打开原文" }));
  expect(open).toHaveBeenCalledWith({ path: "A.md", line: 1 });
  pane.unmount();
  pane = mount(changed);
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(
    screen.getByRole<HTMLInputElement>("checkbox", { name: "确认手册" })
      .checked,
  ).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "确认手册" }));
  fireEvent.change(
    within(screen.getByRole("dialog")).getByLabelText("任务标题"),
    { target: { value: "有未保存修改" } },
  );
  pane.unmount();
  pane = mount(changed);
  const title = within(
    screen.getByRole("dialog"),
  ).getByLabelText<HTMLInputElement>("任务标题");
  expect(title.value).toBe("有未保存修改");
  fireEvent.change(title, { target: { value: "确认手册" } });
  pane.unmount();
  mount(changed);
  expect(screen.queryByRole("dialog")).toBeNull();
});

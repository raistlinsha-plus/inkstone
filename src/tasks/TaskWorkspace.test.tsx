// @vitest-environment jsdom
import {
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

it("hands a selected task title to the question composer and closes its detail form", async () => {
  const doc = {
    documentId: "a",
    title: "A",
    path: "A.md",
    hash: "h",
    content: taskLine({ id: crypto.randomUUID(), title: "Review plan" }),
  };
  const help = vi.fn();
  render(
    <TaskList
      {...taskProps}
      documents={[doc]}
      onPatch={vi.fn()}
      onOpen={vi.fn()}
      onAskForHelp={help}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: /^全部任务/ }));
  fireEvent.click(screen.getByRole("button", { name: "Review plan" }));
  fireEvent.click(screen.getByRole("button", { name: "请 AI 帮我拆解" }));
  expect(help).toHaveBeenCalledWith("Review plan");
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

// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import ProjectCalendar from "./ProjectCalendar";
import { scanTrackedTasks, taskLine } from "../content/tasks";
import {
  calendarTemplate,
  calendarBlocks,
  type CalendarDocument,
  type CalendarEvent,
} from "../content/calendar";
vi.mock("./CalendarBoard", () => ({
  default: ({
    mode,
    anchor,
    rows,
    onEdit,
    onDate,
    onMoveSlot,
  }: {
    mode: string;
    anchor: string;
    rows: { key: string; event: CalendarEvent; slotSourceHash?: string }[];
    onMoveSlot?: (
      key: string,
      hash: string,
      start: string,
      end: string,
    ) => void;
    onEdit: (key: string) => void;
    onDate: (date: string, time?: string) => void;
  }) => (
    <div data-testid="grid" data-view={mode}>
      <span data-testid="calendar-anchor">{anchor}</span>
      <button onClick={() => onDate(anchor, "23:30")}>empty time slot</button>
      {rows
        .filter((r) => r.slotSourceHash)
        .map((r) => (
          <button
            key={"move" + r.key}
            onClick={() =>
              onMoveSlot?.(
                r.key,
                r.slotSourceHash!,
                "2026-10-30T01:00:00Z",
                "2026-10-30T02:00:00Z",
              )
            }
          >
            drag scheduled slot
          </button>
        ))}
      {rows.map((row) => (
        <button
          key={row.key}
          data-all-day={row.event.allDay}
          onClick={() => onEdit(row.key)}
        >
          {row.event.title}
        </button>
      ))}
    </div>
  ),
  CalendarAgenda: ({
    rows,
    onEdit,
  }: {
    rows: { key: string; event: CalendarEvent }[];
    onEdit: (key: string) => void;
  }) => (
    <div>
      {rows.map((row) => (
        <button key={row.key} onClick={() => onEdit(row.key)}>
          {row.event.title}
        </button>
      ))}
    </div>
  ),
}));
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-28T02:00:00Z"));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
function document(id: string, count = 1): CalendarDocument {
  const data = JSON.parse(calendarTemplate());
  data.events = Array.from({ length: count }, (_, i) => ({
    id: crypto.randomUUID(),
    title: `${id}事项${i + 1}`,
    start: "2026-10-28",
    end: "2026-10-29",
    allDay: true,
    timeZone: "Asia/Shanghai",
    status: "planned",
    notes: "正文中的事项",
  }));
  return {
    documentId: id,
    title: id + ".md",
    path: id + ".md",
    content:
      "# " +
      id +
      "\n\n原文前段\n\n```calendar\n" +
      JSON.stringify(data, null, 2) +
      "\n```\n\n原文后段",
    hash: "hash-" + id,
  };
}
it("writes the selected project event to its own document and expected version", async () => {
  const docs = [document("A"), document("B")],
    patch = vi.fn().mockResolvedValue(undefined);
  render(
    <ProjectCalendar
      documents={docs}
      onPatch={patch}
      onOpen={vi.fn()}
      onError={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "B事项1" }));
  fireEvent.change(screen.getByLabelText("事项标题"), {
    target: { value: "B项目修改" },
  });
  fireEvent.click(screen.getByRole("button", { name: "保存事项" }));
  await waitFor(() => expect(patch).toHaveBeenCalledTimes(1));
  const update = patch.mock.calls[0][0];
  expect(update.documentId).toBe("B");
  expect(update.expectedHash).toBe("hash-B");
  expect(update.content).toContain("原文前段");
  expect(update.content).toContain("原文后段");
  expect(calendarBlocks(update.content)[0].data?.events[0].title).toBe(
    "B项目修改",
  );
  expect(docs[0].content).toContain("A事项1");
});
it("returns focus to the originating project event after completing an edit", async () => {
  render(
    <ProjectCalendar
      documents={[document("A")]}
      onPatch={vi.fn().mockResolvedValue(undefined)}
      onOpen={vi.fn()}
      onError={vi.fn()}
    />,
  );
  const item = screen.getByRole("button", { name: "A事项1" });
  item.focus();
  fireEvent.click(item);
  fireEvent.click(screen.getByRole("button", { name: "保存事项" }));
  await waitFor(() => expect(globalThis.document.activeElement).toBe(item));
});
it("shows all date-filtered events rather than six RAG candidates", () => {
  render(
    <ProjectCalendar
      documents={[document("A", 12)]}
      onPatch={vi.fn()}
      onOpen={vi.fn()}
      onError={vi.fn()}
      initialRange={{
        start: "2026-10-28",
        end: "2026-10-29",
        label: "今天",
        terms: "",
      }}
    />,
  );
  expect(screen.getByText("共 12 个事项")).toBeTruthy();
  expect(screen.getByRole("button", { name: "A事项12" })).toBeTruthy();
});
it("disables stale project edit forms after a refreshed source version", () => {
  const docs = [document("A")],
    patch = vi.fn();
  const { rerender } = render(
    <ProjectCalendar
      documents={docs}
      onPatch={patch}
      onOpen={vi.fn()}
      onError={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "A事项1" }));
  rerender(
    <ProjectCalendar
      documents={[{ ...docs[0], hash: "new-hash" }]}
      onPatch={patch}
      onOpen={vi.fn()}
      onError={vi.fn()}
    />,
  );
  expect(
    screen.getByRole("button", { name: "保存事项" }).hasAttribute("disabled"),
  ).toBe(true);
  expect(patch).not.toHaveBeenCalled();
});
it("resets form state when imported copies share event IDs in different documents", () => {
  const original = document("A");
  const copy = {
    ...original,
    documentId: "B",
    title: "B.md",
    path: "B.md",
    content: original.content.replaceAll("A事项", "B事项"),
    hash: "hash-B",
  };
  render(
    <ProjectCalendar
      documents={[original, copy]}
      onPatch={vi.fn()}
      onOpen={vi.fn()}
      onError={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "A事项1" }));
  fireEvent.change(screen.getByLabelText("事项标题"), {
    target: { value: "A的未保存草稿" },
  });
  fireEvent.click(screen.getByRole("button", { name: "B事项1" }));
  expect((screen.getByLabelText("事项标题") as HTMLInputElement).value).toBe(
    "B事项1",
  );
});
it("opens the week directly and switches month and date without changing Markdown", () => {
  const patch = vi.fn();
  render(
    <ProjectCalendar
      documents={[document("A")]}
      onPatch={patch}
      onOpen={vi.fn()}
      onError={vi.fn()}
    />,
  );
  expect(screen.getByTestId("grid").getAttribute("data-view")).toBe("week");
  expect(screen.queryByRole("button", { name: "任务" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "月历" }));
  fireEvent.click(screen.getByText("筛选"));
  fireEvent.change(screen.getByLabelText("日历转到日期"), {
    target: { value: "2027-02-12" },
  });
  expect(screen.getByTestId("calendar-anchor").textContent).toBe("2027-02-12");
  expect(patch).not.toHaveBeenCalled();
});
it("starts on the requested week and creates the first event only after confirming a time slot", async () => {
  const create = vi.fn().mockResolvedValue(undefined);
  render(
    <ProjectCalendar
      documents={[]}
      initialDay="2027-02-12"
      onCreateCalendar={create}
      onPatch={vi.fn()}
      onOpen={vi.fn()}
      onError={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "empty time slot" }));
  expect(create).not.toHaveBeenCalled();
  expect((screen.getByLabelText("事项开始") as HTMLInputElement).value).toBe(
    "2027-02-12T23:30",
  );
  expect((screen.getByLabelText("事项结束") as HTMLInputElement).value).toBe(
    "2027-02-13T00:30",
  );
  fireEvent.change(screen.getByLabelText("事项标题"), {
    target: { value: "First event" },
  });
  fireEvent.click(screen.getByRole("button", { name: "保存事项" }));
  await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
  expect(create.mock.calls[0][0]).toMatchObject({
    title: "First event",
    allDay: false,
  });
});
it("projects due and execution independently and retains the source when editing either", async () => {
  const id = crypto.randomUUID(),
    write = vi.fn().mockResolvedValue(undefined);
  const doc = {
    ...document("T"),
    content:
      "Other text\n" +
      taskLine({
        id,
        title: "Review transcript",
        due: "2026-10-28",
        slot: {
          start: "2026-10-27T11:00:00Z",
          end: "2026-10-27T12:00:00Z",
          zone: "UTC",
        },
      }),
  };
  render(
    <ProjectCalendar
      documents={[doc]}
      onPatch={write}
      onOpen={vi.fn()}
      onError={vi.fn()}
    />,
  );
  expect(
    screen.getByRole("button", { name: "到期 · Review transcript" }).dataset
      .allDay,
  ).toBe("true");
  const slot = screen.getByRole("button", { name: "执行 · Review transcript" });
  expect(slot.dataset.allDay).toBe("false");
  fireEvent.click(slot);
  fireEvent.click(screen.getByLabelText("已完成"));
  fireEvent.click(screen.getByRole("button", { name: "保存任务" }));
  await waitFor(() => expect(write).toHaveBeenCalledTimes(1));
  expect(write.mock.calls[0][0]).toMatchObject({
    documentId: "T",
    expectedHash: "hash-T",
  });
  expect(write.mock.calls[0][0].content).toContain("- [x] Review transcript");
  expect(write.mock.calls[0][0].content).toContain(id);
});
it("moves only the timed slot in its source document and preserves its original zone and due date", async () => {
  const due = "2026-10-28",
    id = crypto.randomUUID(),
    onPatch = vi.fn().mockResolvedValue(undefined);
  const doc = {
    ...document("T"),
    content:
      "Preface\n" +
      taskLine({
        id,
        title: "Submit",
        due,
        slot: {
          start: "2026-10-27T11:00:00+08:00",
          end: "2026-10-27T12:00:00+08:00",
          zone: "Asia/Shanghai",
        },
      }),
  };
  render(
    <ProjectCalendar
      documents={[doc]}
      onPatch={onPatch}
      onOpen={vi.fn()}
      onError={vi.fn()}
    />,
  );
  expect(
    screen.getAllByRole("button", { name: "drag scheduled slot" }),
  ).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: "drag scheduled slot" }));
  await waitFor(() => expect(onPatch).toHaveBeenCalledTimes(1));
  const [patch] = onPatch.mock.calls[0];
  expect(patch.expectedHash).toBe("hash-T");
  expect(patch.content).toContain("Preface");
  expect(scanTrackedTasks(patch.content)[0]).toMatchObject({
    id,
    due,
    slot: {
      start: "2026-10-30T09:00:00+08:00",
      end: "2026-10-30T10:00:00+08:00",
      zone: "Asia/Shanghai",
    },
  });
});
it("keeps the current form while its save is pending and ignores other edit clicks", async () => {
  let finish!: () => void;
  const patch = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  render(
    <ProjectCalendar
      documents={[document("A", 2)]}
      onPatch={patch}
      onOpen={vi.fn()}
      onError={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "A事项1" }));
  fireEvent.click(screen.getByRole("button", { name: "保存事项" }));
  await waitFor(() => expect(patch).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByRole("button", { name: "A事项2" }));
  expect((screen.getByLabelText("事项标题") as HTMLInputElement).value).toBe(
    "A事项1",
  );
  finish();
  await waitFor(() => expect(screen.queryByLabelText("事项标题")).toBeNull());
});

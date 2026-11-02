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
import {
  calendarTemplate,
  calendarBlocks,
  type CalendarDocument,
  type CalendarEvent,
} from "../content/calendar";
vi.mock("./CalendarBoard", () => ({
  default: ({ anchor }: { anchor: string }) => (
    <div data-testid="month-anchor">{anchor}</div>
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
it("moves the displayed month when a native date input selects a future range", () => {
  render(
    <ProjectCalendar
      documents={[document("A")]}
      onPatch={vi.fn()}
      onOpen={vi.fn()}
      onError={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "月历" }));
  fireEvent.input(screen.getByLabelText("日历范围开始"), {
    target: { value: "2027-02-12" },
  });
  expect(screen.getByTestId("month-anchor").textContent).toBe("2027-02-12");
  expect(
    (screen.getByLabelText("日历范围结束") as HTMLInputElement).value,
  ).toBe("2027-02-12");
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

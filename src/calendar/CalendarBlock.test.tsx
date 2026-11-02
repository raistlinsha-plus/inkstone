// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { act, useState } from "react";
import CalendarBlock from "./CalendarBlock";
import EventEditor from "./EventEditor";
import {
  calendarTemplate,
  parseCalendar,
  type CalendarEvent,
} from "../content/calendar";
vi.mock("./CalendarBoard", () => ({
  default: () => <div>月历占位</div>,
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
const initial = () =>
  calendarTemplate().replace(
    '"events": []',
    '"extension": 9007199254740993, "events": []',
  );
function Harness() {
  const [source, setSource] = useState(initial);
  return (
    <>
      <CalendarBlock
        source={source}
        onApply={(base, next) => {
          if (base !== source) throw Error("旧版本");
          setSource(next);
        }}
      />
      <output aria-label="日历原文">{source}</output>
    </>
  );
}
describe("inline calendar editing", () => {
  it("returns focus after cancel and save, with a connected fallback after deletion", async () => {
    render(<Harness />);
    const add = screen.getByRole("button", { name: "＋ 新增事项" });
    add.focus();
    fireEvent.click(add);
    fireEvent.keyDown(screen.getByLabelText("事项标题"), { key: "Escape" });
    await waitFor(() => expect(document.activeElement).toBe(add));
    fireEvent.click(add);
    fireEvent.change(screen.getByLabelText("事项标题"), {
      target: { value: "焦点事项" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存事项" }));
    await waitFor(() => expect(document.activeElement).toBe(add));
    const item = screen.getByRole("button", { name: "焦点事项" });
    item.focus();
    fireEvent.click(item);
    fireEvent.click(screen.getByRole("button", { name: "保存事项" }));
    await waitFor(() => expect(document.activeElement).toBe(item));
    fireEvent.click(item);
    fireEvent.click(screen.getByRole("button", { name: "删除事项" }));
    fireEvent.click(screen.getByRole("button", { name: "确认删除事项" }));
    await waitFor(() => expect(document.activeElement).toBe(add));
  });
  it("reports open forms so offscreen preview disposal can preserve unsaved drafts", () => {
    const active = vi.fn();
    render(
      <CalendarBlock
        source={initial()}
        onApply={vi.fn()}
        onEditingChange={active}
      />,
    );
    expect(active).toHaveBeenLastCalledWith(false);
    fireEvent.click(screen.getByRole("button", { name: "＋ 新增事项" }));
    expect(active).toHaveBeenLastCalledWith(true);
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(active).toHaveBeenLastCalledWith(false);
  });
  it("creates, edits and deletes in the same authoritative source without changing extension numerals", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "＋ 新增事项" }));
    fireEvent.change(screen.getByLabelText("事项标题"), {
      target: { value: "产品复盘" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存事项" }));
    let source = screen.getByLabelText("日历原文").textContent!;
    let data = parseCalendar(source);
    expect(data.events).toHaveLength(1);
    expect(data.events[0].title).toBe("产品复盘");
    expect(source).toContain("9007199254740993");
    fireEvent.click(screen.getByRole("button", { name: "产品复盘" }));
    fireEvent.change(screen.getByLabelText("事项标题"), {
      target: { value: "产品复盘已更新" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存事项" }));
    source = screen.getByLabelText("日历原文").textContent!;
    data = parseCalendar(source);
    expect(data.events[0].title).toBe("产品复盘已更新");
    expect(source).toContain("9007199254740993");
    fireEvent.click(screen.getByRole("button", { name: "产品复盘已更新" }));
    fireEvent.click(screen.getByRole("button", { name: "删除事项" }));
    fireEvent.click(screen.getByRole("button", { name: "确认删除事项" }));
    expect(
      parseCalendar(screen.getByLabelText("日历原文").textContent!).events,
    ).toHaveLength(0);
  });
  it("refuses stale form writes after raw source changes", () => {
    const source = initial(),
      apply = vi.fn();
    const { rerender } = render(
      <CalendarBlock source={source} onApply={apply} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "＋ 新增事项" }));
    fireEvent.change(screen.getByLabelText("事项标题"), {
      target: { value: "不应写入旧块" },
    });
    rerender(
      <CalendarBlock
        source={source.replace('"agenda"', '"month"')}
        onApply={apply}
      />,
    );
    expect(
      screen.getByRole("button", { name: "保存事项" }).hasAttribute("disabled"),
    ).toBe(true);
    expect(screen.getByText(/原文已变化/)).toBeTruthy();
    expect(apply).not.toHaveBeenCalled();
  });
  it("preserves invalid block text and leaves an actionable local error", () => {
    const apply = vi.fn();
    render(<CalendarBlock source={'{"schema":'} onApply={apply} />);
    expect(screen.getByRole("alert").textContent).toContain("原文仍可保存");
    expect(apply).not.toHaveBeenCalled();
  });
});
it("guards repeated submits synchronously before React commits the saving state", async () => {
  let finish!: () => void;
  const save = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  render(<EventEditor onSave={save} onCancel={vi.fn()} />);
  fireEvent.change(screen.getByLabelText("事项标题"), {
    target: { value: "只提交一次" },
  });
  const form = screen.getByRole("form", { name: "新增事项" });
  act(() => {
    form.dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    );
    form.dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    );
  });
  expect(save).toHaveBeenCalledTimes(1);
  await act(async () => finish());
});

it("keeps explicit DST-fold offsets and subminute instants during title-only edits", async () => {
  const event: CalendarEvent = {
    id: crypto.randomUUID(),
    title: "秋季会议",
    start: "2026-11-01T01:30:12.123-04:00",
    end: "2026-11-01T01:30:15.456-05:00",
    allDay: false,
    timeZone: "America/New_York",
    status: "planned",
    notes: "",
  };
  const save = vi.fn();
  render(<EventEditor event={event} onSave={save} onCancel={vi.fn()} />);
  fireEvent.change(screen.getByLabelText("事项标题"), {
    target: { value: "仅修改标题" },
  });
  fireEvent.click(screen.getByRole("button", { name: "保存事项" }));
  expect(save).toHaveBeenCalledWith(
    expect.objectContaining({
      title: "仅修改标题",
      start: event.start,
      end: event.end,
    }),
  );
});

it("keeps a user's changed instant when switching back into a repeated DST hour", () => {
  const event: CalendarEvent = {
    id: crypto.randomUUID(),
    title: "跨时区会议",
    start: "2026-11-01T01:30:00-04:00",
    end: "2026-11-01T02:30:00-05:00",
    allDay: false,
    timeZone: "America/New_York",
    status: "planned",
    notes: "",
  };
  const save = vi.fn();
  render(<EventEditor event={event} onSave={save} onCancel={vi.fn()} />);
  fireEvent.change(screen.getByLabelText("事项时区"), {
    target: { value: "UTC" },
  });
  expect((screen.getByLabelText("事项开始") as HTMLInputElement).value).toBe(
    "2026-11-01T05:30",
  );
  fireEvent.change(screen.getByLabelText("事项开始"), {
    target: { value: "2026-11-01T06:30" },
  });
  fireEvent.change(screen.getByLabelText("事项时区"), {
    target: { value: "America/New_York" },
  });
  expect((screen.getByLabelText("事项开始") as HTMLInputElement).value).toBe(
    "2026-11-01T01:30",
  );
  fireEvent.click(screen.getByRole("button", { name: "保存事项" }));
  expect(save).toHaveBeenCalledWith(
    expect.objectContaining({
      start: "2026-11-01T01:30:00-05:00",
      end: event.end,
    }),
  );
});
it("saves native date input events even when the browser has not fired change", () => {
  const event: CalendarEvent = {
    id: crypto.randomUUID(),
    title: "全天事项",
    start: "2026-10-27",
    end: "2026-10-28",
    allDay: true,
    timeZone: "Asia/Shanghai",
    status: "planned",
    notes: "",
  };
  const save = vi.fn();
  render(<EventEditor event={event} onSave={save} onCancel={vi.fn()} />);
  fireEvent.input(screen.getByLabelText("事项开始"), {
    target: { value: "2026-10-31" },
  });
  fireEvent.input(screen.getByLabelText("事项结束"), {
    target: { value: "2026-11-02" },
  });
  fireEvent.click(screen.getByRole("button", { name: "保存事项" }));
  expect(save).toHaveBeenCalledWith(
    expect.objectContaining({ start: "2026-10-31", end: "2026-11-03" }),
  );
});
it("does not add an extra day when converting an exclusive-midnight timed event to all-day", () => {
  const event: CalendarEvent = {
    id: crypto.randomUUID(),
    title: "跨月事项",
    start: "2026-10-31T23:00:00+08:00",
    end: "2026-11-01T00:00:00+08:00",
    allDay: false,
    timeZone: "Asia/Shanghai",
    status: "planned",
    notes: "",
  };
  const save = vi.fn();
  render(<EventEditor event={event} onSave={save} onCancel={vi.fn()} />);
  fireEvent.click(screen.getByRole("checkbox", { name: "全天事项" }));
  expect((screen.getByLabelText("事项结束") as HTMLInputElement).value).toBe(
    "2026-10-31",
  );
  fireEvent.click(screen.getByRole("button", { name: "保存事项" }));
  expect(save).toHaveBeenCalledWith(
    expect.objectContaining({
      allDay: true,
      start: "2026-10-31",
      end: "2026-11-01",
    }),
  );
});

it("read-only calendar navigation and item inspection never mutate source", () => {
  const source = initial(),
    apply = vi.fn();
  const { container } = render(
    <CalendarBlock source={source} readOnly onApply={apply} />,
  );
  expect(screen.queryByRole("button", { name: "＋ 新增事项" })).toBeNull();
  expect(screen.queryByRole("button", { name: "导出 ICS" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "月历" }));
  expect(screen.getByText("月历占位")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "下个月" }));
  expect(apply).not.toHaveBeenCalled();
  expect(container.querySelector("form")).toBeNull();
});

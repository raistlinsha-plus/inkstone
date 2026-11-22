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
import type { CalendarDocument } from "../content/calendar";
import { scanTrackedTasks, taskLine } from "../content/tasks";
vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => false,
  invoke: async () => null,
}));
afterEach(cleanup);
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
    return (
      <>
        <button
          onClick={() =>
            setDocs((old) => old.map((d) => ({ ...d, hash: "external" })))
          }
        >
          external edit
        </button>
        <ProjectCalendar
          documents={docs}
          initialRange={initialRange}
          onOpen={open}
          onError={() => {}}
          onPatch={async (p) => {
            writes.push(p);
            setDocs((old) =>
              old.map((d) =>
                d.documentId === p.documentId
                  ? {
                      ...d,
                      content: p.content,
                      hash: String(Number(d.hash) + 1),
                    }
                  : d,
              ),
            );
          }}
        />
      </>
    );
  }
  const initialRange = {
    start: "2026-11-01",
    end: "2026-12-01",
    label: "November",
    terms: "",
  };
  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: "任务" }));
  fireEvent.change(screen.getByLabelText("新增任务保存到"), {
    target: { value: "b" },
  });
  fireEvent.click(screen.getByRole("button", { name: "新增任务" }));
  fireEvent.change(screen.getByLabelText("任务标题"), {
    target: { value: "Revise appendix" },
  });
  fireEvent.change(screen.getByLabelText("截止日"), {
    target: { value: "2026-11-25" },
  });
  fireEvent.click(screen.getByRole("button", { name: "保存任务" }));
  await waitFor(() => expect(writes).toHaveLength(1));
  expect(writes[0]).toMatchObject({ documentId: "b", expectedHash: "1" });
  expect(scanTrackedTasks(writes[0].content)[0]).toMatchObject({
    line: 3,
    due: "2026-11-25",
    done: false,
  });
  fireEvent.click(screen.getByRole("button", { name: "日历" }));
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
    due: "2026-11-25",
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
    <ProjectCalendar
      documents={[
        { documentId: "a", path: "A.md", title: "A", hash: "h", content },
      ]}
      onPatch={write}
      onOpen={vi.fn()}
      onError={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "任务" }));
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
    <ProjectCalendar
      documents={[doc]}
      onPatch={vi.fn()}
      onOpen={vi.fn()}
      onError={vi.fn()}
      onAskForHelp={help}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "任务" }));
  fireEvent.click(screen.getByRole("button", { name: "Review plan" }));
  fireEvent.click(screen.getByRole("button", { name: "请 AI 帮我拆解" }));
  expect(help).toHaveBeenCalledWith("Review plan");
  expect(screen.queryByRole("form", { name: "任务详情" })).toBeNull();
});

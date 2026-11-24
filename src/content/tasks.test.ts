import { describe, expect, it } from "vitest";
import {
  appendTrackedTasks,
  changeTrackedTask,
  scanTrackedTasks,
  taskLine,
  taskMarker,
  readTaskMarker,
  trackSourceSelection,
  taskRetrievalText,
} from "./tasks";
import { taskCalendarRows } from "../tasks/project";
const id = "73680145-4883-48e9-a79f-96f36e87de44";
describe("tracked Markdown tasks", () => {
  it("uses only first-line GFM checkboxes outside quoted or fenced examples and detects duplicate IDs", () => {
    const row = taskLine({
      id,
      title: "[Review](plan.md) **draft**",
      due: "2026-11-30",
    });
    const doc = [
      "- [ ] plain",
      "> " + row,
      "",
      "~~~md",
      row,
      "~~~",
      "",
      row,
      "  more",
      "  " + row,
    ].join("\r\n");
    const rows = scanTrackedTasks(doc);
    expect(rows.map((r) => [r.line, r.title, r.duplicate])).toEqual([
      [8, "[Review](plan.md) **draft**", true],
      [10, "[Review](plan.md) **draft**", true],
    ]);
    expect(() =>
      changeTrackedTask(doc, rows[0], { ...rows[0], done: true }),
    ).toThrow();
    expect(scanTrackedTasks(row + " trailing text")).toHaveLength(0);
  });
  it("retries an append once by ID, preserves CRLF and edits only one item", () => {
    const doc = "Title\r\n",
      draft = { id, title: "Fix **this**", due: "2026-11-30" };
    const after = appendTrackedTasks(doc, [draft, draft]);
    expect(after.split("\r\n")).toHaveLength(4);
    expect(appendTrackedTasks(after, [draft])).toBe(after);
    const row = scanTrackedTasks(after)[0];
    expect(changeTrackedTask(after, row, { ...row, done: true })).toBe(
      after.replace("[ ]", "[x]"),
    );
    expect(changeTrackedTask(after, row, null)).toBe(
      "Title\r\n\r\n- [ ] Fix **this**\r\n",
    );
    expect(() => appendTrackedTasks("~~~js\nunclosed", [draft])).toThrow();
  });
  it("rejects ambiguous metadata and validates timezone offsets", () => {
    expect(
      readTaskMarker(
        '<!--inkstone-task:v1 {"id":"' + id + '","id":"' + id + '"}-->',
      ),
    ).toBeNull();
    expect(
      readTaskMarker('<!--inkstone-task:v1 {"id":"' + id + '","due":null}-->'),
    ).toBeNull();
    expect(() => taskMarker({ id, due: "2026-02-30" })).toThrow();
    expect(() =>
      taskMarker({
        id,
        slot: {
          start: "2026-03-08T02:15:00-05:00",
          end: "2026-03-08T07:00:00-04:00",
          zone: "America/New_York",
        },
      }),
    ).toThrow();
  });
  it("projects three independent dates and hides follow-up when done", () => {
    const draft = {
      id,
      title: "Plan",
      due: "2026-11-30",
      waiting: true,
      followOn: "2026-11-26",
      slot: {
        zone: "UTC",
        start: "2026-11-24T10:00:00Z",
        end: "2026-11-24T11:00:00Z",
      },
    };
    const task = scanTrackedTasks(taskLine(draft))[0],
      document = {
        documentId: "A",
        title: "A.md",
        path: "A.md",
        content: "",
        hash: "h",
      },
      labels = { due: "D", follow: "F", slot: "S" };
    const rows = taskCalendarRows([{ task, document }], "UTC", labels);
    expect(rows.map((r) => [r.event.title, r.event.allDay])).toEqual([
      ["D · Plan", true],
      ["F · Plan", true],
      ["S · Plan", false],
    ]);
    expect(
      taskCalendarRows(
        [{ document, task: { ...task, done: true } }],
        "UTC",
        labels,
      ),
    ).toHaveLength(2);
  });
});

it("promotes an existing source checkbox without changing nested content or sending its ID to search", () => {
  const source = "- [X] 计划 🖋\r\n  - [ ] 子项\r\n";
  const ch = trackSourceSelection(source, 7, 7, "New task");
  const result = source.slice(0, ch.from) + ch.insert + source.slice(ch.to);
  expect(scanTrackedTasks(result)).toMatchObject([
    { title: "计划 🖋", done: true },
  ]);
  expect(taskRetrievalText(result)).toBe(source);
  expect(() =>
    trackSourceSelection("~~~md\n- [ ] example\n~~~", 10, 10, "New"),
  ).toThrow();
});

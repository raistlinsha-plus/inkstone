import {
  addDays,
  type CalendarDocument,
  type CalendarEvent,
} from "../content/calendar";
import { scanTrackedTasks, type TrackedTask } from "../content/tasks";
export interface ProjectTask {
  document: CalendarDocument;
  task: TrackedTask;
}
export function projectTasks(documents: CalendarDocument[]) {
  return documents.flatMap((document) =>
    (document.taskHash === document.hash && document.taskRows
      ? document.taskRows
      : scanTrackedTasks(document.content)
    ).map((task) => ({ document, task })),
  );
}
export type TaskFilter = "open" | "unscheduled" | "due" | "waiting" | "done";
export function filterTasks(
  rows: ProjectTask[],
  filter: TaskFilter,
  today: string,
) {
  const horizon = addDays(today, 8);
  return rows
    .filter(({ task }) => {
      if (filter === "done") return task.done;
      if (task.done) return false;
      if (filter === "unscheduled") return !task.slot;
      if (filter === "due") return !!task.due && task.due < horizon;
      if (filter === "waiting") return task.waiting;
      return true;
    })
    .sort(
      (a, b) =>
        (
          a.task.followOn ??
          a.task.due ??
          a.task.slot?.start ??
          "~"
        ).localeCompare(
          b.task.followOn ?? b.task.due ?? b.task.slot?.start ?? "~",
        ) ||
        a.document.title.localeCompare(b.document.title) ||
        a.task.line - b.task.line,
    );
}
export function taskCalendarRows(
  rows: ProjectTask[],
  zone: string,
  labels: { due: string; follow: string; slot: string },
) {
  return rows.flatMap((row) => {
    const { task, document } = row;
    if (task.duplicate) return [];
    const result: {
      key: string;
      event: CalendarEvent;
      source: string;
      origin: ProjectTask;
    }[] = [];
    function add(
      kind: keyof typeof labels,
      start: string,
      end: string,
      timeZone: string,
      allDay: boolean,
    ) {
      const key = "task:" + document.documentId + ":" + task.id + ":" + kind;
      result.push({
        key,
        origin: row,
        source: document.title,
        event: {
          id: key,
          title: labels[kind] + " · " + task.title,
          start,
          end,
          timeZone,
          allDay,
          status: task.done ? "done" : "planned",
          notes: "",
        },
      });
    }
    if (task.due) add("due", task.due, addDays(task.due, 1), zone, true);
    if (!task.done && task.waiting && task.followOn)
      add("follow", task.followOn, addDays(task.followOn, 1), zone, true);
    if (task.slot)
      add("slot", task.slot.start, task.slot.end, task.slot.zone, false);
    return result;
  });
}

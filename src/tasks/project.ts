import {
  addDays,
  dateInZone,
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
export type TaskView =
  "today" | "upcoming" | "all" | "done" | "waiting" | "unscheduled" | "chat";

export function taskDates(task: TrackedTask, zone: string) {
  const start = task.slot && dateInZone(new Date(task.slot.start), zone);
  // End is exclusive, including a slot ending exactly at midnight.
  const end =
    task.slot &&
    dateInZone(new Date(new Date(task.slot.end).getTime() - 1), zone);
  return {
    due: task.due,
    follow: task.waiting ? task.followOn : undefined,
    start,
    end,
  };
}

export function taskViewState(
  { task, document }: ProjectTask,
  today: string,
  zone: string,
) {
  const { due, follow, start, end } = taskDates(task, zone);
  const overdue =
    !task.done && Boolean((due && due < today) || (follow && follow < today));
  const activeToday =
    due === today ||
    follow === today ||
    Boolean(start && end && start <= today && end >= today);
  const future = [due, follow, start]
    .filter((date): date is string => !!date && date > today)
    .sort()[0];
  const fromChat = document.chatTaskIds?.includes(task.id) ?? false;
  return {
    overdue,
    today: overdue || activeToday,
    upcoming: !task.done && !!future,
    all: true,
    done: task.done,
    waiting: !task.done && !!task.waiting,
    unscheduled: !task.done && !task.slot,
    chat: fromChat,
    next: future,
    sort: [due, follow, start].filter(Boolean).sort()[0] ?? "~",
  };
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

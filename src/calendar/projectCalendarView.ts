import { Temporal } from "temporal-polyfill";
import { addDays, monthRange, type CalendarMode } from "../content/calendar";

export type WorkspaceCalendarView = CalendarMode | "week";

export function calendarViewRange(view: WorkspaceCalendarView, date: string) {
  if (view !== "week") return monthRange(date);
  const monday = addDays(date, 1 - Temporal.PlainDate.from(date).dayOfWeek);
  return { start: monday, end: addDays(monday, 7), label: "", terms: "" };
}

export function readCalendarView(space?: string): WorkspaceCalendarView {
  try {
    const value =
      space && localStorage.getItem("inkstone.calendar.view." + space);
    if (value === "agenda" || value === "month") return value;
  } catch {
    // Calendar navigation also works with browser storage disabled.
  }
  return "week";
}

export function saveCalendarView(
  space: string | undefined,
  view: WorkspaceCalendarView,
) {
  if (!space) return;
  try {
    localStorage.setItem("inkstone.calendar.view." + space, view);
  } catch {
    // The view is kept for the duration of this visit.
  }
}

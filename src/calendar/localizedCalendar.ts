import type { CalendarEvent } from "../content/calendar";
import { addDays, monthRange } from "../content/calendar";
import type { Language } from "../i18n";

export function calendarMonthLabel(
  anchor: string,
  rangeLabel: string | undefined,
  region: string,
) {
  const month = monthRange(anchor);
  if (rangeLabel && rangeLabel !== month.label) return rangeLabel;
  return new Intl.DateTimeFormat(region, {
    year: "numeric",
    month: "long",
    timeZone: "UTC",
  }).format(new Date(month.start + "T12:00:00Z"));
}

export function calendarEventLabel(
  event: CalendarEvent,
  zone: string,
  region: string,
  language: Language,
) {
  // Floating all-day dates carry no offset. Format in UTC so changing the
  // system region or the display time zone cannot move them to another day.
  if (event.allDay) {
    const date = new Intl.DateTimeFormat(region, {
      dateStyle: "medium",
      timeZone: "UTC",
    });
    const start = date.format(new Date(event.start + "T12:00:00Z"));
    const inclusiveEnd = addDays(event.end, -1);
    const end = date.format(new Date(inclusiveEnd + "T12:00:00Z"));
    return `${inclusiveEnd === event.start ? start : start + " – " + end} · ${language === "en" ? "All day" : "全天"}`;
  }
  const formatter = new Intl.DateTimeFormat(region, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: zone,
  });
  return formatter.formatRange(new Date(event.start), new Date(event.end));
}

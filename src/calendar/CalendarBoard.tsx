import { calendarEventLabel } from "./localizedCalendar";
import { msg } from "../i18n";
import { useLocale } from "../i18n";
import { lazy, Suspense, useEffect, useRef } from "react";
import type { CalendarRef } from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/react/daygrid";
import timeGridPlugin from "@fullcalendar/react/timegrid";
import interactionPlugin from "@fullcalendar/react/interaction";
import themePlugin from "@fullcalendar/react/themes/monarch";
import zhCn from "@fullcalendar/react/locales/zh-cn";
import { type CalendarEvent } from "../content/calendar";
import "@fullcalendar/react/skeleton.css";
import "@fullcalendar/react/themes/monarch/theme.css";
import "@fullcalendar/react/themes/monarch/palettes/green.css";
import "./calendar.css";
const FullCalendar = lazy(() => import("@fullcalendar/react"));
export interface CalendarRow {
  key: string;
  event: CalendarEvent;
  source?: string;
  slotSourceHash?: string;
}
interface Props {
  rows: CalendarRow[];
  anchor: string;
  timeZone: string;
  mode?: "month" | "week";
  onDate: (date: string, time?: string, allDay?: boolean) => void;
  onEdit: (key: string) => void;
  onMoveSlot?: (
    key: string,
    expectedHash: string,
    start: string,
    end: string,
  ) => void;
  readOnly?: boolean;
}
export default function CalendarBoard({
  rows,
  anchor,
  timeZone,
  onDate,
  onEdit,
  onMoveSlot,
  mode = "month",
  readOnly = false,
}: Props) {
  const { language, t } = useLocale();
  const calendar = useRef<CalendarRef>(null);
  useEffect(() => {
    calendar.current?.getApi().gotoDate(anchor);
  }, [anchor]);
  function moveSlot(info: {
    event: { id: string; startStr: string; endStr: string; allDay: boolean };
    oldEvent: { extendedProps: Record<string, unknown> };
    revert: () => void;
  }) {
    const { id, startStr, endStr, allDay } = info.event;
    const hash = info.oldEvent.extendedProps.slotSourceHash;
    // Repaint from the Markdown snapshot only after its guarded write succeeds.
    info.revert();
    if (!allDay && startStr && endStr && typeof hash === "string")
      onMoveSlot?.(id, hash, startStr, endStr);
  }
  return (
    <div
      className={mode === "week" ? "inkstone-week" : "inkstone-month"}
      aria-label={
        mode === "week" ? t("事项周历", "Week calendar") : msg("事项月历")
      }
    >
      <Suspense
        fallback={
          <p className="calendar-empty">
            {t("正在打开日历…", "Opening calendar…")}
          </p>
        }
      >
        <FullCalendar
          key={mode}
          ref={calendar}
          plugins={[
            themePlugin,
            dayGridPlugin,
            timeGridPlugin,
            interactionPlugin,
          ]}
          initialView={mode === "week" ? "timeGridWeek" : "dayGridMonth"}
          initialDate={anchor}
          timeZone={timeZone}
          locale={language === "zh-CN" ? zhCn : "en"}
          firstDay={1}
          headerToolbar={false}
          height={mode === "week" ? "100%" : "auto"}
          nowIndicator={mode === "week"}
          scrollTime="07:45:00"
          slotDuration="01:00:00"
          snapDuration="00:15:00"
          slotMinHeight={44}
          allDayText={t("全天", "All day")}
          timedText={t("分时日程", "Timed")}
          eventInteractive
          slotHeaderFormat={{
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
          }}
          dayHeaderFormat={
            mode === "week"
              ? { weekday: "short", day: "numeric" }
              : { weekday: "short" }
          }
          fixedWeekCount={false}
          dayMaxEvents={3}
          eventDisplay="block"
          editable={false}
          events={rows.map((row) => ({
            id: row.key,
            title: row.event.title,
            start: row.event.start,
            end: row.event.end,
            allDay: row.event.allDay,
            editable:
              mode === "week" &&
              !!onMoveSlot &&
              row.slotSourceHash !== undefined &&
              row.event.status !== "done",
            className: [
              `calendar-status-${row.event.status}`,
              row.key.startsWith("task:") ? "calendar-task-marker" : "",
              row.key.startsWith("task:")
                ? row.event.allDay
                  ? "calendar-task-date"
                  : "calendar-task-slot"
                : "calendar-regular-event",
            ].join(" "),
            extendedProps: {
              source: row.source,
              slotSourceHash: row.slotSourceHash,
            },
          }))}
          dateClick={(info) =>
            onDate(
              info.dateStr.slice(0, 10),
              info.allDay ? undefined : info.dateStr.slice(11, 16),
              info.allDay,
            )
          }
          eventAllow={(span) => !span.allDay}
          eventDrop={moveSlot}
          eventResize={moveSlot}
          eventClick={(info) => onEdit(info.event.id)}
          eventTimeFormat={{
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
          }}
          eventDidMount={(info) => {
            info.el.setAttribute(
              "aria-label",
              `${info.event.title}，${info.event.allDay ? t("全天", "All day") : info.timeText}，${readOnly ? t("查看详情", "View details") : t("点击编辑", "Edit")}`,
            );
          }}
        />
      </Suspense>
    </div>
  );
}
export function CalendarAgenda({
  rows,
  timeZone,
  onEdit,
  onOpen,
  readOnly = false,
}: {
  rows: CalendarRow[];
  timeZone: string;
  onEdit: (key: string) => void;
  onOpen?: (key: string) => void;
  readOnly?: boolean;
}) {
  const { language, region, t } = useLocale();
  if (!rows.length)
    return (
      <p className="calendar-empty">
        {readOnly
          ? msg("此日期范围暂无事项，可以选择其他日期。")
          : msg("此日期范围暂无事项。可以选择日期或新增事项。")}
      </p>
    );
  return (
    <ol className="calendar-agenda" aria-label={msg("完整日程清单")}>
      {rows.map((row) => (
        <li
          key={row.key}
          className={`calendar-agenda-row calendar-status-${row.event.status}`}
        >
          <button
            className="calendar-event-open"
            onClick={() => onEdit(row.key)}
          >
            <span className="calendar-event-time">
              {calendarEventLabel(row.event, timeZone, region, language)}
            </span>
            <strong>{row.event.title}</strong>
            <span className="calendar-event-meta">
              {
                {
                  planned: msg("待办"),
                  done: msg("已完成"),
                  cancelled: msg("已取消"),
                }[row.event.status]
              }
              {row.event.timeZone !== timeZone
                ? t(
                    ` · 原时区 ${row.event.timeZone}`,
                    ` · Original time zone: ${row.event.timeZone}`,
                  )
                : ""}
            </span>
            {row.event.notes && (
              <span className="calendar-event-notes">{row.event.notes}</span>
            )}
          </button>
          {row.source && (
            <button
              className="calendar-source"
              onClick={() => onOpen?.(row.key)}
              title={msg("回到事项所在文档")}
            >
              {row.source} ↗
            </button>
          )}
        </li>
      ))}
    </ol>
  );
}

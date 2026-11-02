import { lazy, Suspense, useEffect, useRef } from "react";
import type { CalendarRef } from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/react/daygrid";
import interactionPlugin from "@fullcalendar/react/interaction";
import themePlugin from "@fullcalendar/react/themes/monarch";
import zhCn from "@fullcalendar/react/locales/zh-cn";
import { eventTimeLabel, type CalendarEvent } from "../content/calendar";
import "@fullcalendar/react/skeleton.css";
import "@fullcalendar/react/themes/monarch/theme.css";
import "@fullcalendar/react/themes/monarch/palettes/green.css";
import "./calendar.css";
const FullCalendar = lazy(() => import("@fullcalendar/react"));
export interface CalendarRow {
  key: string;
  event: CalendarEvent;
  source?: string;
}
interface Props {
  rows: CalendarRow[];
  anchor: string;
  timeZone: string;
  onDate: (date: string) => void;
  onEdit: (key: string) => void;
  readOnly?: boolean;
}
export default function CalendarBoard({
  rows,
  anchor,
  timeZone,
  onDate,
  onEdit,
  readOnly = false,
}: Props) {
  const calendar = useRef<CalendarRef>(null);
  useEffect(() => {
    calendar.current?.getApi().gotoDate(anchor);
  }, [anchor]);
  return (
    <div className="inkstone-month" aria-label="事项月历">
      <Suspense fallback={<p className="calendar-empty">正在准备本地月历…</p>}>
        <FullCalendar
          ref={calendar}
          plugins={[themePlugin, dayGridPlugin, interactionPlugin]}
          initialView="dayGridMonth"
          initialDate={anchor}
          timeZone={timeZone}
          locale={zhCn}
          firstDay={1}
          headerToolbar={false}
          height="auto"
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
            classNames: [`calendar-status-${row.event.status}`],
            extendedProps: { source: row.source },
          }))}
          dateClick={(info) => onDate(info.dateStr.slice(0, 10))}
          eventClick={(info) => onEdit(info.event.id)}
          eventTimeFormat={{
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
          }}
          eventDidMount={(info) => {
            info.el.setAttribute(
              "aria-label",
              `${info.event.title}，${info.event.allDay ? "全天" : info.timeText}，${readOnly ? "查看详情" : "点击编辑"}`,
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
  if (!rows.length)
    return (
      <p className="calendar-empty">
        {readOnly
          ? "此日期范围暂无事项，可以选择其他日期。"
          : "此日期范围暂无事项。可以选择日期或新增事项。"}
      </p>
    );
  return (
    <ol className="calendar-agenda" aria-label="完整日程清单">
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
              {eventTimeLabel(row.event, timeZone)}
            </span>
            <strong>{row.event.title}</strong>
            <span className="calendar-event-meta">
              {
                { planned: "待办", done: "已完成", cancelled: "已取消" }[
                  row.event.status
                ]
              }
              {row.event.timeZone !== timeZone
                ? ` · 原时区 ${row.event.timeZone}`
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
              title="回到事项所在文档"
            >
              {row.source} ↗
            </button>
          )}
        </li>
      ))}
    </ol>
  );
}

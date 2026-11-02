import { useEffect, useMemo, useState } from "react";
import {
  addDays,
  calendarIcs,
  currentTimeZone,
  dateInZone,
  deleteCalendarEvent,
  eventDay,
  filterCalendarEvents,
  inspectCalendar,
  monthRange,
  saveCalendarEvent,
  setCalendarView,
  type CalendarEvent,
} from "../content/calendar";
import CalendarBoard, { CalendarAgenda } from "./CalendarBoard";
import CalendarTools from "./CalendarTools";
import EventEditor from "./EventEditor";
import { exportCalendar } from "./export";
import { useCalendarFocus } from "./useCalendarFocus";
import "./calendar.css";
interface Props {
  source: string;
  onApply?: (base: string, next: string) => void;
  readOnly?: boolean;
  onError?: (message: string) => void;
  onEditingChange?: (active: boolean) => void;
}
export default function CalendarBlock({
  source,
  onApply,
  onError,
  onEditingChange,
  readOnly = false,
}: Props) {
  const state = useMemo(() => inspectCalendar(source), [source]);
  const zone = state.data?.timeZone ?? currentTimeZone();
  const [anchor, setAnchor] = useState(() => dateInZone(new Date(), zone));
  const [editing, setEditing] = useState<{
    base: string;
    event?: CalendarEvent;
    date?: string;
  } | null>(null);
  const [readingView, setReadingView] = useState<"agenda" | "month" | null>(
    null,
  );
  const [inspecting, setInspecting] = useState<CalendarEvent | null>(null);
  const [error, setError] = useState("");
  const focus = useCalendarFocus();
  const finishEditing = () => {
    setEditing(null);
    focus.restore();
  };
  const editingActive = editing !== null;
  useEffect(() => {
    onEditingChange?.(editingActive);
  }, [editingActive, onEditingChange]);
  const apply = (base: string, next: string) => {
    try {
      if (readOnly || !onApply) return false;
      onApply(base, next);
      setError("");
      return true;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(message);
      onError?.(message);
      return false;
    }
  };
  if (!state.data)
    return (
      <div className="inkstone-calendar calendar-invalid" role="alert">
        <strong>日历内容暂时无法显示</strong>
        <p>{state.error}</p>
        <p>
          {readOnly
            ? "原文仍可复制或保存为文档后修正。"
            : "原文仍可保存，点击内容块的“编辑代码”修正后会重新显示。"}
        </p>
      </div>
    );
  const data = state.data,
    range = monthRange(anchor);
  const rows = filterCalendarEvents(
    data.events.map((event) => ({ key: event.id, event })),
    range,
    "all",
    "",
    zone,
  );
  const edit = (id: string) => {
    focus.remember();
    const event = data.events.find((e) => e.id === id);
    if (event) {
      if (readOnly) setInspecting(event);
      else setEditing({ base: source, event });
    }
  };
  const save = (event: CalendarEvent) => {
    if (!editing) return;
    const next = saveCalendarEvent(editing.base, event);
    if (apply(editing.base, next)) {
      setAnchor(eventDay(event, zone));
      finishEditing();
    }
  };
  return (
    <section
      ref={focus.scope}
      className="inkstone-calendar"
      aria-label="正文日程日历"
    >
      <CalendarTools
        view={readOnly ? (readingView ?? data.view) : data.view}
        onView={(view) => {
          if (readOnly) setReadingView(view);
          else if (view !== data.view)
            apply(source, setCalendarView(source, view));
        }}
        anchor={anchor}
        onAnchor={setAnchor}
        timeZone={zone}
        onNew={
          readOnly
            ? undefined
            : () => {
                focus.remember();
                setEditing({ base: source, date: anchor });
              }
        }
        onExport={
          readOnly
            ? undefined
            : () => {
                void exportCalendar(
                  calendarIcs(
                    data.events.map((event) => ({ ...event, uid: event.id })),
                  ),
                ).catch((e) => {
                  setError(String(e));
                  onError?.(String(e));
                });
              }
        }
      />
      <div className="calendar-range-description">
        <span>
          {rows.length} 个事项 · {zone}
        </span>
        <span>
          当前月：{range.start} 至 {addDays(range.end, -1)}
        </span>
      </div>
      {!readOnly && editing && (
        <EventEditor
          key={editing.event?.id ?? editing.date ?? "new"}
          event={editing.event}
          date={editing.date}
          timeZone={zone}
          stale={editing.base !== source}
          onSave={save}
          onCancel={() => {
            finishEditing();
            setError("");
          }}
          onDelete={
            editing.event
              ? () => {
                  if (
                    apply(
                      editing.base,
                      deleteCalendarEvent(editing.base, editing.event!.id),
                    )
                  )
                    finishEditing();
                }
              : undefined
          }
        />
      )}
      {readOnly && inspecting && (
        <section className="calendar-inspection" aria-label="事项详情">
          <strong>{inspecting.title}</strong>
          <p>
            {inspecting.start} — {inspecting.end} · {inspecting.timeZone}
          </p>
          {inspecting.notes && <p>{inspecting.notes}</p>}
          <button onClick={() => setInspecting(null)}>关闭详情</button>
        </section>
      )}
      {(readOnly ? (readingView ?? data.view) : data.view) === "month" ? (
        <CalendarBoard
          rows={rows}
          anchor={anchor}
          timeZone={zone}
          readOnly={readOnly}
          onDate={(date) => {
            if (readOnly) {
              setAnchor(date);
              return;
            }
            focus.remember();
            setEditing({ base: source, date });
          }}
          onEdit={edit}
        />
      ) : (
        <CalendarAgenda
          rows={rows}
          timeZone={zone}
          onEdit={edit}
          readOnly={readOnly}
        />
      )}
      {error && (
        <p className="calendar-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

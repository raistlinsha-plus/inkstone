import { msg } from "../i18n";
import { Temporal } from "temporal-polyfill";
import { rememberPlanningForm, type EventEditing } from "./planningSession";
import { isImeEvent } from "../platform/ime";
import { useEffect, useRef, useState } from "react";
import {
  addDays,
  currentTimeZone,
  dateInZone,
  dateTimeInput,
  eventEndDay,
  instantInZone,
  parseCalendar,
  calendarTemplate,
  validTimeZone,
  zonedInput,
  type CalendarEvent,
} from "../content/calendar";
interface Props {
  form?: EventEditing["form"];
  event?: CalendarEvent;
  date?: string;
  initialTime?: string;
  initialAllDay?: boolean;
  timeZone?: string;
  busy?: boolean;
  stale?: boolean;
  onSave: (event: CalendarEvent) => void | Promise<void>;
  onDelete?: () => void | Promise<void>;
  onCancel: () => void;
}
const zones = [
  "Asia/Shanghai",
  "Asia/Hong_Kong",
  "Asia/Taipei",
  "Asia/Tokyo",
  "Asia/Singapore",
  "UTC",
  "America/New_York",
  "America/Los_Angeles",
  "Europe/London",
  "Europe/Berlin",
  "Australia/Sydney",
];
export default function EventEditor({
  form,
  event,
  date,
  initialTime = "09:00",
  initialAllDay = false,
  timeZone = currentTimeZone(),
  busy = false,
  stale = false,
  onSave,
  onDelete,
  onCancel,
}: Props) {
  const saved = form?.values;
  const initialDate =
    date ??
    (event ? event.start.slice(0, 10) : dateInZone(new Date(), timeZone));
  const [title, setTitle] = useState(saved?.title ?? event?.title ?? "");
  const [zone, setZone] = useState(saved?.zone ?? event?.timeZone ?? timeZone);
  const [allDay, setAllDay] = useState(
    saved?.allDay ?? event?.allDay ?? initialAllDay,
  );
  const [start, setStart] = useState(
    () =>
      saved?.start ??
      (event
        ? event.allDay
          ? event.start
          : dateTimeInput(event.start, event.timeZone)
        : initialAllDay
          ? initialDate
          : initialDate + "T" + initialTime),
  );
  const [end, setEnd] = useState(
    () =>
      saved?.end ??
      (event
        ? event.allDay
          ? addDays(event.end, -1)
          : dateTimeInput(event.end, event.timeZone)
        : initialAllDay
          ? initialDate
          : Temporal.PlainDateTime.from(initialDate + "T" + initialTime)
              .add({ hours: 1 })
              .toString({ smallestUnit: "minute" })),
  );
  const [startInstant, setStartInstant] = useState<string | null>(
    saved ? saved.startInstant : event && !event.allDay ? event.start : null,
  );
  const [endInstant, setEndInstant] = useState<string | null>(
    saved ? saved.endInstant : event && !event.allDay ? event.end : null,
  );
  const [status, setStatus] = useState(
    saved?.status ?? event?.status ?? "planned",
  );
  const [notes, setNotes] = useState(saved?.notes ?? event?.notes ?? "");
  useEffect(() => {
    rememberPlanningForm(form, {
      title,
      zone,
      allDay,
      start,
      end,
      startInstant,
      endInstant,
      status,
      notes,
    });
  }, [
    form,
    title,
    zone,
    allDay,
    start,
    end,
    startInstant,
    endInstant,
    status,
    notes,
  ]);
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [saving, setSaving] = useState(false);
  const submitting = useRef(false);
  const waiting = busy || saving;
  const changeStart = (value: string) => {
    setStart(value);
    setStartInstant(null);
  };
  const changeEnd = (value: string) => {
    setEnd(value);
    setEndInstant(null);
  };
  const timedValue = (value: string, field: "start" | "end") => {
    const preserved = field === "start" ? startInstant : endInstant;
    if (preserved && dateTimeInput(preserved, zone) === value) {
      if (event?.timeZone === zone && preserved === event[field])
        return preserved;
      return instantInZone(preserved, zone);
    }
    return zonedInput(value, zone);
  };
  const save = async () => {
    if (waiting || submitting.current) return;
    submitting.current = true;
    setError("");
    setSaving(true);
    try {
      if (stale)
        throw Error("原文已变化，请取消并重新打开事项，未写入旧修改。");
      const candidate: CalendarEvent = {
        ...event,
        id: event?.id ?? crypto.randomUUID(),
        title: title.trim(),
        timeZone: zone,
        allDay,
        start: allDay ? start : timedValue(start, "start"),
        end: allDay ? addDays(end, 1) : timedValue(end, "end"),
        status,
        notes,
      };
      parseCalendar(
        JSON.stringify({
          ...JSON.parse(calendarTemplate()),
          events: [candidate],
        }),
      );
      await onSave(candidate);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      submitting.current = false;
      setSaving(false);
    }
  };
  const changeAllDay = (value: boolean) => {
    let lastDay = end.slice(0, 10);
    if (value) {
      try {
        lastDay = addDays(
          eventEndDay({
            allDay: false,
            end: timedValue(end, "end"),
            timeZone: zone,
          }),
          -1,
        );
      } catch {
        /* Incomplete user input remains for validation. */
      }
    }
    setAllDay(value);
    setStartInstant(null);
    setEndInstant(null);
    if (value) {
      setStart(start.slice(0, 10));
      setEnd(lastDay);
    } else {
      setStart(start.slice(0, 10) + "T09:00");
      setEnd(end.slice(0, 10) + "T10:00");
    }
  };
  const changeZone = (value: string) => {
    if (!allDay && validTimeZone(zone) && validTimeZone(value)) {
      try {
        const instant = timedValue(start, "start");
        setStart(dateTimeInput(instant, value));
        setStartInstant(instant);
      } catch {
        /* Incomplete user input remains for validation. */
      }
      try {
        const instant = timedValue(end, "end");
        setEnd(dateTimeInput(instant, value));
        setEndInstant(instant);
      } catch {
        /* Incomplete user input remains for validation. */
      }
    }
    setZone(value);
  };
  return (
    <form
      className="calendar-event-editor"
      aria-label={event ? msg("编辑事项") : msg("新增事项")}
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape" && !waiting && !isImeEvent(e.nativeEvent)) {
          e.stopPropagation();
          onCancel();
        }
      }}
    >
      <div className="calendar-form-heading">
        <h3>{event ? msg("编辑事项") : msg("新增事项")}</h3>
        <button
          type="button"
          onClick={onCancel}
          disabled={waiting}
          aria-label={msg("关闭事项编辑")}
        >
          {msg("关闭")}
        </button>
      </div>
      {stale && (
        <p className="calendar-error" role="alert">
          {msg("原文已变化。请取消并重新选择事项，避免覆盖新内容。")}
        </p>
      )}
      <label>
        {msg("事项标题")}
        <input
          aria-label={msg("事项标题")}
          autoFocus
          required
          maxLength={400}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          disabled={waiting}
        />
      </label>
      <label className="calendar-checkbox">
        <input
          type="checkbox"
          checked={allDay}
          onChange={(e) => changeAllDay(e.target.checked)}
          disabled={waiting}
        />
        {msg("全天事项")}
      </label>
      <div className="calendar-form-grid">
        <label>
          {msg("开始")}
          <input
            aria-label={msg("事项开始")}
            type={allDay ? "date" : "datetime-local"}
            value={start}
            onInput={(e) => changeStart(e.currentTarget.value)}
            onChange={(e) => changeStart(e.target.value)}
            required
            disabled={waiting}
          />
        </label>
        <label>
          {allDay ? msg("结束日期（含当天）") : msg("结束")}
          <input
            aria-label={msg("事项结束")}
            type={allDay ? "date" : "datetime-local"}
            value={end}
            onInput={(e) => changeEnd(e.currentTarget.value)}
            onChange={(e) => changeEnd(e.target.value)}
            required
            disabled={waiting}
          />
        </label>
        <label>
          {msg("时区")}
          <select
            aria-label={msg("事项时区")}
            value={zone}
            onChange={(e) => changeZone(e.target.value)}
            disabled={waiting}
          >
            {[...new Set([zone, ...zones])].map((tz) => (
              <option key={tz} value={tz}>
                {tz}
              </option>
            ))}
          </select>
        </label>
        <label>
          {msg("状态")}
          <select
            aria-label={msg("事项状态")}
            value={status}
            onChange={(e) =>
              setStatus(e.target.value as CalendarEvent["status"])
            }
            disabled={waiting}
          >
            <option value="planned">{msg("待办")}</option>
            <option value="done">{msg("已完成")}</option>
            <option value="cancelled">{msg("已取消")}</option>
          </select>
        </label>
      </div>
      <label>
        {msg("备注")}
        <textarea
          aria-label={msg("事项备注")}
          value={notes}
          maxLength={40_000}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          disabled={waiting}
        />
      </label>
      {error && (
        <p role="alert" className="calendar-error">
          {error}
        </p>
      )}
      <div className="calendar-form-actions">
        <button type="button" onClick={onCancel} disabled={waiting}>
          {msg("取消")}
        </button>
        <button
          type="submit"
          className="calendar-primary"
          disabled={waiting || stale}
        >
          {waiting ? msg("正在保存…") : msg("保存事项")}
        </button>
        {onDelete && (
          <button
            type="button"
            className="calendar-danger"
            disabled={waiting || stale}
            onClick={() => setConfirmDelete(true)}
          >
            {msg("删除事项")}
          </button>
        )}
      </div>
      {confirmDelete && (
        <div className="calendar-delete-confirm" role="alert">
          <span>{msg("删除此事项？可通过文档撤销恢复。")}</span>
          <button
            type="button"
            onClick={() => setConfirmDelete(false)}
            disabled={waiting}
          >
            {msg("保留")}
          </button>
          <button
            type="button"
            className="calendar-danger"
            disabled={waiting || stale}
            onClick={async () => {
              if (waiting || submitting.current) return;
              submitting.current = true;
              setSaving(true);
              try {
                await onDelete?.();
              } catch (e) {
                setError(String(e));
              } finally {
                submitting.current = false;
                setSaving(false);
              }
            }}
          >
            {msg("确认删除事项")}
          </button>
        </div>
      )}
    </form>
  );
}

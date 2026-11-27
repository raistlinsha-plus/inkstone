import {
  rememberPlanningForm,
  type TaskEditing,
} from "../calendar/planningSession";
import { useEffect, useRef, useState } from "react";
import {
  CalendarClock,
  ChevronRight,
  ExternalLink,
  FileText,
  Sparkles,
} from "lucide-react";
import "./task-detail.css";
import {
  currentTimeZone,
  dateInZone,
  dateTimeInput,
  zonedInput,
  type CalendarDocument,
} from "../content/calendar";
import {
  appendTrackedTasks,
  changeTrackedTask,
  taskMarker,
  type TaskDraft,
} from "../content/tasks";
import type { CalendarPatch } from "../calendar/ProjectCalendar";
import { translate as t, useLocale } from "../i18n";
import type { ProjectTask } from "./project";
import { isImeEvent } from "../platform/ime";
import TaskOrigin from "./TaskOrigin";

function TaskDateInput({
  type = "date",
  value,
  onChange,
  hint,
}: {
  type?: "date" | "datetime-local";
  value: string;
  onChange: (value: string) => void;
  hint: string;
}) {
  return (
    <span className="task-date-control">
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {!value && (
        <span className="task-date-hint" data-hint={hint} aria-hidden="true" />
      )}
    </span>
  );
}

export default function TaskForm({
  form,
  document: doc,
  current,
  origin,
  onPatch,
  onClose,
  busy,
  onCalendar,
  onAskForHelp,
  onOpenSource,
  openSourceLabel,
}: {
  form?: TaskEditing["form"];
  document: CalendarDocument;
  current?: CalendarDocument;
  origin?: ProjectTask;
  onPatch: (p: CalendarPatch) => Promise<void>;
  onClose: () => void;
  busy: boolean;
  onCalendar?: (day: string) => void;
  onAskForHelp?: (task: TaskDraft) => void;
  onOpenSource?: () => void;
  openSourceLabel?: string;
}) {
  useLocale();
  const task = origin?.task;
  const saved = form?.values;
  const [id] = useState(() => task?.id ?? crypto.randomUUID());
  const [title, setTitle] = useState(saved?.title ?? task?.title ?? "");
  const [due, setDue] = useState(saved?.due ?? task?.due ?? "");
  const [waiting, setWaiting] = useState(
    saved?.waiting ?? task?.waiting ?? false,
  );
  const [followOn, setFollowOn] = useState(
    saved?.followOn ?? task?.followOn ?? "",
  );
  const [zone, setZone] = useState(
    saved?.zone ?? task?.slot?.zone ?? currentTimeZone(),
  );
  const [start, setStart] = useState(
    saved?.start ??
      (task?.slot ? dateTimeInput(task.slot.start, task.slot.zone) : ""),
  );
  const [end, setEnd] = useState(
    saved?.end ??
      (task?.slot ? dateTimeInput(task.slot.end, task.slot.zone) : ""),
  );
  const [showSlotOnOpen] = useState(() =>
    Boolean(task?.slot || saved?.start || saved?.end),
  );
  const [done, setDone] = useState(saved?.done ?? task?.done ?? false);
  useEffect(() => {
    rememberPlanningForm(form, {
      title,
      due,
      done,
      waiting,
      followOn,
      start,
      end,
      zone,
    });
  }, [form, title, due, done, waiting, followOn, start, end, zone]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const submitting = useRef(false);
  const stale = !current || current.hash !== doc.hash;
  async function write(
    action: "save" | "calendar" | "untrack" | "rekey" | "help",
  ) {
    if (busy || submitting.current || stale) return;
    submitting.current = true;
    setSaving(true);
    setError("");
    try {
      let content: string;
      let calendarDay: string | undefined;
      let helpDraft: TaskDraft | undefined;
      if (action === "rekey" && task?.duplicate) {
        content =
          doc.content.slice(0, task.markerFrom) +
          taskMarker({ ...task, id: crypto.randomUUID() }) +
          doc.content.slice(task.markerTo);
      } else if (action === "untrack" && task)
        content = changeTrackedTask(doc.content, task, null);
      else {
        if (Boolean(start) !== Boolean(end))
          throw Error(
            t(
              "请同时填写开始和结束时间。",
              "Enter both the start and end of the time slot.",
            ),
          );
        const instant = (field: "start" | "end", value: string) =>
          task?.slot?.zone === zone &&
          dateTimeInput(task.slot[field], zone) === value
            ? task.slot[field]
            : zonedInput(value, zone);
        const draft: TaskDraft = {
          id,
          title: title.trim(),
          due: due || undefined,
          done,
          waiting: waiting || undefined,
          followOn: waiting && followOn ? followOn : undefined,
          slot:
            start && end
              ? {
                  start: instant("start", start),
                  end: instant("end", end),
                  zone,
                }
              : undefined,
        };
        if (action === "help") helpDraft = draft;
        if (action === "calendar")
          calendarDay = draft.slot
            ? dateInZone(new Date(draft.slot.start))
            : (draft.due ?? draft.followOn);
        content = task
          ? changeTrackedTask(doc.content, task, draft)
          : appendTrackedTasks(doc.content, [draft]);
      }
      if (content !== doc.content)
        await onPatch({
          documentId: doc.documentId,
          expectedHash: doc.hash,
          content,
        });
      if (helpDraft) {
        onAskForHelp?.(helpDraft);
        return;
      }
      onClose();
      if (calendarDay) onCalendar?.(calendarDay);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
      submitting.current = false;
    }
  }
  const locked = busy || saving || stale;
  const sourceLabel = openSourceLabel ?? t("打开原文", "Open source document");
  const source = (
    <>
      <FileText size={14} aria-hidden="true" />
      <span>
        {doc.title}
        {task ? " · L" + task.line : ""}
      </span>
    </>
  );
  return (
    <form
      className="task-detail-form"
      aria-label={t("任务详情", "Task details")}
      onSubmit={(e) => {
        e.preventDefault();
        void write("save");
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape" && !isImeEvent(e.nativeEvent) && !saving) {
          e.preventDefault();
          onClose();
        }
      }}
    >
      <header className="task-detail-heading">
        <h2>
          {task ? t("任务详情", "Task details") : t("新增任务", "New task")}
        </h2>
        {onOpenSource ? (
          <button
            type="button"
            className="task-detail-source"
            aria-label={sourceLabel}
            title={sourceLabel + " · " + doc.title}
            disabled={busy || saving}
            onClick={onOpenSource}
          >
            {source}
            <ExternalLink size={12} aria-hidden="true" />
          </button>
        ) : (
          <span className="task-detail-source">{source}</span>
        )}
      </header>
      <div className="task-detail-body">
        {stale && !busy && (
          <p role="alert">
            {t(
              "原文已更改，请重开任务后核对。",
              "The source changed. Reopen this task to review it.",
            )}
          </p>
        )}
        {task?.duplicate ? (
          <p role="alert">
            {t(
              "此文档中有重复的任务 ID。为这一处重新编号后即可分别编辑。",
              "This document contains duplicate task IDs. Give this occurrence a new ID to edit the tasks independently.",
            )}
          </p>
        ) : (
          <fieldset className="task-detail-fields" disabled={locked}>
            <label className="task-detail-field">
              {t("任务标题", "Task title")}
              <input
                value={title}
                required
                maxLength={1500}
                onChange={(e) => setTitle(e.target.value)}
                autoFocus
              />
            </label>
            <div className="task-detail-status">
              <label>
                <input
                  type="checkbox"
                  checked={done}
                  onChange={(e) => setDone(e.target.checked)}
                />
                {t("已完成", "Completed")}
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={waiting}
                  onChange={(e) => setWaiting(e.target.checked)}
                />
                {t("等回复", "Waiting for a reply")}
              </label>
              {task && (
                <button
                  type="button"
                  className="task-detail-untrack"
                  onClick={() => void write("untrack")}
                >
                  {t("取消跟踪", "Stop tracking")}
                </button>
              )}
            </div>
            <div className="task-detail-dates">
              <label className="task-detail-field">
                {t("截止日", "Due date")}
                <TaskDateInput
                  type="date"
                  value={due}
                  onChange={setDue}
                  hint={t("未设置", "Not set")}
                />
              </label>
              {waiting && (
                <label className="task-detail-field">
                  {t("跟进日", "Follow-up date")}
                  <TaskDateInput
                    type="date"
                    value={followOn}
                    onChange={setFollowOn}
                    hint={t("未设置", "Not set")}
                  />
                </label>
              )}
            </div>
            <div className="task-detail-schedule">
              <details open={showSlotOnOpen || undefined}>
                <summary>
                  <CalendarClock size={16} aria-hidden="true" />
                  {t("安排执行时段", "Schedule a time slot")}
                  <ChevronRight
                    size={15}
                    aria-hidden="true"
                    className="task-detail-chevron"
                  />
                </summary>
                <div className="task-detail-times">
                  <label className="task-detail-field">
                    {t("开始", "Start")}
                    <TaskDateInput
                      type="datetime-local"
                      value={start}
                      onChange={setStart}
                      hint={t("选择开始时间", "Select start time")}
                    />
                  </label>
                  <label className="task-detail-field">
                    {t("结束", "End")}
                    <TaskDateInput
                      type="datetime-local"
                      value={end}
                      onChange={setEnd}
                      hint={t("选择结束时间", "Select end time")}
                    />
                  </label>
                  <label className="task-detail-field task-detail-zone">
                    {t("时区", "Time zone")}
                    <input
                      value={zone}
                      onChange={(e) => setZone(e.target.value)}
                    />
                  </label>
                </div>
              </details>
              {onCalendar && (start || due || (waiting && followOn)) && (
                <button
                  type="button"
                  className="task-detail-calendar"
                  disabled={!title.trim()}
                  onClick={() => void write("calendar")}
                >
                  {t("保存并在日历中查看", "Save and show in calendar")}
                  <ExternalLink size={12} aria-hidden="true" />
                </button>
              )}
            </div>
          </fieldset>
        )}
        {task && <TaskOrigin documentId={doc.documentId} taskId={task.id} />}
        {error && (
          <p className="calendar-error" role="alert">
            {error}
          </p>
        )}
      </div>
      <div className="task-detail-actions">
        {task && !task.duplicate && onAskForHelp && (
          <button
            type="button"
            className="task-detail-help"
            disabled={locked || !title.trim()}
            onClick={() => void write("help")}
          >
            <Sparkles size={15} aria-hidden="true" />
            {t("保存并拆解", "Save and break down with AI")}
          </button>
        )}
        <div className="task-detail-submit">
          <button type="button" onClick={onClose} disabled={saving}>
            {t("取消", "Cancel")}
          </button>
          {task?.duplicate ? (
            <button
              type="button"
              disabled={busy || saving || stale}
              onClick={() => void write("rekey")}
            >
              {t("为这项重新编号", "Assign a new ID")}
            </button>
          ) : (
            <button
              className="task-detail-save"
              type="submit"
              disabled={busy || saving || stale || !title.trim()}
            >
              {t("保存任务", "Save task")}
            </button>
          )}
        </div>
      </div>
    </form>
  );
}

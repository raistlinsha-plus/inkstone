import { useRef, useState } from "react";
import {
  currentTimeZone,
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
import TaskOrigin from "./TaskOrigin";

export default function TaskForm({
  document: doc,
  current,
  origin,
  onPatch,
  onClose,
  busy,
  onAskForHelp,
}: {
  document: CalendarDocument;
  current?: CalendarDocument;
  origin?: ProjectTask;
  onPatch: (p: CalendarPatch) => Promise<void>;
  onClose: () => void;
  busy: boolean;
  onAskForHelp?: (title: string) => void;
}) {
  useLocale();
  const task = origin?.task;
  const [id] = useState(() => task?.id ?? crypto.randomUUID());
  const [title, setTitle] = useState(task?.title ?? "");
  const [due, setDue] = useState(task?.due ?? "");
  const [waiting, setWaiting] = useState(task?.waiting ?? false);
  const [followOn, setFollowOn] = useState(task?.followOn ?? "");
  const [zone, setZone] = useState(task?.slot?.zone ?? currentTimeZone());
  const [start, setStart] = useState(
    task?.slot ? dateTimeInput(task.slot.start, task.slot.zone) : "",
  );
  const [end, setEnd] = useState(
    task?.slot ? dateTimeInput(task.slot.end, task.slot.zone) : "",
  );
  const [done, setDone] = useState(task?.done ?? false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const submitting = useRef(false);
  const stale = !current || current.hash !== doc.hash;
  async function write(action: "save" | "untrack" | "rekey") {
    if (busy || submitting.current || stale) return;
    submitting.current = true;
    setSaving(true);
    setError("");
    try {
      let content: string;
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
          title,
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
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
      submitting.current = false;
    }
  }
  return (
    <form
      className="task-form calendar-event-editor"
      aria-label={t("任务详情", "Task details")}
      onSubmit={(e) => {
        e.preventDefault();
        void write("save");
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape" && !e.nativeEvent.isComposing && !saving) {
          e.preventDefault();
          onClose();
        }
      }}
    >
      <header>
        <strong>
          {task ? t("任务详情", "Task details") : t("新增任务", "New task")}
        </strong>
        <span>
          {doc.title}
          {task ? " · L" + task.line : ""}
        </span>
      </header>
      {stale && (
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
        <fieldset disabled={busy || saving || stale}>
          <label>
            {t("任务标题", "Task title")}
            <input
              value={title}
              required
              maxLength={1500}
              onChange={(e) => setTitle(e.target.value)}
              autoFocus
            />
          </label>
          <div className="task-fields">
            <label>
              {t("截止日", "Due date")}
              <input
                type="date"
                value={due}
                onChange={(e) => setDue(e.target.value)}
              />
            </label>
            <label>
              <input
                type="checkbox"
                checked={waiting}
                onChange={(e) => setWaiting(e.target.checked)}
              />
              {t("等回复", "Waiting for a reply")}
            </label>
            {waiting && (
              <label>
                {t("跟进日", "Follow-up date")}
                <input
                  type="date"
                  value={followOn}
                  onChange={(e) => setFollowOn(e.target.value)}
                />
              </label>
            )}
          </div>
          <details open={task?.slot ? true : undefined}>
            <summary>{t("安排执行时段", "Schedule a time slot")}</summary>
            <div className="task-fields">
              <label>
                {t("开始", "Start")}
                <input
                  type="datetime-local"
                  value={start}
                  onChange={(e) => setStart(e.target.value)}
                />
              </label>
              <label>
                {t("结束", "End")}
                <input
                  type="datetime-local"
                  value={end}
                  onChange={(e) => setEnd(e.target.value)}
                />
              </label>
              <label>
                {t("时区", "Time zone")}
                <input value={zone} onChange={(e) => setZone(e.target.value)} />
              </label>
            </div>
          </details>
          <label>
            <input
              type="checkbox"
              checked={done}
              onChange={(e) => setDone(e.target.checked)}
            />
            {t("已完成", "Completed")}
          </label>
        </fieldset>
      )}
      {task && <TaskOrigin documentId={doc.documentId} taskId={task.id} />}
      {error && (
        <p className="calendar-error" role="alert">
          {error}
        </p>
      )}
      <div className="task-actions">
        {task && !task.duplicate && (
          <button
            type="button"
            disabled={busy || saving || stale}
            onClick={() => void write("untrack")}
          >
            {t("取消跟踪", "Stop tracking")}
          </button>
        )}
        {task && !task.duplicate && onAskForHelp && (
          <button
            type="button"
            onClick={() => onAskForHelp(task.title)}
            disabled={busy || saving || stale}
          >
            {t("请 AI 帮我拆解", "Break down with AI")}
          </button>
        )}
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
            className="calendar-primary"
            type="submit"
            disabled={busy || saving || stale || !title.trim()}
          >
            {t("保存任务", "Save task")}
          </button>
        )}
      </div>
    </form>
  );
}

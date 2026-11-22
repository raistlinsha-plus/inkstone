import { useMemo, useRef, useState } from "react";
import { dateInZone, type CalendarDocument } from "../content/calendar";
import { changeTrackedTask } from "../content/tasks";
import type { CalendarPatch } from "../calendar/ProjectCalendar";
import { useLocale, translate as t } from "../i18n";
import { filterTasks, type ProjectTask, type TaskFilter } from "./project";
export default function TaskList({
  rows,
  documents,
  busy,
  onNew,
  onEdit,
  onOpen,
  onPatch,
}: {
  rows: ProjectTask[];
  documents: CalendarDocument[];
  busy: boolean;
  onNew: (d: CalendarDocument) => void;
  onEdit: (r: ProjectTask) => void;
  onOpen: (v: { path: string; line: number }) => void;
  onPatch: (p: CalendarPatch) => Promise<void>;
}) {
  useLocale();
  const [filter, setFilter] = useState<TaskFilter>("open");
  const [target, setTarget] = useState("");
  const [error, setError] = useState("");
  const [limit, setLimit] = useState(50);
  const [writing, setWriting] = useState(false);
  const pending = useRef(false);
  const today = dateInZone();
  const filtered = useMemo(
    () => filterTasks(rows, filter, today),
    [rows, filter, today],
  );
  const selected =
    documents.find((d) => d.documentId === target) ?? documents[0];
  const locked = busy || writing;
  async function toggle({ document, task }: ProjectTask) {
    if (locked || pending.current || task.duplicate) return;
    pending.current = true;
    setWriting(true);
    setError("");
    try {
      await onPatch({
        documentId: document.documentId,
        expectedHash: document.hash,
        content: changeTrackedTask(document.content, task, {
          ...task,
          done: !task.done,
        }),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      pending.current = false;
      setWriting(false);
    }
  }
  return (
    <section
      aria-label={t("空间任务清单", "Space task list")}
      className="task-list"
    >
      <div className="task-filters">
        <label>
          {t("查看", "Show")}
          <select
            value={filter}
            onChange={(e) => {
              setFilter(e.target.value as TaskFilter);
              setLimit(50);
            }}
          >
            {[
              ["open", t("未完成", "Open")],
              ["unscheduled", t("未安排时段", "Unscheduled")],
              ["due", t("临近或逾期", "Due soon or overdue")],
              ["waiting", t("等回复", "Waiting")],
              ["done", t("已完成", "Completed")],
            ].map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t("新增任务保存到", "Save new tasks to")}
          <select
            disabled={!documents.length}
            value={selected?.documentId ?? ""}
            onChange={(e) => setTarget(e.target.value)}
          >
            {documents.map((d) => (
              <option key={d.documentId} value={d.documentId}>
                {d.title}
              </option>
            ))}
          </select>
        </label>
        <button
          disabled={locked || !selected}
          className="calendar-primary"
          onClick={() => selected && onNew(selected)}
        >
          {t("新增任务", "New task")}
        </button>
      </div>
      {error && (
        <p role="alert" className="calendar-error">
          {error}
        </p>
      )}
      {!filtered.length ? (
        <p className="calendar-empty">
          {t(
            "此列表暂无任务。在 Markdown 中选择「插入 → 跟踪为任务」，或在这里新增任务。",
            "No tasks in this view. Track a checkbox in Markdown or create a new task here.",
          )}
        </p>
      ) : (
        <ul>
          {filtered.slice(0, limit).map((row) => (
            <li
              key={
                row.document.documentId +
                ":" +
                row.task.id +
                ":" +
                row.task.line
              }
            >
              <input
                type="checkbox"
                checked={row.task.done}
                disabled={locked || row.task.duplicate}
                aria-label={row.task.title}
                onChange={() => void toggle(row)}
              />
              <button
                className="task-open"
                onClick={() => onEdit(row)}
                disabled={locked}
              >
                <strong>{row.task.title}</strong>
                <small>
                  {[
                    row.task.duplicate ? t("ID 重复", "Duplicate ID") : "",
                    row.task.due ? t("到期 ", "Due ") + row.task.due : "",
                    row.task.waiting && !row.task.done
                      ? t("等回复", "Waiting")
                      : "",
                    row.task.followOn && !row.task.done
                      ? t("跟进 ", "Follow up ") + row.task.followOn
                      : "",
                    row.task.slot
                      ? t("执行 ", "Scheduled ") +
                        row.task.slot.start.slice(0, 16).replace("T", " ") +
                        " · " +
                        row.task.slot.zone
                      : "",
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </small>
              </button>
              <button
                className="calendar-source"
                onClick={() =>
                  onOpen({ path: row.document.path, line: row.task.line })
                }
              >
                {row.document.title} ↗
              </button>
            </li>
          ))}
        </ul>
      )}
      {filtered.length > limit && (
        <button onClick={() => setLimit(limit + 50)}>
          {t("显示更多", "Show more")} · {limit}/{filtered.length}
        </button>
      )}
    </section>
  );
}

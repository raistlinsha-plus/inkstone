import { useEffect, useMemo, useRef, useState } from "react";
import {
  CalendarDays,
  CircleCheck,
  CornerDownLeft,
  FileText,
  Hourglass,
  ListChecks,
  MessageCircle,
  Plus,
  RefreshCw,
  Sun,
  Undo2,
} from "lucide-react";
import type { CalendarPatch } from "../calendar/ProjectCalendar";
import {
  addDays,
  currentTimeZone,
  dateInZone,
  dateTimeInput,
  type CalendarDocument,
} from "../content/calendar";
import {
  appendTrackedTasks,
  changeTrackedTask,
  type TaskDraft,
} from "../content/tasks";
import { isImeEvent } from "../platform/ime";
import { translate as t, useLocale } from "../i18n";
import ModalDialog from "../ModalDialog";
import TaskForm from "./TaskForm";
import {
  projectTasks,
  taskViewState,
  type ProjectTask,
  type TaskView,
} from "./project";
import "./task-workspace.css";

const allViews: TaskView[] = [
  "today",
  "upcoming",
  "all",
  "done",
  "waiting",
  "unscheduled",
  "chat",
];

function initialView(spaceId: string): TaskView {
  try {
    const stored = localStorage.getItem("inkstone:task-view:" + spaceId);
    if (allViews.includes(stored as TaskView)) return stored as TaskView;
  } catch {
    /* View preferences are optional. */
  }
  return "today";
}

interface Props {
  spaceId: string;
  documents: CalendarDocument[];
  busy: boolean;
  onPatch: (patch: CalendarPatch) => Promise<void>;
  onQuickAdd: (draft: TaskDraft) => Promise<void>;
  onOpen: (target: { path: string; line: number }) => void;
  onCalendar: (day: string) => void;
  onUndo: () => void;
  canUndo: boolean;
  onRefresh: () => void;
  onAskForHelp: (title: string) => void;
}

export default function TaskList({
  spaceId,
  documents,
  busy,
  onPatch,
  onQuickAdd,
  onOpen,
  onCalendar,
  onUndo,
  canUndo,
  onRefresh,
  onAskForHelp,
}: Props) {
  const { language } = useLocale();
  const [view, setView] = useState(() => initialView(spaceId));
  const [sort, setSort] = useState("date");
  const [title, setTitle] = useState("");
  const [target, setTarget] = useState("");
  const [detail, setDetail] = useState<ProjectTask | null>(null);
  const [error, setError] = useState("");
  const [writing, setWriting] = useState(false);
  const pending = useRef(false);
  const retry = useRef<{ signature: string; id: string } | undefined>(
    undefined,
  );
  const [limit, setLimit] = useState(100);
  const [today, setToday] = useState(() => dateInZone());
  useEffect(() => {
    const update = () => setToday(dateInZone());
    const timer = window.setInterval(update, 60_000);
    window.addEventListener("focus", update);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", update);
    };
  }, []);
  const zone = currentTimeZone();
  const rows = useMemo(
    () =>
      projectTasks(documents).map((row) => ({
        row,
        state: taskViewState(row, today, zone),
      })),
    [documents, today, zone],
  );
  const views = {
    today: [Sun, t("今天", "Today")],
    upcoming: [CalendarDays, t("接下来", "Upcoming")],
    all: [ListChecks, t("全部任务", "All tasks")],
    done: [CircleCheck, t("已完成", "Completed")],
    waiting: [Hourglass, t("等回复", "Waiting")],
    unscheduled: [CalendarDays, t("未安排时段", "Unscheduled")],
    chat: [MessageCircle, t("来自问答", "From conversations")],
  } as const;
  const filtered = rows
    .filter((item) => item.state[view])
    .sort((a, b) => {
      const order =
        sort === "title"
          ? 0
          : view === "upcoming"
            ? a.state.next!.localeCompare(b.state.next!)
            : a.state.sort.localeCompare(b.state.sort);
      return (
        order ||
        a.row.task.title.localeCompare(b.row.task.title, language) ||
        a.row.task.line - b.row.task.line
      );
    });
  const locked = busy || writing;
  const groups = new Map<string, typeof filtered>();
  for (const item of filtered.slice(0, limit)) {
    const heading = item.row.task.done
      ? t("已完成", "Completed")
      : view === "upcoming"
        ? item.state.next!
        : item.state.overdue
          ? t("已逾期", "Overdue")
          : item.state.today
            ? t("今天待办", "Today’s tasks")
            : item.state.sort === "~"
              ? t("待安排", "No date")
              : t("待办", "Open");
    groups.set(heading, [...(groups.get(heading) ?? []), item]);
  }
  const groupOrder = [
    t("已逾期", "Overdue"),
    t("今天待办", "Today’s tasks"),
    t("待办", "Open"),
    t("待安排", "No date"),
    t("已完成", "Completed"),
  ];
  const sections = Array.from(groups).sort(
    ([a], [b]) => groupOrder.indexOf(a) - groupOrder.indexOf(b),
  );
  function changeView(next: TaskView) {
    setView(next);
    setLimit(100);
    try {
      localStorage.setItem("inkstone:task-view:" + spaceId, next);
    } catch {
      /* Optional. */
    }
  }
  async function write(action: () => Promise<void>) {
    if (locked || pending.current) return;
    pending.current = true;
    setWriting(true);
    setError("");
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      pending.current = false;
      setWriting(false);
    }
  }
  async function create() {
    const name = title.trim();
    if (!name) return;
    const due =
      view === "today"
        ? today
        : view === "upcoming"
          ? addDays(today, 1)
          : undefined;
    const signature = JSON.stringify([target, name, due]);
    if (retry.current?.signature !== signature)
      retry.current = { signature, id: crypto.randomUUID() };
    const draft = { id: retry.current.id, title: name, due };
    if (target) {
      const doc = documents.find((d) => d.documentId === target);
      if (!doc)
        throw Error(
          t(
            "所选文档已移除，请选择其他文档。",
            "The selected document was removed. Choose another document.",
          ),
        );
      await onPatch({
        documentId: doc.documentId,
        expectedHash: doc.hash,
        content: appendTrackedTasks(doc.content, [draft]),
      });
    } else await onQuickAdd(draft);
    retry.current = undefined;
    setTitle("");
  }
  function nav(key: TaskView) {
    const [Icon, label] = views[key];
    return (
      <button
        key={key}
        type="button"
        aria-pressed={key === view}
        onClick={() => changeView(key)}
      >
        <Icon size={16} />
        <span>{label}</span>
        <small>{rows.filter((item) => item.state[key]).length}</small>
      </button>
    );
  }
  const currentDetail = documents.find(
    (d) => d.documentId === detail?.document.documentId,
  );
  const showCreate = !["done", "chat", "waiting"].includes(view);
  return (
    <section
      className="task-workspace"
      aria-label={t("空间任务清单", "Space task list")}
    >
      <nav className="task-navigation" aria-label={t("任务视图", "Task views")}>
        <h2>{t("任务", "Tasks")}</h2>
        {(["today", "upcoming", "all", "done"] as const).map(nav)}
        <div className="task-nav-divider" />
        {(["unscheduled", "waiting", "chat"] as const).map(nav)}
      </nav>
      <div className="task-desk">
        <div className="task-desk-inner">
          <header className="task-desk-head">
            <div>
              <h1>{views[view][1]}</h1>
              <p>
                {new Intl.DateTimeFormat(language, {
                  weekday: "long",
                  month: "long",
                  day: "numeric",
                }).format(new Date(today + "T12:00:00"))}
              </p>
            </div>
            <div className="task-tools">
              <button
                type="button"
                disabled={locked || !canUndo}
                aria-label={t("撤销上次修改", "Undo last change")}
                title={t("撤销上次修改", "Undo last change")}
                onClick={onUndo}
              >
                <Undo2 size={16} />
              </button>
              <button
                type="button"
                aria-label={t("刷新任务", "Refresh tasks")}
                title={t("刷新任务", "Refresh tasks")}
                disabled={locked}
                onClick={onRefresh}
              >
                <RefreshCw size={16} />
              </button>
              <select
                aria-label={t("任务排序", "Sort tasks")}
                value={sort}
                onChange={(e) => setSort(e.target.value)}
              >
                <option value="date">{t("按日期", "By date")}</option>
                <option value="title">{t("按名称", "By name")}</option>
              </select>
            </div>
          </header>
          {showCreate && (
            <form
              className="task-quick-entry"
              onSubmit={(e) => {
                e.preventDefault();
                void write(create);
              }}
            >
              <div>
                <Plus size={18} />
                <input
                  aria-label={t("任务标题", "Task title")}
                  value={title}
                  maxLength={1500}
                  disabled={locked}
                  placeholder={t("添加任务…", "Add a task…")}
                  onChange={(e) => setTitle(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && isImeEvent(e.nativeEvent))
                      e.preventDefault();
                  }}
                />
                <button
                  type="submit"
                  aria-label={t("添加任务", "Add task")}
                  disabled={locked || !title.trim()}
                >
                  <CornerDownLeft size={15} />
                </button>
              </div>
              {(title || target) && (
                <label>
                  {t("保存到", "Save to")}{" "}
                  <select
                    aria-label={t("新增任务保存到", "Save new tasks to")}
                    disabled={locked}
                    value={target}
                    onChange={(e) => setTarget(e.target.value)}
                  >
                    <option value="">
                      {t("默认任务笔记", "Default task note")}
                    </option>
                    {documents.map((d) => (
                      <option key={d.documentId} value={d.documentId}>
                        {d.title}
                      </option>
                    ))}
                  </select>
                  {view === "today"
                    ? t("今天截止", "Due today")
                    : view === "upcoming"
                      ? t("明天截止", "Due tomorrow")
                      : ""}
                </label>
              )}
            </form>
          )}
          {error && (
            <p className="calendar-error" role="alert">
              {error}
            </p>
          )}
          {!sections.length && (
            <p className="task-quiet" role="status">
              {busy
                ? t("正在读取任务…", "Loading tasks…")
                : t("这里还没有任务。", "No tasks in this view.")}
            </p>
          )}
          {sections.map(([heading, items]) => (
            <section className="task-group" key={heading}>
              <h3>
                {heading} <small>{items.length}</small>
              </h3>
              <ul>
                {items.map(({ row, state }) => {
                  const { task, document: doc } = row;
                  return (
                    <li
                      key={doc.documentId + ":" + task.id + ":" + task.line}
                      className={task.done ? "task-complete" : ""}
                    >
                      <input
                        type="checkbox"
                        aria-label={task.title}
                        checked={task.done}
                        disabled={locked || task.duplicate}
                        onChange={() =>
                          void write(() =>
                            onPatch({
                              documentId: doc.documentId,
                              expectedHash: doc.hash,
                              content: changeTrackedTask(doc.content, task, {
                                ...task,
                                done: !task.done,
                              }),
                            }),
                          )
                        }
                      />
                      <div>
                        <button
                          className="task-row-title"
                          type="button"
                          disabled={locked}
                          onClick={() => setDetail(row)}
                        >
                          {task.title}
                          {task.duplicate && (
                            <small> · {t("ID 重复", "Duplicate ID")}</small>
                          )}
                        </button>
                        <button
                          type="button"
                          className="task-row-source"
                          title={t("打开原文", "Open source document")}
                          onClick={() =>
                            onOpen({ path: doc.path, line: task.line })
                          }
                        >
                          {state.chat ? (
                            <MessageCircle size={13} />
                          ) : (
                            <FileText size={13} />
                          )}{" "}
                          {doc.title} ↗
                        </button>
                      </div>
                      <div
                        className={
                          "task-row-dates" + (state.overdue ? " overdue" : "")
                        }
                      >
                        {task.due && (
                          <small>
                            {t("到期 ", "Due ")}
                            {task.due}
                          </small>
                        )}
                        {task.slot && (
                          <small>
                            {t("执行 ", "Scheduled ")}
                            {dateTimeInput(task.slot.start, zone).replace(
                              "T",
                              " ",
                            )}
                          </small>
                        )}
                        {task.waiting && (
                          <small>
                            {t("等回复", "Waiting")} {task.followOn}
                          </small>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
          {filtered.length > limit && (
            <button onClick={() => setLimit(limit + 100)}>
              {t("显示更多", "Show more")} · {limit}/{filtered.length}
            </button>
          )}
        </div>
      </div>
      {detail && (
        <ModalDialog
          className="task-detail-sheet inkstone-calendar"
          label={t("任务详情", "Task details")}
          busy={locked}
          onClose={() => setDetail(null)}
        >
          <TaskForm
            document={detail.document}
            current={currentDetail}
            origin={detail}
            onCalendar={onCalendar}
            onPatch={onPatch}
            busy={locked}
            onClose={() => setDetail(null)}
            onAskForHelp={(name) => {
              setDetail(null);
              onAskForHelp(name);
            }}
          />
          <footer>
            <button
              disabled={locked}
              onClick={() =>
                onOpen({ path: detail.document.path, line: detail.task.line })
              }
            >
              <FileText size={15} /> {t("打开原文", "Open source document")}
            </button>
          </footer>
        </ModalDialog>
      )}
    </section>
  );
}

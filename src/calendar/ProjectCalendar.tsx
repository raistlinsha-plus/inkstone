import { msg } from "../i18n";
import { useEffect, useMemo, useState } from "react";
import { CalendarDays, RefreshCw, Undo2 } from "lucide-react";
import {
  calendarBlocks,
  validDate as validCalendarDate,
  addDays,
  calendarIcs,
  currentTimeZone,
  dateInZone,
  deleteCalendarEvent,
  eventDay,
  eventOverlaps,
  filterCalendarEvents,
  monthRange,
  projectEvents,
  replaceCalendarBlock,
  saveCalendarEvent,
  type CalendarContentBlock,
  type CalendarDocument,
  type CalendarEvent,
  type CalendarMode,
  type DateRange,
} from "../content/calendar";
import CalendarBoard, { CalendarAgenda } from "./CalendarBoard";
import CalendarTools from "./CalendarTools";
import EventEditor from "./EventEditor";
import { exportCalendar } from "./export";
import { useCalendarFocus } from "./useCalendarFocus";
import TaskList from "../tasks/TaskList";
import TaskForm from "../tasks/TaskForm";
import { projectTasks, taskCalendarRows, type ProjectTask } from "../tasks/project";
import { useLocale, translate as t } from "../i18n";
import "./calendar.css";
export interface CalendarPatch {
  documentId: string;
  expectedHash: string;
  content: string;
}
interface Props {
  documents: CalendarDocument[];
  onPatch: (patch: CalendarPatch) => Promise<void>;
  onOpen: (target: { path: string; line: number }) => void;
  onError: (message: string) => void;
  onUndo?: () => void;
  canUndo?: boolean;
  busy?: boolean;
  onRefresh?: () => void;
  onNewDocument?: () => void;
  onAskForHelp?: (title: string) => void;
  initialRange?: DateRange;
  initialQuery?: string;
}
interface Editing {
  document: CalendarDocument;
  block: CalendarContentBlock;
  event?: CalendarEvent;
  date?: string;
}
export default function ProjectCalendar({
  documents,
  onPatch,
  onOpen,
  onError,
  onUndo,
  canUndo = false,
  busy = false,
  onRefresh,
  onNewDocument,
  initialRange,
  initialQuery,
  onAskForHelp,
}: Props) {
  const { language } = useLocale();
  const [section, setSection] = useState<"tasks" | "calendar">("calendar");
  const [taskEditor, setTaskEditor] = useState<{document: CalendarDocument; origin?: ProjectTask} | null>(null);
  const tasks = useMemo(() => projectTasks(documents), [documents]);
  const projection = useMemo(() => projectEvents(documents), [documents]);
  const zone = currentTimeZone();
  const datedTasks = useMemo(() => taskCalendarRows(tasks, zone, {due:t("到期","Due"), slot:t("执行","Scheduled"), follow:t("跟进","Follow up")}), [tasks,zone,language]);
  const [anchor, setAnchor] = useState(
    () => initialRange?.start ?? dateInZone(new Date(), zone),
  );
  const [view, setView] = useState<CalendarMode>("agenda");
  const [range, setRange] = useState<DateRange>(
    () => initialRange ?? monthRange(anchor),
  );
  const [query, setQuery] = useState(initialQuery ?? "");
  const [status, setStatus] = useState("all");
  const [editing, setEditing] = useState<Editing | null>(null);
  const [target, setTarget] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const focus = useCalendarFocus();
  const finishEditing = () => {
    setEditing(null);
    focus.restore();
  };
  useEffect(() => {
    if (initialRange) {
      setSection("calendar");
      setRange(initialRange);
      setAnchor(initialRange.start);
      setView("agenda");
      setQuery(initialQuery ?? initialRange.terms);
    }
  }, [initialRange, initialQuery]);
  const available = useMemo(
    () =>
      documents.flatMap((document) =>
        calendarBlocks(document.content)
          .filter((block) => block.data)
          .map((block) => ({
            document,
            block,
            key: `${document.documentId}:${block.data!.id}`,
          })),
      ),
    [documents],
  );
  const selectedTarget =
    available.find((t) => t.key === target) ?? available[0];
  const rows = filterCalendarEvents(
    projection.events,
    range,
    status,
    query,
    zone,
  );
  const visibleEvents = filterCalendarEvents([
    ...projection.events.map(r => ({key:r.key,event:r.event,source:r.document.title})),
    ...datedTasks
  ], range, status, query, zone);
  const chooseAnchor = (date: string) => {
    setAnchor(date);
    setRange(monthRange(date));
  };
  const chooseRangeStart = (date: string) => {
    if (!validCalendarDate(date)) return;
    setAnchor(date);
    setRange({
      ...range,
      start: date,
      end: range.end > date ? range.end : addDays(date, 1),
      label: "自定义日期范围",
    });
  };
  const chooseRangeEnd = (date: string) => {
    if (!validCalendarDate(date) || date < range.start) return;
    setRange({
      ...range,
      end: addDays(date, 1),
      label: "自定义日期范围",
    });
  };
  const fail = (e: unknown) => {
    const message = e instanceof Error ? e.message : String(e);
    setError(message);
    onError(message);
  };
  const edit = (key: string) => {
    if (busy || saving) return;
    focus.remember();
    const dated = datedTasks.find(r => r.key === key);
    if (dated) {
      setEditing(null);
      setTaskEditor({document:dated.origin.document,origin:dated.origin});
      return;
    }
    setTaskEditor(null);
    const row = projection.events.find((r) => r.key === key);
    if (row)
      setEditing({
        document: row.document,
        block: row.block,
        event: row.event,
      });
  };
  const add = (date = anchor) => {
    if (busy || saving) return;
    focus.remember();
    setTaskEditor(null);
    if (!selectedTarget) {
      onNewDocument?.();
      return;
    }
    setEditing({
      document: selectedTarget.document,
      block: selectedTarget.block,
      date,
    });
  };
  const save = async (event?: CalendarEvent) => {
    if (!editing || busy || saving) return;
    const current = documents.find(
      (d) => d.documentId === editing.document.documentId,
    );
    if (!current || current.hash !== editing.document.hash)
      throw Error("原文已变化，请刷新并重新打开事项。");
    const blockSource = event
      ? saveCalendarEvent(editing.block.text, event)
      : deleteCalendarEvent(editing.block.text, editing.event!.id);
    const content = replaceCalendarBlock(
      editing.document.content,
      editing.block,
      blockSource,
    );
    setSaving(true);
    setError("");
    try {
      await onPatch({
        documentId: editing.document.documentId,
        expectedHash: editing.document.hash,
        content,
      });
      if (
        event &&
        (!editing.event || !eventOverlaps(event, range.start, range.end, zone))
      )
        chooseAnchor(eventDay(event, zone));
      finishEditing();
    } catch (e) {
      fail(e);
      throw e;
    } finally {
      setSaving(false);
    }
  };
  const currentEditing = editing
    ? documents.find((d) => d.documentId === editing.document.documentId)
    : null;
  return (
    <section
      ref={focus.scope}
      className="project-calendar inkstone-calendar"
      aria-label={msg("项目日历")}
    >
      <header className="project-calendar-heading">
        <div>

          <h1>
            <CalendarDays size={27} />
            {msg("项目日历")}
          </h1>
          <p>{msg("文档里的日程汇总在这里，修改会保存回原文。")}</p>
        </div>
        <div className="calendar-heading-actions">
          {onUndo && (
            <button onClick={onUndo} disabled={!canUndo || busy || saving}>
              <Undo2 size={15} />
              {msg("撤销上次日历修改")}
            </button>
          )}
          {onRefresh && (
            <button
              onClick={onRefresh}
              disabled={busy || saving}
              aria-label={msg("刷新项目日历")}
            >
              <RefreshCw size={16} />
            </button>
          )}
        </div>
      </header>
      <nav aria-label={t("计划视图","Planning view")} className="task-section-switch">
        <button aria-pressed={section === "calendar"} onClick={() => {setSection("calendar");setTaskEditor(null);}}>{t("日历","Calendar")}</button>
        <button aria-pressed={section === "tasks"} onClick={() => {setSection("tasks");setEditing(null);setTaskEditor(null);}}>{t("任务","Tasks")}</button>
      </nav>
      {taskEditor && <TaskForm key={taskEditor.document.documentId+":"+(taskEditor.origin?.task.line ?? "new")}
        document={taskEditor.document} current={documents.find(d=>d.documentId===taskEditor.document.documentId)} origin={taskEditor.origin}
        onPatch={onPatch} busy={busy} onAskForHelp={onAskForHelp ? (title) => {
          // The chat composer owns focus when switching away from the details form.
          setTaskEditor(null);
          onAskForHelp(title);
        } : undefined}
        onClose={()=>{setTaskEditor(null);focus.restore();}} />}
      {section === "tasks" ? <TaskList documents={documents} rows={tasks} busy={busy || !!taskEditor} onPatch={onPatch} onOpen={onOpen}
        onNew={document=>{focus.remember();setTaskEditor({document});}}
        onEdit={origin=>{focus.remember();setTaskEditor({document:origin.document,origin});}} /> : <>
      <CalendarTools
        view={view}
        onView={setView}
        anchor={anchor}
        onAnchor={chooseAnchor}
        timeZone={zone}
        label={range.label}
        busy={busy || saving}
        onNew={available.length ? () => add() : onNewDocument}
        onExport={() => {
          void exportCalendar(
            calendarIcs(rows.map((r) => ({ ...r.event, uid: r.key }))),
            "Inkstone-项目日历.ics",
          ).catch(fail);
        }}
      />
      <div className="project-calendar-filters">
        <label>
          {msg("从")}
          <input
            aria-label={msg("日历范围开始")}
            type="date"
            value={range.start}
            onInput={(e) => chooseRangeStart(e.currentTarget.value)}
            onChange={(e) => chooseRangeStart(e.target.value)}
          />
        </label>
        <label>
          {msg("至")}
          <input
            aria-label={msg("日历范围结束")}
            type="date"
            value={addDays(range.end, -1)}
            min={range.start}
            onInput={(e) => chooseRangeEnd(e.currentTarget.value)}
            onChange={(e) => chooseRangeEnd(e.target.value)}
          />
        </label>
        <label>
          {msg("状态")}
          <select
            aria-label={msg("日历状态筛选")}
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="all">{msg("全部状态")}</option>
            <option value="planned">{msg("待办")}</option>
            <option value="done">{msg("已完成")}</option>
            <option value="cancelled">{msg("已取消")}</option>
          </select>
        </label>
        <label className="calendar-query">
          {msg("查找事项")}
          <input
            aria-label={msg("查找日程")}
            placeholder={msg("标题或备注…")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
      </div>
      {available.length > 1 && (
        <label className="calendar-target-select">
          {msg("新增事项保存到")}
          <select
            aria-label={msg("新事项所属日历块")}
            value={selectedTarget?.key ?? ""}
            onChange={(e) => setTarget(e.target.value)}
          >
            {available.map((t) => (
              <option key={t.key} value={t.key}>
                {t.document.title} {msg("· 第")} {t.block.line} {msg("行")}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="calendar-range-description">
        <strong>{msg("共")} {visibleEvents.length} {msg("个事项")}</strong>
        <span>
          {range.start} {msg("至")} {addDays(range.end, -1)} · {zone} {msg("· 完整日期结果")}
        </span>
      </div>
      {editing && (
        <div className="project-calendar-editor">
          <div className="calendar-editor-source">
            {msg("保存到：")}{editing.document.title}
            <button
              onClick={() =>
                onOpen({
                  path: editing.document.path,
                  line: editing.block.line,
                })
              }
            >
              {msg("回到原文 ↗")}
            </button>
          </div>
          <EventEditor
            key={`${editing.document.documentId}:${editing.block.data!.id}:${editing.event?.id ?? "new"}:${editing.date ?? ""}`}
            event={editing.event}
            date={editing.date}
            timeZone={zone}
            busy={busy || saving}
            stale={
              !currentEditing || currentEditing.hash !== editing.document.hash
            }
            onSave={(event) => save(event)}
            onDelete={editing.event ? () => save() : undefined}
            onCancel={() => {
              finishEditing();
              setError("");
            }}
          />
        </div>
      )}
      {!available.length && !datedTasks.length && (
        <div className="calendar-empty">
          <h3>{msg("在文档里安排第一件事")}</h3>
          <p>{msg("正文输入 /日程 或 /日历，或者创建一篇日程文档。")}</p>
          {onNewDocument && (
            <button
              className="calendar-primary"
              onClick={onNewDocument}
              disabled={busy}
            >
              {msg("新建日程文档")}
            </button>
          )}
        </div>
      )}
      {view === "month" ? (
        <CalendarBoard
          rows={visibleEvents}
          anchor={anchor}
          timeZone={zone}
          onDate={add}
          onEdit={edit}
        />
      ) : (
        (available.length > 0 || datedTasks.length > 0) && (
          <CalendarAgenda
            rows={visibleEvents}
            timeZone={zone}
            onEdit={edit}
            onOpen={(key) => {
              const dated = datedTasks.find(r => r.key === key);
              if (dated) {
                onOpen({path:dated.origin.document.path, line:dated.origin.task.line});
                return;
              }
              const row = projection.events.find((r) => r.key === key);
              if (row)
                onOpen({ path: row.document.path, line: row.block.line });
            }}
          />
        )
      )}
      {projection.warnings.length > 0 && (
        <details className="calendar-warnings">
          <summary>
            {projection.warnings.length} {msg("个日历块需要检查（原文保留）")}
          </summary>
          <ul>
            {projection.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </details>
      )}
      </>}
      {error && (
        <p className="calendar-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

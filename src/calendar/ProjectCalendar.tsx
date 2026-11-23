import { changeTrackedTask } from "../content/tasks";
import { msg } from "../i18n";
import { useEffect, useMemo, useState } from "react";
import { RefreshCw, Undo2 } from "lucide-react";
import {
  calendarBlocks,
  validDate as validCalendarDate,
  addDays,
  calendarIcs,
  instantInZone,
  currentTimeZone,
  dateInZone,
  deleteCalendarEvent,
  eventDay,
  eventOverlaps,
  filterCalendarEvents,
  projectEvents,
  replaceCalendarBlock,
  saveCalendarEvent,
  type CalendarContentBlock,
  type CalendarDocument,
  type CalendarEvent,
  type DateRange,
} from "../content/calendar";
import CalendarBoard, { CalendarAgenda } from "./CalendarBoard";
import ProjectCalendarHeader from "./ProjectCalendarHeader";
import {
  calendarViewRange,
  readCalendarView,
  saveCalendarView,
  type WorkspaceCalendarView,
} from "./projectCalendarView";
import EventEditor from "./EventEditor";
import { exportCalendar } from "./export";
import { useCalendarFocus } from "./useCalendarFocus";
import TaskForm from "../tasks/TaskForm";
import {
  projectTasks,
  taskCalendarRows,
  type ProjectTask,
} from "../tasks/project";
import { useLocale, translate as t } from "../i18n";
import "./calendar.css";
import "./project-calendar.css";
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
  spaceId?: string;
  initialDay?: string;
  onCreateCalendar?: (event: CalendarEvent) => Promise<void>;
  initialRange?: DateRange;
  initialQuery?: string;
}
interface Editing {
  source?: { document: CalendarDocument; block: CalendarContentBlock };
  time?: string;
  allDay?: boolean;
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
  onCreateCalendar,
  initialDay,
  spaceId,
  initialRange,
  initialQuery,
  onAskForHelp,
}: Props) {
  const { language } = useLocale();
  const [taskEditor, setTaskEditor] = useState<{
    document: CalendarDocument;
    origin: ProjectTask;
  } | null>(null);
  const tasks = useMemo(() => projectTasks(documents), [documents]);
  const projection = useMemo(() => projectEvents(documents), [documents]);
  const zone = currentTimeZone();
  const datedTasks = useMemo(
    () =>
      taskCalendarRows(tasks, zone, {
        due: t("到期", "Due"),
        slot: t("执行", "Scheduled"),
        follow: t("跟进", "Follow up"),
      }),
    [tasks, zone, language],
  );
  const [anchor, setAnchor] = useState(
    () => initialRange?.start ?? initialDay ?? dateInZone(new Date(), zone),
  );
  const [view, setView] = useState<WorkspaceCalendarView>(() =>
    initialRange ? "agenda" : initialDay ? "week" : readCalendarView(spaceId),
  );
  const [range, setRange] = useState<DateRange>(
    () => initialRange ?? calendarViewRange(view, anchor),
  );
  const [query, setQuery] = useState(initialQuery ?? "");
  const [showTasks, setShowTasks] = useState(true);
  const [showEvents, setShowEvents] = useState(true);
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
      setRange(initialRange);
      setAnchor(initialRange.start);
      setView("agenda");
      setQuery(initialQuery ?? initialRange.terms);
    } else if (initialDay) {
      setAnchor(initialDay);
      setRange(calendarViewRange("week", initialDay));
      setView("week");
    }
  }, [initialDay, initialRange, initialQuery]);
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
  const visibleEvents = useMemo(
    () =>
      filterCalendarEvents(
        [
          ...(showEvents
            ? projection.events.map((r) => ({
                key: r.key,
                event: r.event,
                source: r.document.title,
                id: r.event.id,
              }))
            : []),
          ...(showTasks
            ? datedTasks.map((r) => ({
                ...r,
                id: r.origin.task.id,
                slotSourceHash: r.key.endsWith(":slot")
                  ? r.origin.document.hash
                  : undefined,
              }))
            : []),
        ],
        range,
        status,
        query,
        zone,
      ),
    [projection, datedTasks, range, status, query, zone, showEvents, showTasks],
  );
  const chooseAnchor = (date: string) => {
    setAnchor(date);
    setRange(calendarViewRange(view, date));
  };
  const chooseView = (next: WorkspaceCalendarView) => {
    setView(next);
    saveCalendarView(spaceId, next);
    setRange(calendarViewRange(next, anchor));
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
  async function moveTaskSlot(
    key: string,
    expectedHash: string,
    start: string,
    end: string,
  ) {
    if (busy || saving || editing || taskEditor) return;
    setSaving(true);
    try {
      const origin = datedTasks.find(
        (row) => row.key === key && key.endsWith(":slot"),
      )?.origin;
      if (
        !origin ||
        origin.document.hash !== expectedHash ||
        !origin.task.slot ||
        origin.task.done
      ) {
        throw Error(
          t(
            "任务原文已变化，请刷新后重新排期。",
            "The task changed. Refresh before rescheduling.",
          ),
        );
      }
      const { document, task } = origin;
      const zone = origin.task.slot.zone;
      const slot = {
        zone,
        start: instantInZone(start, zone),
        end: instantInZone(end, zone),
      };
      const content = changeTrackedTask(document.content, task, {
        ...task,
        slot,
      });
      await onPatch({ documentId: document.documentId, expectedHash, content });
      setError("");
    } catch (error) {
      fail(error);
    } finally {
      setSaving(false);
    }
  }
  const edit = (key: string) => {
    if (busy || saving) return;
    focus.remember();
    const dated = datedTasks.find((r) => r.key === key);
    if (dated) {
      setEditing(null);
      setTaskEditor({ document: dated.origin.document, origin: dated.origin });
      return;
    }
    setTaskEditor(null);
    const row = projection.events.find((r) => r.key === key);
    if (row)
      setEditing({
        source: { document: row.document, block: row.block },
        event: row.event,
      });
  };
  const add = (date = anchor, time?: string, allDay = false) => {
    if (busy || saving) return;
    focus.remember();
    setTaskEditor(null);
    if (!selectedTarget && !onCreateCalendar) {
      onNewDocument?.();
      return;
    }
    setEditing({ source: selectedTarget, date, time, allDay });
  };
  const save = async (event?: CalendarEvent) => {
    if (!editing || busy || saving) return;
    setSaving(true);
    setError("");
    try {
      const source = editing.source;
      if (source) {
        const { document, block } = source;
        const current = documents.find(
          (d) => d.documentId === document.documentId,
        );
        if (!current || current.hash !== document.hash)
          throw Error(
            t(
              "原文已变化，请刷新并重新打开事项。",
              "The source changed. Refresh and reopen this event.",
            ),
          );
        const blockSource = event
          ? saveCalendarEvent(block.text, event)
          : deleteCalendarEvent(block.text, editing.event!.id);
        await onPatch({
          documentId: document.documentId,
          expectedHash: document.hash,
          content: replaceCalendarBlock(document.content, block, blockSource),
        });
      } else if (event && onCreateCalendar) {
        await onCreateCalendar(event);
      } else {
        throw Error(
          t(
            "没有可写的日历文档。",
            "No writable calendar document is available.",
          ),
        );
      }
      if (event && !eventOverlaps(event, range.start, range.end, zone))
        chooseAnchor(eventDay(event, zone));
      finishEditing();
    } catch (e) {
      fail(e);
      throw e;
    } finally {
      setSaving(false);
    }
  };
  const editingSource = editing?.source;
  const currentEditing = editingSource
    ? documents.find((d) => d.documentId === editingSource.document.documentId)
    : undefined;
  return (
    <section
      ref={focus.scope}
      className="project-calendar inkstone-calendar"
      aria-label={msg("项目日历")}
    >
      <ProjectCalendarHeader
        view={view}
        anchor={anchor}
        timeZone={zone}
        range={range}
        busy={busy || saving}
        onView={chooseView}
        onDate={chooseAnchor}
        onNew={
          available.length || onCreateCalendar || onNewDocument
            ? () => add()
            : undefined
        }
        filtered={!showTasks || !showEvents || status !== "all" || !!query}
      >
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
          <button
            onClick={() => {
              try {
                void exportCalendar(
                  calendarIcs(
                    visibleEvents.map(({ event, id, key }) => {
                      const title = Array.from(event.title);
                      // Tracked tasks allow longer titles than the calendar event schema.
                      const summary =
                        title.length > 200
                          ? {
                              title: title.slice(0, 199).join("") + "…",
                              notes: event.title,
                            }
                          : {};
                      return { ...event, ...summary, id, uid: key };
                    }),
                  ),
                  "Inkstone-Calendar.ics",
                ).catch(fail);
              } catch (e) {
                fail(e);
              }
            }}
          >
            {msg("导出 ICS")}
          </button>
        </div>
        <div className="calendar-layer-filters">
          <label>
            <input
              type="checkbox"
              checked={showEvents}
              onChange={(e) => setShowEvents(e.target.checked)}
            />
            {t("显示日程", "Show events")}
          </label>
          <label>
            <input
              type="checkbox"
              checked={showTasks}
              onChange={(e) => setShowTasks(e.target.checked)}
            />
            {t("显示任务", "Show tasks")}
          </label>
        </div>
        <div className="project-calendar-filters">
          {view !== "agenda" && (
            <label>
              {msg("转到日期")}
              <input
                type="date"
                aria-label={msg("日历转到日期")}
                value={anchor}
                onChange={(e) => {
                  if (validCalendarDate(e.target.value))
                    chooseAnchor(e.target.value);
                }}
              />
            </label>
          )}
          {view === "agenda" && (
            <>
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
            </>
          )}
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
      </ProjectCalendarHeader>
      {view === "agenda" && (
        <div className="calendar-range-description">
          <strong>
            {msg("共")} {visibleEvents.length} {msg("个事项")}
          </strong>
          <span>
            {range.start} {msg("至")} {addDays(range.end, -1)} · {zone}{" "}
            {msg("· 完整日期结果")}
          </span>
        </div>
      )}
      <div className="calendar-main-split">
        {taskEditor && (
          <aside className="calendar-inspector">
            <div className="calendar-editor-source">
              <span>{taskEditor.document.title}</span>
              <button
                onClick={() =>
                  onOpen({
                    path: taskEditor.document.path,
                    line: taskEditor.origin.task.line,
                  })
                }
              >
                {msg("回到原文 ↗")}
              </button>
            </div>
            <TaskForm
              key={
                taskEditor.document.documentId +
                ":" +
                (taskEditor.origin?.task.line ?? "new")
              }
              document={taskEditor.document}
              current={documents.find(
                (d) => d.documentId === taskEditor.document.documentId,
              )}
              origin={taskEditor.origin}
              onPatch={onPatch}
              busy={busy}
              onAskForHelp={
                onAskForHelp
                  ? (title) => {
                      // The chat composer owns focus when switching away from the details form.
                      setTaskEditor(null);
                      onAskForHelp(title);
                    }
                  : undefined
              }
              onClose={() => {
                setTaskEditor(null);
                focus.restore();
              }}
            />
          </aside>
        )}
        {editing && (
          <aside className="project-calendar-editor calendar-inspector">
            <div className="calendar-editor-source">
              {msg("保存到：")}
              {editingSource?.document.title ?? t("日程安排.md", "Schedule.md")}
              {editingSource && (
                <button
                  onClick={() =>
                    onOpen({
                      path: editingSource.document.path,
                      line: editingSource.block.line,
                    })
                  }
                >
                  {msg("回到原文 ↗")}
                </button>
              )}
            </div>
            <EventEditor
              key={JSON.stringify([
                editingSource?.document.documentId,
                editingSource?.block.data?.id,
                editing.event?.id,
                editing.date,
                editing.time,
                editing.allDay,
              ])}
              event={editing.event}
              date={editing.date}
              initialTime={editing.time}
              initialAllDay={editing.allDay}
              timeZone={zone}
              busy={busy || saving}
              stale={
                !!editingSource &&
                (!currentEditing ||
                  currentEditing.hash !== editingSource.document.hash)
              }
              onSave={(event) => save(event)}
              onDelete={editing.event ? () => save() : undefined}
              onCancel={() => {
                finishEditing();
                setError("");
              }}
            />
          </aside>
        )}
        <div className="calendar-main-board">
          {view !== "agenda" ? (
            <CalendarBoard
              mode={view}
              onMoveSlot={
                view === "week" && !busy && !saving && !editing && !taskEditor
                  ? moveTaskSlot
                  : undefined
              }
              rows={visibleEvents}
              anchor={anchor}
              timeZone={zone}
              onDate={add}
              onEdit={edit}
            />
          ) : (
            <CalendarAgenda
              rows={visibleEvents}
              timeZone={zone}
              onEdit={edit}
              onOpen={(key) => {
                const dated = datedTasks.find((r) => r.key === key);
                if (dated) {
                  onOpen({
                    path: dated.origin.document.path,
                    line: dated.origin.task.line,
                  });
                  return;
                }
                const row = projection.events.find((r) => r.key === key);
                if (row)
                  onOpen({ path: row.document.path, line: row.block.line });
              }}
            />
          )}
        </div>
      </div>
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
      {error && (
        <p className="calendar-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

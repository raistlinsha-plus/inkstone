import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import ModalDialog from "../ModalDialog";
import { isTaskNote } from "../library/mediaTypes";
import type { LibraryView } from "../library";
import type { FileData, SaveResult } from "../types";
import { useLocale } from "../i18n";
import { appendTrackedTasks } from "../content/tasks";
import {
  actionId,
  choice,
  type ActionChoice,
  type TaskSource,
} from "./chatActions";
import "./chat-tasks.css";

export interface ChatTaskMessage {
  source: TaskSource;
  text: string;
  selection?: string;
  question?: string;
}
type Destination = { id: string; data: FileData };
export interface TaskSave {
  projectId: string;
  documentId: string;
  taskIds: string[];
  before: FileData;
  after: string;
  result: SaveResult;
}
export default function ChatTaskDialog({
  message,
  library,
  currentProject,
  currentPath,
  onClose,
  beforeSave,
  onSaved,
}: {
  message: ChatTaskMessage;
  library: LibraryView;
  currentProject: string;
  currentPath?: string;
  onClose: () => void;
  beforeSave: (documentId: string) => void;
  onSaved: (save: TaskSave) => void;
}) {
  const { t } = useLocale();
  const [includeQuestion, setIncludeQuestion] = useState(false);
  const sourceText = useRef<HTMLTextAreaElement>(null);
  const [project, setProject] = useState(
    message.source.general ? "" : currentProject,
  );
  const projects = library.projects.filter((p) => !p.archived);
  const activeProject = projects.some((p) => p.id === project);
  const docs = library.documents.filter(
    (d) =>
      activeProject &&
      d.projectId === project &&
      d.status === "ready" &&
      isTaskNote(d.path),
  );
  const [documentId, setDocumentId] = useState(
    () => docs.find((d) => d.path === currentPath)?.id ?? "",
  );
  const [target, setTarget] = useState<Destination | null>(null);
  const [rows, setRows] = useState<ActionChoice[]>(() => {
    const selected = message.selection;
    if (
      !selected ||
      message.text.indexOf(selected) !== message.text.lastIndexOf(selected)
    )
      return [];
    const index = message.text.indexOf(selected);
    const item =
      index === -1
        ? undefined
        : choice(message.text, index, index + selected.length);
    return item ? [{ ...item, selected: true }] : [];
  });
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [working, setWorking] = useState(false);
  const lock = useRef(false);
  const activeExtraction = useRef<string | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [generation, reload] = useState(0);
  const selectedNote = docs.some((doc) => doc.id === documentId);
  const createTaskList = activeProject && docs.length === 0;
  useEffect(() => {
    let current = true;
    setTarget(null);
    setError("");
    if (selectedNote)
      void invoke<FileData>("task_document", { projectId: project, documentId })
        .then((data) => {
          if (current) setTarget({ id: documentId, data });
        })
        .catch((e) => {
          if (current) setError(String(e));
        });
    return () => {
      current = false;
    };
  }, [project, documentId, selectedNote, generation]);
  function add(item: ActionChoice, selected: boolean) {
    setRows((old) =>
      old.some(
        (r) =>
          !!r.fromQuestion === !!item.fromQuestion &&
          r.startChar === item.startChar &&
          r.quote === item.quote,
      ) || old.length >= 8
        ? old
        : [...old, { ...item, selected }],
    );
  }
  function addSelection() {
    const el = sourceText.current;
    if (!el) return;
    const item = choice(message.text, el.selectionStart, el.selectionEnd);
    if (item) {
      add(item, true);
      setError("");
    } else
      setError(
        t(
          "请选取 1 至 8000 字原话。",
          "Select 1 to 8,000 characters from the message.",
        ),
      );
  }
  async function extract() {
    if (lock.current) return;
    lock.current = true;
    setWorking(true);
    setError("");
    setNotice("");
    const requestId = crypto.randomUUID();
    activeExtraction.current = requestId;
    setExtracting(true);
    try {
      const suggestions = await invoke<
        { title: string; quote: string; role?: string }[]
      >("task_extract", { source: message.source, includeQuestion, requestId });
      if (activeExtraction.current !== requestId) return;
      for (const s of suggestions) {
        const fromQuestion =
          includeQuestion &&
          message.source.candidateId !== null &&
          s.role === "user";
        const origin = fromQuestion ? (message.question ?? "") : message.text;
        const start = origin.indexOf(s.quote);
        if (start < 0) continue;
        const item = choice(origin, start, start + s.quote.length, s.title);
        if (item) add({ ...item, fromQuestion }, false);
      }
      setNotice(
        suggestions.length
          ? t(
              "请逐项核对并勾选。",
              "Review and select the suggestions to keep.",
            )
          : t(
              "未提取到可对应原话的行动。可手选原文。",
              "No matching actions found. You can still select a passage.",
            ),
      );
    } catch (e) {
      if (activeExtraction.current === requestId) setError(String(e));
    } finally {
      activeExtraction.current = null;
      setExtracting(false);
      lock.current = false;
      setWorking(false);
    }
  }
  async function stopExtraction() {
    const requestId = activeExtraction.current;
    if (!requestId) return;
    activeExtraction.current = null;
    setNotice(
      t(
        "已停止提取，可手选原话。",
        "Extraction stopped. You can select a passage.",
      ),
    );
    try {
      await invoke("cancel_chat", { requestId });
    } catch (e) {
      setError(String(e));
    }
  }
  const selected = rows.filter((r) => r.selected);
  const ready =
    createTaskList ||
    (selectedNote &&
      target?.id === documentId &&
      target &&
      !target.data.missing &&
      !target.data.draft);
  async function save() {
    if (!ready || lock.current || !selected.length) return;
    lock.current = true;
    setWorking(true);
    setError("");
    try {
      if (createTaskList) beforeSave("");
      const destination = createTaskList
        ? await invoke<Destination>("task_prepare_chat_note", {
            projectId: project,
            title: t("任务清单.md", "Tasks.md"),
            source: message.source,
          })
        : target;
      if (!destination) return;
      const { id, data } = destination;
      if (data.missing || data.draft)
        throw Error(
          t(
            "请先打开目标文档核对待恢复的编辑。",
            "Open the note to resolve pending edits first.",
          ),
        );
      const tasks = await Promise.all(
        selected.map(async (r) => ({
          id: await actionId(message.source, id, r),
          title: r.title.trim(),
          ...(r.due ? { due: r.due } : {}),
        })),
      );
      const after = appendTrackedTasks(data.content, tasks);
      beforeSave(id);
      const result = await invoke<SaveResult>("task_save_from_chat", {
        projectId: project,
        documentId: id,
        expectedHash: data.hash,
        content: after,
        source: message.source,
        quotes: tasks.map((task, i) => ({
          taskId: task.id,
          startChar: selected[i].startChar,
          quote: selected[i].quote,
          fromQuestion: !!selected[i].fromQuestion,
        })),
      });
      onSaved({
        projectId: project,
        documentId: id,
        taskIds: tasks.map((task) => task.id),
        before: data,
        after,
        result,
      });
      onClose();
    } catch (e) {
      setError(String(e));
    } finally {
      lock.current = false;
      setWorking(false);
    }
  }
  function update(index: number, patch: Partial<ActionChoice>) {
    setRows((old) => old.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  }
  return (
    <ModalDialog
      label={t("从聊天创建任务", "Create tasks from chat")}
      onClose={onClose}
      busy={working}
      className="chat-task-dialog"
    >
      <h2>{t("从聊天创建任务", "Create tasks from chat")}</h2>
      <label>
        {message.source.candidateId
          ? t("AI 建议 · 选择原话", "Assistant suggestion · select a passage")
          : t("你说 · 选择原话", "Your message · select a passage")}
        <textarea ref={sourceText} value={message.text} rows={4} readOnly />
      </label>
      {message.question && (
        <label>
          <span>
            <input
              type="checkbox"
              checked={includeQuestion}
              disabled={working}
              onChange={(e) => setIncludeQuestion(e.target.checked)}
            />{" "}
            {t("提取时包含本轮提问", "Include my question in extraction")}
          </span>
          {includeQuestion && <q>{message.question}</q>}
        </label>
      )}
      <div className="chat-task-actions">
        <button disabled={working || rows.length >= 8} onClick={addSelection}>
          {t("添加所选原话", "Add selection")}
        </button>
        <button
          disabled={
            working ||
            rows.length >= 8 ||
            Array.from(message.text).length +
              (includeQuestion
                ? Array.from(message.question ?? "").length
                : 0) >
              8000
          }
          onClick={() => void extract()}
        >
          {t("用问答模型提取", "Extract with chat model")}
        </button>
        {extracting && (
          <button onClick={() => void stopExtraction()}>
            {t("停止提取", "Stop extraction")}
          </button>
        )}
      </div>
      <small>
        {t(
          "提取仅发送上面选定的消息。勾选并保存后，任务才会写入笔记。",
          "Extraction sends only the selected messages above. Select and save to add tasks to your note.",
        )}
      </small>
      {rows.map((r, i) => (
        <fieldset
          key={Number(!!r.fromQuestion) + ":" + r.startChar + ":" + r.quote}
        >
          <small>
            {r.fromQuestion || !message.source.candidateId
              ? t("你说", "You wrote")
              : t("AI 建议", "Assistant suggestion")}
          </small>
          <label>
            <input
              type="checkbox"
              checked={r.selected}
              disabled={working}
              onChange={(e) => update(i, { selected: e.target.checked })}
            />
            {r.quote}
          </label>
          <label>
            {t("任务标题", "Task title")}
            <input
              value={r.title}
              maxLength={240}
              disabled={working}
              onChange={(e) => update(i, { title: e.target.value })}
            />
          </label>
          <label>
            {t("截止日", "Due date")}
            <input
              type="date"
              value={r.due}
              disabled={working}
              onChange={(e) => update(i, { due: e.target.value })}
            />
          </label>
          <button
            disabled={working}
            onClick={() => setRows((old) => old.filter((_, j) => j !== i))}
          >
            {t("移除", "Remove")}
          </button>
        </fieldset>
      ))}
      <label>
        {t("目标空间", "Destination space")}
        <select
          disabled={working || !message.source.general}
          value={project}
          onChange={(e) => {
            setProject(e.target.value);
            setDocumentId("");
          }}
        >
          <option value="">{t("选择空间", "Choose a space")}</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.title}
            </option>
          ))}
        </select>
      </label>
      <label>
        {t("目标 Markdown 文档", "Destination Markdown note")}
        <select
          disabled={working || !activeProject || createTaskList}
          value={documentId}
          onChange={(e) => setDocumentId(e.target.value)}
        >
          <option value="">
            {createTaskList
              ? t("任务清单（确认保存时创建）", "Task list (created on save)")
              : t("选择文档", "Choose a note")}
          </option>
          {docs.map((d) => (
            <option key={d.id} value={d.id}>
              {d.title}
            </option>
          ))}
        </select>
      </label>
      {target && !ready && (
        <p role="alert">
          {t(
            "该文档有待恢复的编辑或已移除，请先打开核对。",
            "Open this note first to resolve pending edits or a missing file.",
          )}
        </p>
      )}
      {error && (
        <div role="alert">
          {error}{" "}
          {documentId && (
            <button disabled={working} onClick={() => reload((v) => v + 1)}>
              {t("重读目标文档", "Reload destination")}
            </button>
          )}
        </div>
      )}
      {notice && <p role="status">{notice}</p>}
      <div className="chat-task-actions">
        <button disabled={working} onClick={onClose}>
          {t("取消", "Cancel")}
        </button>
        <button
          className="primary"
          disabled={
            !ready ||
            working ||
            selected.length === 0 ||
            selected.some((r) => !r.title.trim())
          }
          onClick={() => void save()}
        >
          {t("保存到文档", "Save to note")} · {selected.length}
        </button>
      </div>
    </ModalDialog>
  );
}

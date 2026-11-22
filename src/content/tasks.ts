import { parseMarkdown, type MarkdownNode } from "./blocks";
import { validDate, validTimeZone, validateInstant } from "./calendar";
import { inspectJson } from "./json";

export interface TaskMeta {
  id: string;
  due?: string;
  waiting?: boolean;
  followOn?: string;
  slot?: { start: string; end: string; zone: string };
}
export interface TaskDraft extends TaskMeta {
  title: string;
  done?: boolean;
}
export interface TrackedTask extends TaskDraft {
  done: boolean;
  line: number;
  markerFrom: number;
  markerTo: number;
  checkFrom: number;
  titleFrom: number;
  duplicate: boolean;
}
const prefix = "<!--inkstone-task:v1 ";
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
function validMeta(value: unknown): value is TaskMeta {
  if (
    !record(value) ||
    typeof value.id !== "string" ||
    !uuid.test(value.id) ||
    Object.keys(value).some(
      (key) => !["id", "due", "waiting", "followOn", "slot"].includes(key),
    )
  )
    return false;
  if (
    [value.due, value.followOn].some(
      (date) =>
        date !== undefined && (typeof date !== "string" || !validDate(date)),
    )
  )
    return false;
  if (
    (value.waiting !== undefined && typeof value.waiting !== "boolean") ||
    (value.followOn && !value.waiting)
  )
    return false;
  if (value.slot === undefined) return true;
  const slot = value.slot;
  if (
    !record(slot) ||
    Object.keys(slot).length !== 3 ||
    typeof slot.start !== "string" ||
    typeof slot.end !== "string" ||
    typeof slot.zone !== "string" ||
    !validTimeZone(slot.zone)
  )
    return false;
  try {
    return (
      validateInstant(slot.start, slot.zone) <
      validateInstant(slot.end, slot.zone)
    );
  } catch {
    return false;
  }
}
export function taskMarker(draft: TaskMeta) {
  const { id, due, waiting, followOn, slot } = draft;
  const meta = { id, due, waiting, followOn, slot };
  if (!validMeta(meta)) throw Error("Invalid task ID, dates or time slot.");
  return prefix + JSON.stringify(meta) + "-->";
}
export function readTaskMarker(value?: string): TaskMeta | null {
  if (
    !value?.startsWith(prefix) ||
    !value.endsWith("-->") ||
    value.length > 2048
  )
    return null;
  const raw = value.slice(prefix.length, -3);
  const check = inspectJson(raw);
  if (check.duplicate || check.errors.length) return null;
  try {
    const meta: unknown = JSON.parse(raw);
    return validMeta(meta) ? meta : null;
  } catch {
    return null;
  }
}
export function taskAnnotation(item: MarkdownNode) {
  if (
    item.type !== "listItem" ||
    typeof (item as MarkdownNode & { checked?: unknown }).checked !== "boolean"
  )
    return null;
  const children = item.children?.[0]?.children ?? [];
  const index = children.findIndex(
    (node, i) =>
      node.type === "html" &&
      node.position.start.line === item.position.start.line &&
      (!children[i + 1] ||
        children[i + 1].type === "break" ||
        (children[i + 1].position?.start.line ?? 0) >
          item.position.start.line ||
        /^[ \t]*\r?\n/.test(children[i + 1].value ?? "")),
  );
  if (index < 0) return null;
  const node = children[index],
    meta = readTaskMarker(node.value);
  return meta ? { node, meta, index } : null;
}
export function scanTrackedTasks(content: string): TrackedTask[] {
  if (!content.includes(prefix)) return [];
  const rows: TrackedTask[] = [];
  function visit(node: MarkdownNode) {
    if (node.type === "blockquote") return;
    const annotation = taskAnnotation(node);
    if (annotation) {
      const start = node.position.start.offset,
        markerFrom = annotation.node.position.start.offset;
      const first = content.slice(start, markerFrom);
      const match = /^(?:[-*+]|\d{1,9}[.)])[ \t]+\[([ xX])\][ \t]+/.exec(first);
      if (match && !/[\r\n]/.test(first)) {
        const checkFrom = start + match[0].indexOf("[") + 1,
          titleFrom = start + match[0].length;
        rows.push({
          ...annotation.meta,
          title: content.slice(titleFrom, markerFrom).trimEnd(),
          done: match[1] !== " ",
          line: node.position.start.line,
          checkFrom,
          titleFrom,
          markerFrom,
          markerTo: annotation.node.position.end.offset,
          duplicate: false,
        });
      }
    }
    node.children?.forEach(visit);
  }
  visit(parseMarkdown(content));
  const ids = new Set<string>(),
    duplicates = new Set<string>();
  for (const task of rows) {
    const id = task.id.toLowerCase();
    if (ids.has(id)) duplicates.add(id);
    ids.add(id);
  }
  for (const task of rows)
    task.duplicate = duplicates.has(task.id.toLowerCase());
  return rows;
}
function titleOf(title: string) {
  if (
    !title.trim() ||
    title.length > 1500 ||
    /[\r\n\u0000-\u001f]|<!--|-->/.test(title)
  )
    throw Error("Enter a single-line task title (1–1500 characters).");
  return title.trim();
}
export function taskLine(task: TaskDraft) {
  return (
    "- [" +
    (task.done ? "x" : " ") +
    "] " +
    titleOf(task.title) +
    " " +
    taskMarker(task)
  );
}
export function appendTrackedTasks(
  content: string,
  tasks: readonly TaskDraft[],
) {
  const existing = new Set(
    scanTrackedTasks(content).map((task) => task.id.toLowerCase()),
  );
  const lines: string[] = [];
  const eol = content.includes("\r\n") ? "\r\n" : "\n";
  for (const task of tasks) {
    const line = taskLine(task),
      id = task.id.toLowerCase();
    if (existing.has(id)) continue;
    lines.push(line);
    existing.add(id);
  }
  if (!lines.length) return content;
  const gap =
    content.length === 0
      ? ""
      : content.endsWith(eol + eol)
        ? ""
        : content.endsWith(eol)
          ? eol
          : eol + eol;
  const updated = content + gap + lines.join(eol) + eol;
  const added = new Set(
    scanTrackedTasks(updated).map((t) => t.id.toLowerCase()),
  );
  if (!tasks.every((t) => added.has(t.id.toLowerCase())))
    throw Error(
      "Cannot append tasks here. Check the document for an unclosed code fence or HTML block.",
    );
  return updated;
}
export function changeTrackedTask(
  content: string,
  task: TrackedTask,
  next: TaskDraft | null,
) {
  const current = scanTrackedTasks(content).find(
    (t) => t.id === task.id && t.line === task.line,
  );
  if (!current || current.duplicate)
    throw Error("Task moved or has a duplicate ID. Reopen its source.");
  if (next === null)
    return (
      content.slice(0, current.markerFrom).trimEnd() +
      content.slice(current.markerTo)
    );
  if (next.id !== current.id) throw Error("Task ID changed.");
  const title =
    next.title === current.title ? current.title : titleOf(next.title);
  const updated =
    content.slice(0, current.checkFrom) +
    (next.done ? "x" : " ") +
    content.slice(current.checkFrom + 1, current.titleFrom) +
    title +
    " " +
    taskMarker(next) +
    content.slice(current.markerTo);
  if (
    !scanTrackedTasks(updated).some(
      (t) => t.id === current.id && t.title === title,
    )
  )
    throw Error("This Markdown title hides the task marker. Check the title.");
  return updated;
}

/** Source mode promotes an existing GFM item in place. Fences and quoted examples remain literal. */
export function trackSourceSelection(
  content: string,
  from: number,
  to: number,
  fallback: string,
) {
  const start = content.lastIndexOf("\n", Math.max(0, from - 1)) + 1;
  const next = content.indexOf("\n", from);
  const end =
    next < 0 ? content.length : content[next - 1] === "\r" ? next - 1 : next;
  const currentLine = content.slice(start, end);
  const id = crypto.randomUUID();
  const marker = taskMarker({ id });
  let ordinary = false;
  const checkChange = (start: number, end: number, insert: string) => {
    const updated = content.slice(0, start) + insert + content.slice(end);
    if (!scanTrackedTasks(updated).some((row) => row.id === id))
      throw Error(
        "Choose a Markdown paragraph or checkbox outside code and quotes.",
      );
    return { from: start, to: end, insert };
  };
  const visit = (node: MarkdownNode) => {
    if (node.type === "blockquote" || node.type === "code") return;
    if (
      node.type === "listItem" &&
      typeof (node as MarkdownNode & { checked?: unknown }).checked ===
        "boolean" &&
      node.position.start.offset >= start &&
      node.position.start.offset <= end
    )
      ordinary = true;
    node.children?.forEach(visit);
  };
  visit(parseMarkdown(content));
  if (ordinary && to <= end) {
    if (currentLine.includes("<!--inkstone-task:"))
      return { from: to, to, insert: "" };
    return checkChange(end, end, " " + marker);
  }
  const selection = content.slice(from, to);
  // Selected multiline Markdown may contain essential lines: preserve it and append a new task.
  const eol = content.includes("\r\n") ? "\r\n" : "\n";
  const multi = /[\r\n]/.test(selection);
  const insert =
    eol +
    eol +
    taskLine({
      id,
      title: multi ? fallback : selection.trim() || fallback,
    }) +
    eol +
    eol;
  return checkChange(multi ? to : from, to, insert);
}

/** Keep task IDs out of search snippets; keep checkbox text and useful scheduling context. */
export function taskRetrievalText(content: string) {
  const tasks = scanTrackedTasks(content);
  if (!tasks.length) return content;
  const parts: string[] = [];
  let start = 0;
  for (const task of tasks) {
    parts.push(content.slice(start, task.markerFrom).trimEnd());
    if (task.due) parts.push(" · due ", task.due);
    if (task.followOn) parts.push(" · follow-up ", task.followOn);
    if (task.slot)
      parts.push(" · scheduled ", task.slot.start, "–", task.slot.end);
    start = task.markerTo;
  }
  parts.push(content.slice(start));
  return parts.join("");
}

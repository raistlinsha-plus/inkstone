import { applyEdits, modify } from "jsonc-parser";
import { Temporal } from "temporal-polyfill";
import { parseMarkdown, type MarkdownNode, type ContentBlock } from "./blocks";
import { inspectJson } from "./json";

export type CalendarStatus = "planned" | "done" | "cancelled";
export type CalendarMode = "agenda" | "month";
export interface CalendarEvent {
  id: string;
  title: string;
  start: string;
  end: string;
  timeZone: string;
  allDay: boolean;
  status: CalendarStatus;
  notes: string;
  [key: string]: unknown;
}
export interface CalendarData {
  schema: "inkstone.calendar/v1";
  id: string;
  view: CalendarMode;
  timeZone: string;
  events: CalendarEvent[];
  [key: string]: unknown;
}
export interface CalendarDocument {
  documentId: string;
  title: string;
  path: string;
  content: string;
  hash: string;
}
export interface CalendarContentBlock extends ContentBlock {
  data: CalendarData | null;
  error: string | null;
  rawText?: string;
  bodyPrefix?: string;
  eol?: string;
}
export interface ProjectEvent {
  key: string;
  event: CalendarEvent;
  block: CalendarContentBlock;
  document: CalendarDocument;
}
export interface DateRange {
  start: string;
  end: string;
  label: string;
  terms: string;
}
const idPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const instantPattern =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
export function validTimeZone(zone: string) {
  if (!zone || zone.length > 80 || /^[+-]/.test(zone)) return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: zone }).format(0);
    Temporal.Instant.fromEpochMilliseconds(0).toZonedDateTimeISO(zone);
    return true;
  } catch {
    return false;
  }
}
export function currentTimeZone() {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return validTimeZone(zone) ? zone : "Asia/Shanghai";
}
export function validDate(value: string) {
  if (!datePattern.test(value) || value.startsWith("0000")) return false;
  try {
    return (
      Temporal.PlainDate.from(value, { overflow: "reject" }).toString() ===
      value
    );
  } catch {
    return false;
  }
}
export function dateInZone(now = new Date(), timeZone = currentTimeZone()) {
  return Temporal.Instant.fromEpochMilliseconds(now.getTime())
    .toZonedDateTimeISO(timeZone)
    .toPlainDate()
    .toString();
}
export function addDays(date: string, days: number) {
  return Temporal.PlainDate.from(date).add({ days }).toString();
}
export function monthRange(date: string): DateRange {
  const start = Temporal.PlainDate.from(date).with({ day: 1 });
  return {
    start: start.toString(),
    end: start.add({ months: 1 }).toString(),
    label: `${start.year} 年 ${start.month} 月`,
    terms: "",
  };
}
function validateInstant(value: string, zone: string) {
  if (
    !instantPattern.test(value) ||
    value.startsWith("0000") ||
    value.slice(16, 19) === ":60"
  )
    throw Error("有时间的事项需要带时区偏移的 ISO 时间。");
  // An offset must agree with its IANA zone, including DST transition dates.
  const zoned = Temporal.ZonedDateTime.from(`${value}[${zone}]`, {
    offset: "reject",
    disambiguation: "reject",
    overflow: "reject",
  });
  return zoned.epochMilliseconds;
}
export function parseCalendar(source: string): CalendarData {
  if (source.length > 300_000 && Array.from(source).length > 300_000)
    throw Error("日历块超过 300,000 字符，请拆分内容。");
  const state = inspectJson(source);
  if (state.errors.length || state.duplicate)
    throw Error(
      state.duplicate
        ? "日历 JSON 有重复字段，原文已保留。"
        : "日历 JSON 尚未完整，请在代码中修正。",
    );
  const data: unknown = JSON.parse(source);
  if (!object(data) || data.schema !== "inkstone.calendar/v1")
    throw Error("无法识别日历格式版本，原文已保留。");
  if (typeof data.id !== "string" || !idPattern.test(data.id))
    throw Error("日历块需要有效的稳定 UUID。");
  if (data.view !== "agenda" && data.view !== "month")
    throw Error("日历视图应为 agenda 或 month。");
  if (typeof data.timeZone !== "string" || !validTimeZone(data.timeZone))
    throw Error("日历时区无效，请填写 IANA 时区，如 Asia/Shanghai。");
  if (!Array.isArray(data.events) || data.events.length > 500)
    throw Error("每个日历块最多保存 500 个事项。");
  const ids = new Set<string>();
  for (const [index, entry] of data.events.entries()) {
    const prefix = `第 ${index + 1} 个事项：`;
    if (!object(entry)) throw Error(prefix + "格式无效。");
    if (
      typeof entry.id !== "string" ||
      !idPattern.test(entry.id) ||
      ids.has(entry.id.toLowerCase())
    )
      throw Error(prefix + "事项 UUID 无效或重复。");
    ids.add(entry.id.toLowerCase());
    if (
      typeof entry.title !== "string" ||
      !entry.title.trim() ||
      Array.from(entry.title).length > 200 ||
      /[\r\n\u0000]/.test(entry.title)
    )
      throw Error(prefix + "标题需为 1～200 字符的单行文字。");
    if (
      typeof entry.notes !== "string" ||
      Array.from(entry.notes).length > 20_000 ||
      entry.notes.includes("\u0000")
    )
      throw Error(prefix + "备注需为不超过 20,000 字符的文字。");
    if (
      typeof entry.status !== "string" ||
      !["planned", "done", "cancelled"].includes(entry.status)
    )
      throw Error(prefix + "状态应为 planned、done 或 cancelled。");
    if (typeof entry.timeZone !== "string" || !validTimeZone(entry.timeZone))
      throw Error(prefix + "时区无效。");
    if (
      typeof entry.allDay !== "boolean" ||
      typeof entry.start !== "string" ||
      typeof entry.end !== "string"
    )
      throw Error(prefix + "开始、结束或全天字段无效。");
    if (entry.allDay) {
      if (
        !validDate(entry.start) ||
        !validDate(entry.end) ||
        entry.end <= entry.start
      )
        throw Error(
          prefix + "全天事项使用有效日期，结束日应晚于开始日且不包含当天。",
        );
    } else {
      try {
        if (
          validateInstant(entry.end, entry.timeZone) <=
          validateInstant(entry.start, entry.timeZone)
        )
          throw Error("结束需晚于开始");
      } catch {
        throw Error(
          prefix + "时间或时区偏移无效；请检查结束晚于开始及夏令时。",
        );
      }
    }
  }
  return data as unknown as CalendarData;
}
export function inspectCalendar(source: string) {
  try {
    return { data: parseCalendar(source), error: null };
  } catch (e) {
    return { data: null, error: e instanceof Error ? e.message : String(e) };
  }
}
export function calendarTemplate(view: CalendarMode = "agenda") {
  return JSON.stringify(
    {
      schema: "inkstone.calendar/v1",
      id: crypto.randomUUID(),
      view,
      timeZone: currentTimeZone(),
      events: [],
    },
    null,
    2,
  );
}
function jsonChange(
  source: string,
  path: (string | number)[],
  value: unknown,
  insert = false,
) {
  return applyEdits(
    source,
    modify(source, path, value, {
      isArrayInsertion: insert,
      formattingOptions: {
        insertSpaces: true,
        tabSize: 2,
        eol: source.includes("\r\n") ? "\r\n" : "\n",
      },
    }),
  );
}
export function setCalendarView(source: string, view: CalendarMode) {
  parseCalendar(source);
  return jsonChange(source, ["view"], view);
}
export function saveCalendarEvent(source: string, event: CalendarEvent) {
  const data = parseCalendar(source);
  parseCalendar(JSON.stringify({ ...data, events: [event] }));
  const index = data.events.findIndex(
    (e) => e.id.toLowerCase() === event.id.toLowerCase(),
  );
  if (index < 0) {
    if (data.events.length >= 500)
      throw Error("每个日历块最多保存 500 个事项。");
    const next = jsonChange(
      source,
      ["events", data.events.length],
      event,
      true,
    );
    parseCalendar(next);
    return next;
  }
  let next = source;
  for (const field of [
    "title",
    "start",
    "end",
    "timeZone",
    "allDay",
    "status",
    "notes",
  ] as const) {
    if (data.events[index][field] !== event[field])
      next = jsonChange(next, ["events", index, field], event[field]);
  }
  parseCalendar(next);
  return next;
}
export function deleteCalendarEvent(source: string, id: string) {
  const data = parseCalendar(source),
    index = data.events.findIndex(
      (e) => e.id.toLowerCase() === id.toLowerCase(),
    );
  if (index < 0) throw Error("事项已变化，请刷新后重试。");
  return jsonChange(source, ["events", index], undefined);
}
export function cloneCalendarSource(source: string) {
  const state = inspectCalendar(source);
  if (!state.data) return source;
  const root = inspectJson(source).root!;
  const property = (node: typeof root, name: string) =>
    node.children?.find((p) => p.children?.[0]?.value === name)?.children?.[1];
  const idNodes = [
    property(root, "id"),
    ...(property(root, "events")?.children ?? []).map((node) =>
      property(node, "id"),
    ),
  ].filter((n) => !!n);
  let next = source;
  for (const node of idNodes.sort((a, b) => b.offset - a.offset)) {
    next =
      next.slice(0, node.offset) +
      JSON.stringify(crypto.randomUUID()) +
      next.slice(node.offset + node.length);
  }
  return next;
}
export function calendarBlocks(content: string): CalendarContentBlock[] {
  const parsed: CalendarContentBlock[] = [];
  const visit = (node: MarkdownNode) => {
    if (node.type === "code" && node.lang?.toLowerCase() === "calendar") {
      const raw = content.slice(
        node.position.start.offset,
        node.position.end.offset,
      );
      const firstEnd = raw.indexOf("\n"),
        opening = raw.match(/^(`{3,}|~{3,})/);
      const closing = raw.match(/\n([ \t>]*)(`{3,}|~{3,})[ \t]*$/);
      const closed =
        firstEnd >= 0 &&
        opening &&
        closing &&
        opening[1][0] === closing[2][0] &&
        closing[2].length >= opening[1].length;
      const from = node.position.start.offset + Math.max(0, firstEnd + 1);
      const to = closed
        ? node.position.start.offset + closing.index!
        : node.position.end.offset;
      const rawText = content.slice(from, to),
        bodyPrefix = closed ? closing[1] : "";
      const text = bodyPrefix ? (node.value ?? rawText) : rawText;
      parsed.push({
        id: `${node.position.start.offset}:calendar`,
        lang: "calendar",
        text,
        from,
        to,
        line: node.position.start.line + 1,
        endLine: node.position.end.line - 1,
        rawText,
        bodyPrefix,
        eol: raw.includes("\r\n") ? "\r\n" : "\n",
        ...(closed
          ? inspectCalendar(text)
          : {
              data: null,
              error: "日历代码围栏尚未闭合，请在原文完成后再编辑事项。",
            }),
      });
    }
    node.children?.forEach(visit);
  };
  visit(parseMarkdown(content));
  const counts = new Map<string, number>();
  parsed.forEach((block) => {
    if (block.data)
      counts.set(
        block.data.id.toLowerCase(),
        (counts.get(block.data.id.toLowerCase()) ?? 0) + 1,
      );
  });
  return parsed.map((block) =>
    block.data && counts.get(block.data.id.toLowerCase())! > 1
      ? {
          ...block,
          data: null,
          error: "同一文档中的日历块 ID 重复，请在代码中修正或重新插入。",
        }
      : block,
  );
}
export function replaceCalendarBlock(
  content: string,
  block: CalendarContentBlock,
  nextSource: string,
) {
  if (content.slice(block.from, block.to) !== (block.rawText ?? block.text))
    throw Error("文档中的日历块已变化，请刷新后重试。");
  parseCalendar(nextSource);
  const replacement = block.bodyPrefix
    ? nextSource
        .split(/\r?\n/)
        .map((line) => block.bodyPrefix + line)
        .join(block.eol ?? "\n")
    : nextSource;
  return content.slice(0, block.from) + replacement + content.slice(block.to);
}
export function projectEvents(documents: CalendarDocument[]) {
  const events: ProjectEvent[] = [],
    warnings: string[] = [];
  for (const document of documents)
    for (const block of calendarBlocks(document.content)) {
      if (!block.data) {
        warnings.push(`${document.title}，第 ${block.line} 行：${block.error}`);
        continue;
      }
      for (const event of block.data.events)
        events.push({
          key: `${document.documentId}:${block.data.id}:${event.id}`,
          event,
          block,
          document,
        });
    }
  return { events, warnings };
}
export function eventDay(event: CalendarEvent, timeZone = event.timeZone) {
  return event.allDay
    ? event.start
    : Temporal.Instant.from(event.start)
        .toZonedDateTimeISO(timeZone)
        .toPlainDate()
        .toString();
}
export function eventEndDay(
  event: Pick<CalendarEvent, "allDay" | "end" | "timeZone">,
  timeZone = event.timeZone,
) {
  if (event.allDay) return event.end;
  const end = Temporal.Instant.from(event.end).toZonedDateTimeISO(timeZone);
  const day = end.toPlainDate().toString();
  return end.hour === 0 &&
    end.minute === 0 &&
    end.second === 0 &&
    end.millisecond === 0
    ? day
    : addDays(day, 1);
}
export function eventOverlaps(
  event: CalendarEvent,
  start: string,
  end: string,
  timeZone = event.timeZone,
) {
  if (event.allDay) return event.start < end && event.end > start;
  const from =
    Temporal.PlainDate.from(start).toZonedDateTime(timeZone).epochMilliseconds;
  const to =
    Temporal.PlainDate.from(end).toZonedDateTime(timeZone).epochMilliseconds;
  return (
    Temporal.Instant.from(event.start).epochMilliseconds < to &&
    Temporal.Instant.from(event.end).epochMilliseconds > from
  );
}
export function filterCalendarEvents<T extends { event: CalendarEvent }>(
  events: T[],
  range: Pick<DateRange, "start" | "end">,
  status = "all",
  query = "",
  timeZone = currentTimeZone(),
) {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return events
    .filter(
      ({ event }) =>
        eventOverlaps(event, range.start, range.end, timeZone) &&
        (status === "all" || event.status === status) &&
        terms.every((q) =>
          `${event.title}\n${event.notes}`.toLocaleLowerCase().includes(q),
        ),
    )
    .sort((a, b) => {
      const epoch = (e: CalendarEvent) =>
        e.allDay
          ? Temporal.PlainDate.from(e.start).toZonedDateTime(timeZone)
              .epochMilliseconds
          : Temporal.Instant.from(e.start).epochMilliseconds;
      return (
        epoch(a.event) - epoch(b.event) ||
        a.event.title.localeCompare(b.event.title)
      );
    });
}
export function instantInZone(value: string, timeZone: string) {
  return Temporal.Instant.from(value)
    .toZonedDateTimeISO(timeZone)
    .toString({ timeZoneName: "never", calendarName: "never" });
}
export function dateTimeInput(value: string, timeZone: string) {
  return Temporal.Instant.from(value)
    .toZonedDateTimeISO(timeZone)
    .toPlainDateTime()
    .toString({ smallestUnit: "minute" });
}
export function zonedInput(value: string, timeZone: string) {
  try {
    return Temporal.PlainDateTime.from(value, { overflow: "reject" })
      .toZonedDateTime(timeZone, { disambiguation: "reject" })
      .toString({
        smallestUnit: "second",
        timeZoneName: "never",
        calendarName: "never",
      });
  } catch {
    throw Error("此本地时间不存在或有夏令时歧义，请调整时间或使用明确的时区。");
  }
}
export function eventTimeLabel(
  event: CalendarEvent,
  displayZone = event.timeZone,
) {
  if (event.allDay)
    return event.end === addDays(event.start, 1)
      ? `${event.start} · 全天`
      : `${event.start} 至 ${addDays(event.end, -1)} · 全天`;
  const start = Temporal.Instant.from(event.start).toZonedDateTimeISO(
    displayZone,
  );
  const end = Temporal.Instant.from(event.end).toZonedDateTimeISO(displayZone);
  const clock = (n: number) => String(n).padStart(2, "0");
  const startText = `${start.toPlainDate()} ${clock(start.hour)}:${clock(start.minute)}`;
  const endText = `${start.toPlainDate().equals(end.toPlainDate()) ? "" : end.toPlainDate() + " "}${clock(end.hour)}:${clock(end.minute)}`;
  return `${startText}–${endText}`;
}
export function dateQuery(
  query: string,
  now = new Date(),
  timeZone = currentTimeZone(),
): DateRange | null {
  const today = Temporal.PlainDate.from(dateInZone(now, timeZone));
  let start: typeof today, end: typeof today, match: string, label: string;
  const explicit = query.match(
    /(\d{4}-\d{2}-\d{2})(?:\s*(?:至|到|~|～)\s*(\d{4}-\d{2}-\d{2}))?/,
  );
  if (explicit) {
    if (
      !validDate(explicit[1]) ||
      (explicit[2] && (!validDate(explicit[2]) || explicit[2] < explicit[1]))
    )
      return null;
    start = Temporal.PlainDate.from(explicit[1]);
    end = Temporal.PlainDate.from(explicit[2] ?? explicit[1]).add({ days: 1 });
    match = explicit[0];
    label = explicit[2] ? `${explicit[1]} 至 ${explicit[2]}` : explicit[1];
  } else {
    const relative = query.match(
      /今天|明天|后天|本周|这周|下周|本月|这个月|下个月|下月/,
    );
    if (!relative) return null;
    match = relative[0];
    label = match;
    if (["今天", "明天", "后天"].includes(match)) {
      start = today.add({ days: ["今天", "明天", "后天"].indexOf(match) });
      end = start.add({ days: 1 });
    } else if (["本周", "这周", "下周"].includes(match)) {
      start = today
        .subtract({ days: today.dayOfWeek - 1 })
        .add({ days: match === "下周" ? 7 : 0 });
      end = start.add({ days: 7 });
    } else {
      start = today
        .with({ day: 1 })
        .add({ months: match === "下月" || match === "下个月" ? 1 : 0 });
      end = start.add({ months: 1 });
    }
  }
  const terms = query
    .replace(match, " ")
    .replace(/[？?！!，,。；;]/g, " ")
    .replace(
      /(?:帮我|所有|有(?:哪些|什么)?|哪些|什么|我的|我|请|查看|查询|查找|安排|日程|事项|一下|列出|的|吗|呢|是|时候)/g,
      " ",
    )
    .replace(/\s+/g, " ")
    .trim();
  return {
    start: start.toString(),
    end: end.toString(),
    label: `${label} · ${start} 至 ${end.subtract({ days: 1 })}（${timeZone}）`,
    terms,
  };
}
function icsEscape(value: string) {
  return value
    .replaceAll("\\", "\\\\")
    .replace(/\r\n|\r|\n/g, "\\n")
    .replaceAll(";", "\\;")
    .replaceAll(",", "\\,");
}
function foldIcs(line: string) {
  const encoder = new TextEncoder();
  let length = 0,
    result = "";
  for (const char of line) {
    const bytes = encoder.encode(char).length;
    if (length + bytes > 75) {
      result += "\r\n ";
      length = 1;
    }
    result += char;
    length += bytes;
  }
  return result;
}
export function calendarIcs(
  events: (CalendarEvent & { uid?: string })[],
  now = new Date(),
) {
  const stamp = now
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Inkstone//Local Calendar v1//ZH-CN",
    "CALSCALE:GREGORIAN",
  ];
  for (const event of events) {
    const data: CalendarData = {
      schema: "inkstone.calendar/v1",
      id: crypto.randomUUID(),
      view: "agenda",
      timeZone: event.timeZone,
      events: [event],
    };
    parseCalendar(JSON.stringify(data));
    lines.push(
      "BEGIN:VEVENT",
      `UID:${icsEscape(typeof event.uid === "string" ? event.uid : event.id)}@inkstone.local`,
      `DTSTAMP:${stamp}`,
    );
    if (event.allDay)
      lines.push(
        `DTSTART;VALUE=DATE:${event.start.replaceAll("-", "")}`,
        `DTEND;VALUE=DATE:${event.end.replaceAll("-", "")}`,
      );
    else {
      // RFC 5545 stores whole seconds: cover the complete source interval.
      const utc = (value: string, roundingMode: "floor" | "ceil") => {
        const result = Temporal.Instant.from(value)
          .round({ smallestUnit: "second", roundingMode })
          .toString({ smallestUnit: "second" })
          .replace(/[-:]/g, "");
        if (!/^\d{8}T\d{6}Z$/.test(result))
          throw Error(
            "事项的 UTC 时间超出标准 ICS 的年份范围，请调整后再导出。",
          );
        return result;
      };
      lines.push(
        `DTSTART:${utc(event.start, "floor")}`,
        `DTEND:${utc(event.end, "ceil")}`,
        `X-INKSTONE-TIMEZONE:${icsEscape(event.timeZone)}`,
      );
    }
    lines.push(
      `SUMMARY:${icsEscape(event.title)}`,
      `DESCRIPTION:${icsEscape(event.notes)}`,
      `STATUS:${event.status === "cancelled" ? "CANCELLED" : "CONFIRMED"}`,
      `X-INKSTONE-STATUS:${event.status}`,
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  const output = lines.map(foldIcs).join("\r\n") + "\r\n";
  if (new TextEncoder().encode(output).length > 8 * 1024 * 1024)
    throw Error("日历导出超过 8 MB，请缩小日期范围。");
  return output;
}

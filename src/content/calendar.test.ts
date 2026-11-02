import { describe, expect, it } from "vitest";
import {
  addDays,
  calendarBlocks,
  calendarIcs,
  calendarTemplate,
  cloneCalendarSource,
  dateInZone,
  dateQuery,
  dateTimeInput,
  eventOverlaps,
  eventEndDay,
  eventTimeLabel,
  filterCalendarEvents,
  inspectCalendar,
  parseCalendar,
  projectEvents,
  replaceCalendarBlock,
  saveCalendarEvent,
  setCalendarView,
  deleteCalendarEvent,
  zonedInput,
  type CalendarData,
  type CalendarEvent,
} from "./calendar";
const fixture = (patch: Partial<CalendarEvent> = {}): CalendarEvent => ({
  id: crypto.randomUUID(),
  title: "产品评审",
  start: "2026-10-28T10:00:00+08:00",
  end: "2026-10-28T11:00:00+08:00",
  allDay: false,
  timeZone: "Asia/Shanghai",
  status: "planned",
  notes: "检查正文与日历",
  ...patch,
});
it("matches UUID identity independent of letter casing without creating duplicate events", () => {
  const event = fixture({ id: "a85dab54-d06f-410f-b743-87282c9c3c2b" });
  const updated = saveCalendarEvent(source([event]), {
    ...event,
    id: event.id.toUpperCase(),
    title: "同一个事项",
  });
  expect(parseCalendar(updated).events).toEqual([
    { ...event, title: "同一个事项" },
  ]);
  expect(
    parseCalendar(deleteCalendarEvent(updated, event.id.toUpperCase())).events,
  ).toEqual([]);
});
it("counts Unicode scalar characters consistently and prevents edits exceeding the block limit", () => {
  expect(
    parseCalendar(
      source([
        fixture({ title: "😀".repeat(200), notes: "😀".repeat(20_000) }),
      ]),
    ).events,
  ).toHaveLength(1);
  expect(() =>
    parseCalendar(source([fixture({ title: "😀".repeat(201) })])),
  ).toThrow(/标题/);
  const base = source().replace(/}$/, ',"extension":""}');
  const large = base.replace(
    '"extension":""',
    '"extension":"' + "😀".repeat(300_000 - Array.from(base).length) + '"',
  );
  expect(parseCalendar(large).events).toHaveLength(1);
  expect(() => parseCalendar(large + " ")).toThrow(/300,000/);
  const nearlyFull = base.replace(
    '"extension":""',
    '"extension":"' + "x".repeat(299_950 - base.length) + '"',
  );
  const event = parseCalendar(nearlyFull).events[0];
  expect(() =>
    saveCalendarEvent(nearlyFull, { ...event, title: "x".repeat(200) }),
  ).toThrow(/300,000/);
});
it("keeps CRLF closed fences writable and rejects mismatched closing markers", () => {
  const content =
    "正文\r\n\r\n```calendar\r\n" +
    source().replaceAll("\n", "\r\n") +
    "\r\n```\r\n尾段";
  const block = calendarBlocks(content)[0];
  expect(block.data).not.toBeNull();
  const next = replaceCalendarBlock(
    content,
    block,
    setCalendarView(block.text, "month"),
  );
  expect(next).toContain("```\r\n尾段");
  expect(calendarBlocks(next)[0].data?.view).toBe("month");
  expect(
    calendarBlocks("~~~calendar\n" + source() + "\n```")[0].data,
  ).toBeNull();
});
const source = (events = [fixture()]) =>
  JSON.stringify({ ...JSON.parse(calendarTemplate()), events });
describe("calendar source and version safety", () => {
  it("keeps invalid JSON, duplicate fields and IDs from structural writes", () => {
    expect(inspectCalendar('{"schema":').data).toBeNull();
    const s = source();
    expect(() =>
      parseCalendar(s.replace('"schema":', '"schema":"other","schema":')),
    ).toThrow(/重复/);
    const e = fixture();
    expect(() => parseCalendar(source([e, e]))).toThrow(/重复/);
    expect(() =>
      parseCalendar(source([fixture({ notes: "x".repeat(20_001) })])),
    ).toThrow(/备注/);
    expect(() =>
      parseCalendar(
        source([fixture()]).replace(
          '"status":"planned"',
          '"status":["planned"]',
        ),
      ),
    ).toThrow(/状态/);
  });
  it("only patches the selected calendar between Markdown paragraphs", () => {
    const a = source(),
      b = source();
    const doc =
      "# 标题\n\n第一段\n\n```calendar\n" +
      a +
      "\n```\n\n第二段\n\n~~~calendar\n" +
      b +
      "\n~~~\n";
    const blocks = calendarBlocks(doc);
    expect(blocks).toHaveLength(2);
    const next = JSON.stringify({
      ...blocks[0].data,
      events: [fixture({ title: "仅改第一张" })],
    });
    const changed = replaceCalendarBlock(doc, blocks[0], next);
    expect(changed).toContain(b);
    expect(changed).toContain("第二段");
    expect(calendarBlocks(changed)[0].data?.events[0].title).toBe("仅改第一张");
    expect(() => replaceCalendarBlock(changed, blocks[0], a)).toThrow(/已变化/);
  });
  it("copies a calendar with independent block and event identities and retains extensions", () => {
    const raw = { ...JSON.parse(source()), color: "green" };
    const old = parseCalendar(JSON.stringify(raw));
    const copied = parseCalendar(cloneCalendarSource(JSON.stringify(raw)));
    expect(copied.id).not.toBe(old.id);
    expect(copied.events[0].id).not.toBe(old.events[0].id);
    expect(copied.events[0].title).toBe(old.events[0].title);
    expect(copied.color).toBe("green");
    expect(cloneCalendarSource("{bad")).toBe("{bad");
    const both =
      "```calendar\n" +
      JSON.stringify(old) +
      "\n```\n\n```calendar\n" +
      JSON.stringify(old) +
      "\n```";
    expect(calendarBlocks(both).every((x) => x.data === null)).toBe(true);
  });
});
it("preserves unedited JSON number literals across updates and cloned IDs", () => {
  const s = source().replace(
    '"events":',
    '"extension":9007199254740993,"events":',
  );
  const data = parseCalendar(s);
  const updated = saveCalendarEvent(s, {
    ...data.events[0],
    title: "修改标题",
  });
  expect(updated).toContain("9007199254740993");
  expect(cloneCalendarSource(updated)).toContain("9007199254740993");
  expect(setCalendarView(updated, "month")).toContain("9007199254740993");
  expect(deleteCalendarEvent(updated, data.events[0].id)).toContain(
    "9007199254740993",
  );
});
it("updates quoted and list-contained calendar fences without stripping Markdown prefixes", () => {
  const s = source(),
    quoted = ("```CALENDAR\n" + s + "\n```")
      .split("\n")
      .map((line) => "> " + line)
      .join("\n");
  const doc = "# 正文\n\n" + quoted + "\n\n后续正文";
  const block = calendarBlocks(doc)[0];
  expect(block.data?.events[0].title).toBe("产品评审");
  const next = saveCalendarEvent(block.text, {
    ...block.data!.events[0],
    title: "引用中修改",
  });
  const updated = replaceCalendarBlock(doc, block, next);
  expect(updated).toContain("> ```CALENDAR");
  expect(updated).toContain("> ```\n\n后续正文");
  expect(calendarBlocks(updated)[0].data?.events[0].title).toBe("引用中修改");
  const list =
    "- 计划\n\n" +
    ("  ```calendar\n" +
      s
        .split("\n")
        .map((line) => "  " + line)
        .join("\n") +
      "\n  ```");
  expect(calendarBlocks(list)[0].data?.events).toHaveLength(1);
  expect(calendarBlocks("```calendar\n" + s)[0].error).toContain("尚未闭合");
});
describe("calendar dates, zones and complete range filtering", () => {
  it("respects all-day exclusive ends and cross-month boundaries", () => {
    const event = fixture({
      allDay: true,
      start: "2026-10-31",
      end: "2026-11-02",
    });
    expect(parseCalendar(source([event])).events).toHaveLength(1);
    expect(eventOverlaps(event, "2026-11-01", "2026-11-02")).toBe(true);
    expect(eventOverlaps(event, "2026-11-02", "2026-11-03")).toBe(false);
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(() =>
      parseCalendar(
        source([
          fixture({ allDay: true, start: "2026-02-30", end: "2026-03-02" }),
        ]),
      ),
    ).toThrow(/全天/);
  });
  it("rejects invalid DST local times and offset/zone mismatches", () => {
    expect(() => zonedInput("2026-03-08T02:30", "America/New_York")).toThrow(
      /夏令时/,
    );
    expect(() => zonedInput("2026-11-01T01:30", "America/New_York")).toThrow(
      /夏令时/,
    );
    expect(zonedInput("2026-03-08T03:30", "America/New_York")).toBe(
      "2026-03-08T03:30:00-04:00",
    );
    expect(() =>
      parseCalendar(
        source([
          fixture({
            timeZone: "America/New_York",
            start: "2026-03-08T03:30:00-05:00",
            end: "2026-03-08T04:30:00-05:00",
          }),
        ]),
      ),
    ).toThrow(/时区/);
    const valid = fixture({
      timeZone: "America/New_York",
      start: "2026-11-01T01:30:00-04:00",
      end: "2026-11-01T01:30:00-05:00",
    });
    expect(parseCalendar(source([valid])).events[0].end).toBe(valid.end);
  });
  it("anchors relative dates in the explicit query zone, not machine time", () => {
    const now = new Date("2026-10-25T18:00:00Z");
    expect(dateInZone(now, "Asia/Shanghai")).toBe("2026-10-26");
    expect(dateQuery("下周有哪些事项？", now, "Asia/Shanghai")).toMatchObject({
      start: "2026-11-02",
      end: "2026-11-09",
      terms: "",
    });
    expect(dateQuery("本周产品评审", now, "Asia/Shanghai")).toMatchObject({
      start: "2026-10-26",
      end: "2026-11-02",
      terms: "产品评审",
    });
    expect(
      dateQuery("查询2026-10-31至2026-11-02的日程", now, "Asia/Shanghai"),
    ).toMatchObject({ start: "2026-10-31", end: "2026-11-03", terms: "" });
  });
  it("returns every matching event above six results and sorts instants across zones", () => {
    const events = Array.from({ length: 12 }, (_, i) => ({
      event: fixture({ title: "评审" + i }),
    }));
    expect(
      filterCalendarEvents(
        events,
        { start: "2026-10-28", end: "2026-10-29" },
        "all",
        "评审",
        "Asia/Shanghai",
      ),
    ).toHaveLength(12);
    const later = fixture({
      timeZone: "UTC",
      start: "2026-10-28T09:00:00Z",
      end: "2026-10-28T10:00:00Z",
    });
    expect(
      filterCalendarEvents(
        [{ event: later }, { event: fixture() }],
        { start: "2026-10-28", end: "2026-10-29" },
        "all",
        "",
        "Asia/Shanghai",
      )[0].event.start,
    ).toContain("+08:00");
    expect(dateTimeInput("2026-10-28T02:00:00Z", "Asia/Shanghai")).toBe(
      "2026-10-28T10:00",
    );
    expect(eventTimeLabel(fixture())).toBe("2026-10-28 10:00–11:00");
  });
  it("reports broken blocks without hiding valid documents and namespaces imported IDs", () => {
    const content = "```calendar\n" + source() + "\n```";
    const docs = [
      { documentId: "one", title: "A", path: "a.md", content, hash: "a" },
      { documentId: "two", title: "B", path: "b.md", content, hash: "b" },
      {
        documentId: "bad",
        title: "坏",
        path: "c.md",
        content: "```calendar\n{}\n```",
        hash: "c",
      },
    ];
    const result = projectEvents(docs);
    expect(result.events).toHaveLength(2);
    expect(result.warnings).toHaveLength(1);
    expect(result.events[0].key).not.toBe(result.events[1].key);
  });
});
describe("ICS export", () => {
  it("retains positive subsecond event intervals with whole-second ICS precision", () => {
    const event = fixture({
      timeZone: "UTC",
      start: "2026-10-31T23:59:59.100Z",
      end: "2026-10-31T23:59:59.200Z",
    });
    const ics = calendarIcs([event]);
    expect(ics).toContain("DTSTART:20261031T235959Z");
    expect(ics).toContain("DTEND:20261101T000000Z");
    expect(() =>
      calendarIcs([
        fixture({
          timeZone: "UTC",
          start: "9999-12-31T23:59:58Z",
          end: "9999-12-31T23:59:59.999Z",
        }),
      ]),
    ).toThrow(/年份范围/);
  });
  it("treats midnight precisely and rejects leap seconds instead of normalizing them", () => {
    expect(
      eventEndDay(fixture({ timeZone: "UTC", end: "2026-11-01T00:00:00Z" })),
    ).toBe("2026-11-01");
    expect(
      eventEndDay(
        fixture({ timeZone: "UTC", end: "2026-11-01T00:00:00.001Z" }),
      ),
    ).toBe("2026-11-02");
    expect(() =>
      parseCalendar(
        source([
          fixture({
            timeZone: "UTC",
            start: "2026-12-31T23:59:60Z",
            end: "2027-01-01T01:00:00Z",
          }),
        ]),
      ),
    ).toThrow(/时间/);
  });
  it("exports UTC instants, exclusive all-day dates, escaped text and octet-safe folded lines", () => {
    const data = [
      fixture({
        title: "评审, 分号; 反斜杠\\",
        notes: "第一行\n第二行" + "中文".repeat(40),
      }),
      fixture({ allDay: true, start: "2026-10-31", end: "2026-11-02" }),
    ];
    const ics = calendarIcs(data, new Date("2026-10-26T00:00:00Z"));
    expect(ics).toContain("DTSTART:20261028T020000Z\r\n");
    expect(ics).toContain("DTEND;VALUE=DATE:20261102");
    expect(ics).toContain("SUMMARY:评审\\, 分号\\; 反斜杠\\\\");
    expect(ics).toContain("第一行\\n第二行");
    expect(
      ics
        .split("\r\n")
        .every((line) => new TextEncoder().encode(line).length <= 75),
    ).toBe(true);
    expect(ics).toContain("DTSTAMP:20261026T000000Z");
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    const extended = fixture({ uid: { opaqueExtension: true } });
    expect(calendarIcs([extended])).toContain(
      `UID:${extended.id}@inkstone.local`,
    );
  });
});

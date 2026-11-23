import { ChevronLeft, ChevronRight, ListFilter, Plus } from "lucide-react";
import { Temporal } from "temporal-polyfill";
import type { ReactNode } from "react";
import { addDays, dateInZone, type DateRange } from "../content/calendar";
import { useLocale } from "../i18n";
import { dismissDetailsOnOutside } from "../platform/menu";
import type { WorkspaceCalendarView } from "./projectCalendarView";

interface Props {
  view: WorkspaceCalendarView;
  anchor: string;
  timeZone: string;
  range: DateRange;
  busy: boolean;
  onDate: (day: string) => void;
  onView: (view: WorkspaceCalendarView) => void;
  onNew?: () => void;
  filtered: boolean;
  children: ReactNode;
}

export default function ProjectCalendarHeader({
  view,
  anchor,
  timeZone,
  range,
  busy,
  onDate,
  onView,
  onNew,
  filtered,
  children,
}: Props) {
  const { region, t } = useLocale();
  const heading = new Intl.DateTimeFormat(region, {
    year: "numeric",
    month: "long",
    timeZone: "UTC",
  });
  const dayFormat = new Intl.DateTimeFormat(region, {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
  const at = (s: string) => new Date(s + "T12:00:00Z");
  const move = (amount: number) => {
    const day = Temporal.PlainDate.from(anchor);
    onDate(
      view === "week"
        ? addDays(anchor, 7 * amount)
        : day.with({ day: 1 }).add({ months: amount }).toString(),
    );
  };
  return (
    <header className="calendar-workbench-heading">
      <div>
        <h1>{heading.format(at(anchor))}</h1>
        <span className="calendar-workbench-period">
          {dayFormat.formatRange(at(range.start), at(addDays(range.end, -1)))}
        </span>
      </div>
      <div className="calendar-period-buttons">
        <button
          aria-label={
            view === "week"
              ? t("上一周", "Previous week")
              : t("上个月", "Previous month")
          }
          onClick={() => move(-1)}
        >
          <ChevronLeft size={16} />
        </button>
        <button
          aria-label={
            view === "week"
              ? t("下一周", "Next week")
              : t("下个月", "Next month")
          }
          onClick={() => move(1)}
        >
          <ChevronRight size={16} />
        </button>
        <button onClick={() => onDate(dateInZone(new Date(), timeZone))}>
          {t("今天", "Today")}
        </button>
      </div>
      <div className="calendar-main-actions">
        <div
          className="calendar-view-tabs"
          role="group"
          aria-label={t("日历视图", "Calendar view")}
        >
          {(["week", "month", "agenda"] as const).map((key) => (
            <button
              key={key}
              onClick={() => onView(key)}
              className={view === key ? "active" : ""}
              aria-pressed={view === key}
            >
              {key === "week"
                ? t("周历", "Week")
                : key === "month"
                  ? t("月历", "Month")
                  : t("日程清单", "Agenda")}
            </button>
          ))}
        </div>
        <details
          ref={dismissDetailsOnOutside}
          className="calendar-options"
          onKeyDown={(e) => {
            if (e.key === "Escape" && e.currentTarget.open) {
              e.currentTarget.open = false;
              e.currentTarget.querySelector("summary")?.focus();
            }
          }}
        >
          <summary>
            <ListFilter size={15} />
            {filtered ? t("已筛选", "Filtered") : t("筛选", "Filter")}
          </summary>
          <div className="calendar-options-panel">{children}</div>
        </details>
        {onNew && (
          <button className="calendar-primary" onClick={onNew} disabled={busy}>
            <Plus size={16} />
            {t("新建日程", "New event")}
          </button>
        )}
      </div>
    </header>
  );
}

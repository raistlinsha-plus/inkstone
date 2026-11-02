import { Temporal } from "temporal-polyfill";
import {
  dateInZone,
  monthRange,
  validDate,
  type CalendarMode,
} from "../content/calendar";
interface Props {
  view: CalendarMode;
  onView: (view: CalendarMode) => void;
  anchor: string;
  onAnchor: (date: string) => void;
  timeZone: string;
  label?: string;
  onNew?: () => void;
  onExport?: () => void;
  busy?: boolean;
}
export default function CalendarTools({
  view,
  onView,
  anchor,
  onAnchor,
  timeZone,
  label,
  onNew,
  onExport,
  busy,
}: Props) {
  const move = (months: number) =>
    onAnchor(
      Temporal.PlainDate.from(anchor)
        .with({ day: 1 })
        .add({ months })
        .toString(),
    );
  return (
    <>
      <div className="calendar-toolbar">
        <div className="calendar-view-tabs" role="group" aria-label="日历视图">
          <button
            className={view === "agenda" ? "active" : ""}
            aria-pressed={view === "agenda"}
            onClick={() => onView("agenda")}
            disabled={busy}
          >
            日程清单
          </button>
          <button
            className={view === "month" ? "active" : ""}
            aria-pressed={view === "month"}
            onClick={() => onView("month")}
            disabled={busy}
          >
            月历
          </button>
        </div>
        <div className="calendar-main-actions">
          {onExport && (
            <button onClick={onExport} disabled={busy}>
              导出 ICS
            </button>
          )}
          {onNew && (
            <button
              className="calendar-primary"
              onClick={onNew}
              disabled={busy}
            >
              ＋ 新增事项
            </button>
          )}
        </div>
      </div>
      <div className="calendar-date-nav">
        <button onClick={() => move(-1)} aria-label="上个月">
          ‹
        </button>
        <button onClick={() => onAnchor(dateInZone(new Date(), timeZone))}>
          今天
        </button>
        <button onClick={() => move(1)} aria-label="下个月">
          ›
        </button>
        <strong>{label ?? monthRange(anchor).label}</strong>
        <label>
          转到日期
          <input
            aria-label="日历转到日期"
            type="date"
            value={anchor}
            onInput={(e) => {
              if (validDate(e.currentTarget.value))
                onAnchor(e.currentTarget.value);
            }}
            onChange={(e) => {
              if (validDate(e.target.value)) onAnchor(e.target.value);
            }}
          />
        </label>
      </div>
    </>
  );
}

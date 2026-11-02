import { CalendarDays, Database, Folder, Search } from "lucide-react";
export default function SpaceNavigation({
  disabled,
  calendarOpen,
  canIndex,
  indexDirty,
  onHome,
  onCalendar,
  onSearch,
  onIndex,
}: {
  disabled: boolean;
  calendarOpen: boolean;
  canIndex: boolean;
  indexDirty: boolean;
  onHome: () => void;
  onCalendar: () => void;
  onSearch: () => void;
  onIndex: () => void;
}) {
  return (
    <nav className="main-nav" aria-label="空间功能">
      <button
        title="我的文档"
        aria-label="我的文档"
        disabled={disabled}
        onClick={onHome}
      >
        <Folder size={17} />
        <span>文档</span>
      </button>
      <button
        title="日历"
        aria-label="日历"
        className={calendarOpen ? "active" : ""}
        disabled={disabled}
        onClick={onCalendar}
      >
        <CalendarDays size={17} />
        <span>日历</span>
      </button>
      <button title="搜索资料" aria-label="搜索资料" onClick={onSearch}>
        <Search size={17} />
        <span>搜索</span>
      </button>
      <button
        title="资料索引"
        aria-label="资料索引"
        disabled={!canIndex}
        onClick={onIndex}
      >
        <Database size={17} />
        <span>索引</span>
        {indexDirty && <i className="pending-dot" />}
      </button>
    </nav>
  );
}

import {
  BookOpen,
  CalendarDays,
  Database,
  Folder,
  Search,
  Sparkles,
} from "lucide-react";
export default function SpaceNavigation({
  disabled,
  generalDisabled = disabled,
  calendarOpen,
  canIndex,
  indexDirty,
  onHome,
  onGeneralAsk,
  onWiki,
  onCalendar,
  onSearch,
  onIndex,
}: {
  disabled: boolean;
  generalDisabled?: boolean;
  calendarOpen: boolean;
  canIndex: boolean;
  indexDirty: boolean;
  onHome: () => void;
  onGeneralAsk?: () => void;
  onWiki?: () => void;
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
      {onGeneralAsk && (
        <button
          title="AI 问答"
          aria-label="AI 问答"
          disabled={generalDisabled}
          onClick={onGeneralAsk}
        >
          <Sparkles size={17} />
          <span>问答</span>
        </button>
      )}
      {onWiki && (
        <button
          title="知识 Wiki"
          aria-label="知识 Wiki"
          disabled={disabled}
          onClick={onWiki}
        >
          <BookOpen size={17} />
          <span>Wiki</span>
        </button>
      )}
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

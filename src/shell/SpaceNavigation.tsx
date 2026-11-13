import {
  BookOpen,
  CalendarDays,
  Database,
  Folder,
  PawPrint,
  Search,
  Sparkles,
} from "lucide-react";
export default function SpaceNavigation({
  disabled,
  generalDisabled = disabled,
  calendarOpen,
  generalOpen,
  homeOpen,
  wikiOpen,
  searchOpen,
  canIndex,
  indexDirty,
  onHome,
  onGeneralAsk,
  onWiki,
  onCalendar,
  onSearch,
  onIndex,
  companionOpen = false,
  onCompanion,
}: {
  disabled: boolean;
  generalDisabled?: boolean;
  calendarOpen: boolean;
  generalOpen: boolean;
  homeOpen?: boolean;
  wikiOpen?: boolean;
  searchOpen?: boolean;
  canIndex: boolean;
  indexDirty: boolean;
  onHome: () => void;
  onGeneralAsk?: () => void;
  onWiki?: () => void;
  onCalendar: () => void;
  onSearch: () => void;
  onIndex: () => void;
  companionOpen?: boolean;
  onCompanion?: () => void;
}) {
  return (
    <nav className="main-nav" aria-label="空间功能">
      <button
        title="我的文档"
        aria-label="我的文档"
        className={homeOpen ? "active" : ""}
        aria-current={homeOpen ? "page" : undefined}
        disabled={disabled}
        onClick={onHome}
      >
        <Folder size={17} />
        <span>文档</span>
      </button>
      <button
        title="日历"
        aria-label="日历"
        className={calendarOpen && !generalOpen ? "active" : ""}
        aria-current={calendarOpen && !generalOpen ? "page" : undefined}
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
          className={generalOpen ? "active" : ""}
          aria-current={generalOpen ? "page" : undefined}
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
          className={wikiOpen ? "active" : ""}
          aria-current={wikiOpen ? "page" : undefined}
          disabled={disabled}
          onClick={onWiki}
        >
          <BookOpen size={17} />
          <span>Wiki</span>
        </button>
      )}
      {onCompanion && (
        <button
          id="companion-entry"
          type="button"
          title="书房同伴"
          aria-label="书房同伴"
          className={companionOpen ? "active" : ""}
          aria-current={companionOpen ? "page" : undefined}
          disabled={disabled}
          onClick={onCompanion}
        >
          <PawPrint size={17} />
          <span>同伴</span>
        </button>
      )}
      <button
        title="搜索资料"
        aria-label="搜索资料"
        className={searchOpen ? "active" : ""}
        aria-current={searchOpen ? "page" : undefined}
        onClick={onSearch}
      >
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

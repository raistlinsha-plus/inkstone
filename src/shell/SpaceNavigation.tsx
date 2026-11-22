import { msg } from "../i18n";
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
    <nav className="main-nav" aria-label={msg("空间功能")}>
      <button
        title={msg("我的文档")}
        aria-label={msg("我的文档")}
        className={homeOpen ? "active" : ""}
        aria-current={homeOpen ? "page" : undefined}
        disabled={disabled}
        onClick={onHome}
      >
        <Folder size={17} />
        <span>{msg("文档")}</span>
      </button>
      <button
        title={msg("任务与日历")}
        aria-label={msg("任务与日历")}
        className={calendarOpen && !generalOpen ? "active" : ""}
        aria-current={calendarOpen && !generalOpen ? "page" : undefined}
        disabled={disabled}
        onClick={onCalendar}
      >
        <CalendarDays size={17} />
        <span>{msg("任务与日历")}</span>
      </button>
      {onGeneralAsk && (
        <button
          title={msg("AI 问答")}
          aria-label={msg("AI 问答")}
          className={generalOpen ? "active" : ""}
          aria-current={generalOpen ? "page" : undefined}
          disabled={generalDisabled}
          onClick={onGeneralAsk}
        >
          <Sparkles size={17} />
          <span>{msg("问答")}</span>
        </button>
      )}
      {onWiki && (
        <button
          title={msg("知识 Wiki")}
          aria-label={msg("知识 Wiki")}
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
          title={msg("书房同伴")}
          aria-label={msg("书房同伴")}
          className={companionOpen ? "active" : ""}
          aria-current={companionOpen ? "page" : undefined}
          disabled={disabled}
          onClick={onCompanion}
        >
          <PawPrint size={17} />
          <span>{msg("同伴")}</span>
        </button>
      )}
      <button
        title={msg("搜索资料")}
        aria-label={msg("搜索资料")}
        className={searchOpen ? "active" : ""}
        aria-current={searchOpen ? "page" : undefined}
        onClick={onSearch}
      >
        <Search size={17} />
        <span>{msg("搜索")}</span>
      </button>
      <button
        title={msg("资料索引")}
        aria-label={msg("资料索引")}
        disabled={!canIndex}
        onClick={onIndex}
      >
        <Database size={17} />
        <span>{msg("索引")}</span>
        {indexDirty && <i className="pending-dot" />}
      </button>
    </nav>
  );
}

import { msg, useLocale } from "../i18n";
import { PanelRightClose, PanelRightOpen } from "lucide-react";
import { version } from "../../package.json";
export default function Titlebar({
  sidebarToggle,
  workspaceName,
  panelOpen,
  onToggle,
}: {
  sidebarToggle?: React.ReactNode;
  workspaceName?: string;
  panelOpen: boolean;
  onToggle: () => void;
}) {
  const { language } = useLocale();
  return (
    <header className="titlebar" data-tauri-drag-region>
      <div className="traffic-space" data-tauri-drag-region />
      <div className="titlebar-sidebar-control">{sidebarToggle}</div>
      <span className="titlebar-name" data-tauri-drag-region>
        {language === "zh-CN" && <>砚台 <span>/</span> </>}Inkstone
      </span>
      <span
        className="app-version"
        title={msg("当前运行的应用版本")}
        data-tauri-drag-region
      >
        v{version}
      </span>
      <span className="titlebar-center" data-tauri-drag-region>
        {workspaceName ?? msg("本地写作与知识空间")}
      </span>
      <button
        className="icon-button"
        title={panelOpen ? msg("收起侧栏") : msg("打开侧栏")}
        aria-label={msg("切换知识侧栏")}
        onClick={onToggle}
      >
        {panelOpen ? (
          <PanelRightClose size={17} />
        ) : (
          <PanelRightOpen size={17} />
        )}
      </button>
    </header>
  );
}

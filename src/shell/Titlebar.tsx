import { PanelRightClose, PanelRightOpen } from "lucide-react";
import { version } from "../../package.json";
export default function Titlebar({
  workspaceName,
  panelOpen,
  onToggle,
}: {
  workspaceName?: string;
  panelOpen: boolean;
  onToggle: () => void;
}) {
  return (
    <header className="titlebar" data-tauri-drag-region>
      <div className="traffic-space" data-tauri-drag-region />
      <span className="titlebar-name" data-tauri-drag-region>
        砚台 <span>/</span> Inkstone
      </span>
      <span
        className="app-version"
        title="当前运行的应用版本"
        data-tauri-drag-region
      >
        v{version}
      </span>
      <span className="titlebar-center" data-tauri-drag-region>
        {workspaceName ?? "本地写作与知识空间"}
      </span>
      <button
        className="icon-button"
        title={panelOpen ? "收起侧栏" : "打开侧栏"}
        aria-label="切换知识侧栏"
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

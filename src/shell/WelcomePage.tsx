import {
  ArrowUp,
  Database,
  FilePlus2,
  FileText,
  FolderOpen,
  HardDrive,
  PenLine,
  Sparkles,
} from "lucide-react";
import type { Stats, Workspace } from "../types";
import { appVersion } from "../version";
export default function WelcomePage({
  workspace,
  stats,
  disabled,
  onOpen,
  onNew,
  onIndex,
}: {
  workspace: Workspace | null;
  stats: Stats;
  disabled: boolean;
  onOpen: () => void;
  onNew: () => void;
  onIndex: () => void;
}) {
  return (
    <div className="welcome-page">
      <div className="welcome-top">
        <span className="eyebrow">A QUIET PLACE FOR YOUR IDEAS</span>
        <span className="version-pill">v{appVersion} · macOS</span>
      </div>
      <div className="welcome-heading">
        <div className="ink-mark">
          <PenLine size={30} strokeWidth={1.4} />
        </div>
        <h1>
          让想法落笔，
          <br />
          <span>让知识相连。</span>
        </h1>
        <p>
          专注写作，整理本地资料。
          <br />
          在自己的文字里，找到下一次灵感。
        </p>
      </div>
      <div className="welcome-actions">
        <button className="button primary" disabled={disabled} onClick={onOpen}>
          <FolderOpen size={16} />
          {workspace ? "打开其他目录" : "打开本地目录"}
          <span className="shortcut">⌘O</span>
        </button>
        {workspace && (
          <button className="button" onClick={onNew}>
            <FilePlus2 size={16} />
            新建笔记
          </button>
        )}
      </div>
      <div className="feature-grid">
        <div>
          <span className="feature-icon">
            <FileText size={19} />
          </span>
          <h3>纯粹的编辑体验</h3>
          <p>
            纯文本与 Markdown，
            <br />
            源码与可视化，自在切换。
          </p>
        </div>
        <div>
          <span className="feature-icon">
            <Database size={19} />
          </span>
          <h3>资料就在手边</h3>
          <p>
            本地建立知识索引，
            <br />
            从片段回到完整上下文。
          </p>
        </div>
        <div>
          <span className="feature-icon">
            <Sparkles size={19} />
          </span>
          <h3>模型由你选择</h3>
          <p>
            连接自己的 API，
            <br />
            让回答带着可靠的出处。
          </p>
        </div>
      </div>
      {workspace && (
        <div className="workspace-summary">
          <HardDrive size={17} />
          <div>
            <strong>{workspace.root}</strong>
            <span>
              {stats.documents} 篇已索引文档 · {stats.chunks} 个片段
            </span>
          </div>
          <button className="text-button" onClick={onIndex}>
            管理资料索引 <ArrowUp size={13} className="diagonal" />
          </button>
        </div>
      )}
      <div className="welcome-footer">
        <span className="small-dot" />
        文件自由保存，知识属于你。<span>TXT / MARKDOWN</span>
      </div>
    </div>
  );
}

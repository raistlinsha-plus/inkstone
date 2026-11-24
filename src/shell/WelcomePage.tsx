import { msg } from "../i18n";
import {
  ArrowUp,
  Database,
  FilePlus2,
  FolderOpen,
  HardDrive,
  PenLine,
  Sparkles,
} from "lucide-react";
import type { ReactNode } from "react";
import type { Stats, Workspace } from "../types";
import { appVersion } from "../version";
import "./onboarding.css";

export function FirstUseGuide({
  hasWorkspace,
  hasDocuments,
  disabled,
  onExample,
  onImport,
  onAsk,
}: {
  hasWorkspace: boolean;
  hasDocuments: boolean;
  disabled: boolean;
  onExample: () => void;
  onImport: () => void;
  onAsk: () => void;
}) {
  const actions = (
    <div className="first-use-actions">
      {hasDocuments && (
        <button
          className="button primary"
          disabled={disabled || !hasWorkspace}
          onClick={onAsk}
        >
          <Sparkles size={16} /> {msg("打开问答")}
        </button>
      )}
      <button
        className={hasDocuments ? "button ghost" : "button primary"}
        disabled={disabled}
        onClick={onExample}
      >
        <Sparkles size={16} /> {msg("用示例体验")}
      </button>
      <button className="button" disabled={disabled} onClick={onImport}>
        <FolderOpen size={16} /> {msg("导入我的资料")}
      </button>
    </div>
  );
  return (
    <section
      className={
        hasDocuments ? "welcome-first-use has-material" : "welcome-first-use"
      }
      aria-label={msg("开始使用")}
    >
      {hasDocuments ? (
        <details>
          <summary>{msg("从资料到第一条回答")}</summary>
          <p>
            {msg("核对单篇笔记时，在正文点「问这篇文档」。")}
          </p>
          {actions}
        </details>
      ) : (
        <>
          <h2>{msg("从资料到第一条回答")}</h2>
          <p>{msg("用示例练习查出处，无需连接模型。导入自己的笔记后，可以在空间中检索和编辑。")}</p>
          {actions}
        </>
      )}
    </section>
  );
}

export default function WelcomePage({
  workspace,
  stats,
  disabled,
  onOpen,
  onNew,
  onIndex,
  guide,
}: {
  workspace: Workspace | null;
  stats: Stats;
  disabled: boolean;
  onOpen: () => void;
  onNew: () => void;
  onIndex: () => void;
  guide: ReactNode;
}) {
  return (
    <div className="welcome-page">
      <div className="welcome-top">
        <span className="eyebrow">{msg("INKSTONE · 本地工作台")}</span>
        <span className="version-pill">v{appVersion} · macOS</span>
      </div>
      <div className="welcome-heading">
        <div className="ink-mark">
          <PenLine size={30} strokeWidth={1.4} />
        </div>
        <h1>
          {msg("让想法落笔，")}
          <br />
          <span>{msg("让知识相连。")}</span>
        </h1>
        <p>{msg("编辑本地文档，从自己的资料里找到有出处的回答。")}</p>
      </div>
      {guide}
      <div className="welcome-actions">
        <button className="button" disabled={disabled} onClick={onOpen}>
          <FolderOpen size={16} />
          {workspace ? msg("打开本地目录") : msg("选择本地目录")}
          <span className="shortcut">⌘O</span>
        </button>
        {workspace && (
          <button className="button" disabled={disabled} onClick={onNew}>
            <FilePlus2 size={16} />
            {msg("新建笔记")}
          </button>
        )}
      </div>
      {workspace && (
        <div className="workspace-summary">
          <HardDrive size={17} />
          <div>
            <strong>{workspace.name}</strong>
            <span>
              {stats.documents} {msg("篇已索引文档 ·")} {stats.chunks} {msg("个片段")}
            </span>
          </div>
          <button className="text-button" onClick={onIndex}>
            <Database size={14} /> {msg("管理资料索引")}{" "}
            <ArrowUp size={13} className="diagonal" />
          </button>
        </div>
      )}
    </div>
  );
}

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

export function FirstUseGuide({
  hasWorkspace,
  managed,
  hasDocuments,
  indexed,
  modelReady,
  embeddingReady,
  rerankEnabled,
  disabled,
  onExample,
  onPrepare,
  onIndex,
  onSettings,
  onAsk,
}: {
  hasWorkspace: boolean;
  managed: boolean;
  hasDocuments: boolean;
  indexed: boolean;
  modelReady: boolean;
  embeddingReady: boolean;
  rerankEnabled: boolean;
  disabled: boolean;
  onExample?: () => void;
  onPrepare: () => void;
  onIndex: () => void;
  onSettings: () => void;
  onAsk: () => void;
}) {
  const steps = [
    {
      label: "准备一份资料",
      detail: managed
        ? "可以打开内置样例，也可以复制导入自己的文档。"
        : "打开已有文档的本地目录。",
      ready: hasDocuments,
      action: managed ? "复制导入文档" : "打开本地目录",
      onClick: onPrepare,
    },
    {
      label: "在本机查找原文",
      detail: "样例自带关键词检索入口，也可管理自己的资料索引。",
      ready: indexed,
      action: "管理索引",
      onClick: onIndex,
      unavailable: !hasWorkspace,
    },
    {
      label: "连接聊天模型",
      detail: `聊天用于生成回答。向量索引${embeddingReady ? "已就绪" : "未就绪"}，重排${rerankEnabled ? "已启用" : "未启用"}，这两项可稍后配置。`,
      ready: modelReady,
      action: "打开模型设置",
      onClick: onSettings,
    },
    {
      label: "提问、核对与保存",
      detail:
        "打开问答并输入第一个问题。展开「本轮资料依据」可核对原文，再把有用的回答保存到文档。",
      action: "打开问答",
      onClick: onAsk,
      unavailable: !hasWorkspace,
    },
  ];
  const next = steps.find((step) => !step.ready);
  return (
    <section className="welcome-first-use" aria-label="开始使用">
      <details open={!managed || !hasDocuments || !indexed || !modelReady}>
        <summary>
          <Sparkles size={17} /> 从资料到第一条回答
        </summary>
        {onExample && (
          <div className="welcome-example">
            <button
              className="button primary small"
              disabled={disabled}
              onClick={onExample}
            >
              打开离线样例
            </button>
            <p>
              将一份虚构的阅读活动文档加入当前空间，直接试用关键词搜索和原文定位。无需连接模型。
            </p>
          </div>
        )}
        <ol>
          {steps.map((step) => (
            <li
              key={step.label}
              aria-current={step === next ? "step" : undefined}
            >
              <div>
                <strong>{step.label}</strong>
                {step.ready && (
                  <span className="status-pill">
                    {step.action === "打开模型设置" ? "已启用" : "已就绪"}
                  </span>
                )}
                {step === next && <span className="status-pill">下一步</span>}
                <p>{step.detail}</p>
              </div>
              <button
                className="button small"
                disabled={disabled || step.unavailable}
                onClick={step.onClick}
              >
                {step.action}
              </button>
            </li>
          ))}
        </ol>
      </details>
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
        <span className="eyebrow">INKSTONE · 本地工作台</span>
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
        <p>编辑本地文档，从自己的资料里找到有出处的回答。</p>
      </div>
      <div className="welcome-actions">
        <button className="button primary" disabled={disabled} onClick={onOpen}>
          <FolderOpen size={16} />
          {workspace ? "打开本地目录" : "选择本地目录"}
          <span className="shortcut">⌘O</span>
        </button>
        {workspace && (
          <button className="button" disabled={disabled} onClick={onNew}>
            <FilePlus2 size={16} />
            新建笔记
          </button>
        )}
      </div>
      {guide}
      {workspace && (
        <div className="workspace-summary">
          <HardDrive size={17} />
          <div>
            <strong>{workspace.name}</strong>
            <span>
              {stats.documents} 篇已索引文档 · {stats.chunks} 个片段
            </span>
          </div>
          <button className="text-button" onClick={onIndex}>
            <Database size={14} /> 管理资料索引{" "}
            <ArrowUp size={13} className="diagonal" />
          </button>
        </div>
      )}
    </div>
  );
}

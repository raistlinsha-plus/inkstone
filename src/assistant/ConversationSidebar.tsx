import { MessageSquare, MessageSquarePlus } from "lucide-react";
import type { ConversationSummary } from "./types";

export default function ConversationSidebar({
  conversations,
  activeId,
  disabled,
  loading,
  onNew,
  onSelect,
}: {
  conversations: ConversationSummary[];
  activeId?: string;
  disabled: boolean;
  loading: boolean;
  onNew: () => void;
  onSelect: (id: string) => void;
}) {
  const recent = conversations.filter(
    (row) => !row.archived || row.id === activeId,
  );
  return (
    <section className="workbench-history" aria-label="最近会话">
      <button
        className="workbench-new-chat"
        type="button"
        title="新建会话"
        disabled={disabled}
        onClick={onNew}
      >
        <MessageSquarePlus size={16} />
        新建会话
      </button>
      <h2>最近会话</h2>
      {!recent.length && (
        <p role="status">
          {loading ? "正在读取会话…" : "发送问题后，会话将出现在这里。"}
        </p>
      )}
      <ul>
        {recent.map((row) => (
          <li key={row.id}>
            <button
              type="button"
              aria-current={activeId === row.id ? "true" : undefined}
              disabled={disabled}
              title={row.title}
              onClick={() => onSelect(row.id)}
            >
              <MessageSquare size={15} />
              <span>
                {row.title}
                {row.archived && " · 已归档"}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

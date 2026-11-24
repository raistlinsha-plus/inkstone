import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useLocale } from "../i18n";

export default function TaskOrigin({
  documentId,
  taskId,
}: {
  documentId: string;
  taskId: string;
}) {
  const { t } = useLocale();
  const [value, setValue] = useState<{
    quote: string;
    assistant: boolean;
    conversationTitle: string;
  } | null>(null);
  useEffect(() => {
    let current = true;
    setValue(null);
    void invoke<typeof value>("task_origin", { documentId, taskId })
      .then((r) => {
        if (current) setValue(r);
      })
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [documentId, taskId]);
  if (!value) return null;
  return (
    <details>
      <summary>{t("查看聊天原话", "View original message")}</summary>
      <small>
        {value.conversationTitle} ·{" "}
        {value.assistant
          ? t("AI 建议", "Assistant suggestion")
          : t("你说", "You wrote")}
      </small>
      <blockquote>{value.quote}</blockquote>
    </details>
  );
}

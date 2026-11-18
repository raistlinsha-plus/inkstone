import { useState } from "react";
import bundledSample from "../../examples/v0.8.5/离线体验：社区阅读活动.md?raw";
import type { AnswerRecord } from "../assistant/ConversationPanel";
import type { LibraryDocument } from "../library";
import type { SearchResult } from "../types";

const exercises = [
  {
    question: "计划举办几场阅读活动？",
    answer: "计划举办 4 场阅读活动。3 场在社区阅览室，1 场在河畔公园。",
    quote:
      "河畔社区读书会计划开展 4 场阅读活动，其中 3 场在社区阅览室举行，1 场在河畔公园举行。",
    heading: "活动安排",
  },
  {
    question: "满意度怎么样？",
    answer: "这份资料没有提供满意度结果，只说明活动结束后打算收集反馈。",
    quote:
      "社区读书会打算在活动结束后收集满意度反馈。当前资料没有提供实际到场人数或满意度结果。",
    heading: "活动复盘",
  },
] as const;

export default function OfflineExample({
  document,
  content,
  hash,
  disabled,
  onOpenSource,
  onSave,
  onImport,
}: {
  document: LibraryDocument;
  /** Only current, saved, unchanged Markdown can support a fixed sample answer. */
  content: string | null;
  hash: string;
  disabled: boolean;
  onOpenSource: (source: SearchResult) => void;
  onSave: (record: AnswerRecord) => void;
  onImport: () => void;
}) {
  const [started, setStarted] = useState(false);
  const [selected, setSelected] = useState<number>();
  const [showSource, setShowSource] = useState(false);
  const exercise = selected === undefined ? undefined : exercises[selected];
  const line =
    exercise && content === bundledSample
      ? content.split("\n").indexOf(exercise.quote) + 1
      : 0;
  const source: SearchResult | undefined =
    exercise && line
      ? {
          id: 1,
          documentId: document.id,
          path: document.path,
          title: document.title,
          heading: exercise.heading,
          text: exercise.quote,
          hash,
          startLine: line,
          endLine: line,
          score: 0,
          evidence: true,
        }
      : undefined;

  return (
    <section className="offline-example" aria-label="离线问答练习">
      <h3>离线问答练习</h3>
      <p>用预设回答体验核对原文。无需模型，也不会发送资料。</p>
      {!started ? (
        <button
          type="button"
          className="button small"
          disabled={disabled}
          onClick={() => setStarted(true)}
        >
          体验模拟问答
        </button>
      ) : (
        <>
          <div className="offline-example-actions">
            {exercises.map(({ question }, index) => (
              <button
                key={question}
                type="button"
                className="button small"
                aria-pressed={selected === index}
                disabled={disabled}
                onClick={() => {
                  setSelected(index);
                  setShowSource(false);
                }}
              >
                {question}
              </button>
            ))}
          </div>
          {exercise && (
            <div className="offline-example-answer">
              <p aria-live="polite">
                {source
                  ? `模拟回答：${exercise.answer}`
                  : "样例正文已改动，固定回答无法引用这份正文。"}
              </p>
              {source && (
                <>
                  <div className="offline-example-actions">
                    <button
                      type="button"
                      className="button small"
                      aria-expanded={showSource}
                      onClick={() => setShowSource(!showSource)}
                    >
                      查看原文 · 第 {line} 行
                    </button>
                    <button
                      type="button"
                      className="button small"
                      disabled={disabled}
                      onClick={() =>
                        onSave({
                          question: exercise.question,
                          text: `> 离线体验 · 模拟回答\n\n${exercise.answer} [S1]`,
                          sources: [source],
                          snapshot: null,
                          complete: true,
                          rejectedCharts: [],
                          chartWarnings: [],
                          warning: "",
                        })
                      }
                    >
                      保存示例回答
                    </button>
                  </div>
                  {showSource && (
                    <>
                      <blockquote>{source.text}</blockquote>
                      <button
                        type="button"
                        className="button small"
                        disabled={disabled}
                        onClick={() => onOpenSource(source)}
                      >
                        打开原文
                      </button>
                    </>
                  )}
                </>
              )}
            </div>
          )}
          <button
            type="button"
            className="button small"
            disabled={disabled}
            onClick={onImport}
          >
            导入我的资料
          </button>
        </>
      )}
    </section>
  );
}

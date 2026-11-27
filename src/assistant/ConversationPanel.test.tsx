// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { setLanguagePreference } from "../i18n";
import { ConversationTimeline } from "./ConversationPanel";
import type { Conversation } from "./types";
import type { ChatResponse } from "../types";

afterEach(cleanup);

function timeline(
  response: ChatResponse,
  onCreateTasks = vi.fn(),
  onCopy = vi.fn(),
  alternate = false,
) {
  const createdAt = "2026-01-01T00:00:00Z";
  const conversation: Conversation = {
    id: "conversation",
    title: "资料核对",
    scope: null,
    scopeLabel: "通用问答",
    archived: false,
    revision: 1,
    draft: "",
    createdAt,
    updatedAt: createdAt,
    activeLeafId: "turn",
    turns: [
      {
        id: "turn",
        question: "整理两份资料。",
        parentTurnId: null,
        selectedCandidateId: "answer",
        createdAt,
        candidates: [
          {
            id: "answer",
            requestId: "request",
            createdAt,
            status: "complete",
            error: null,
            response,
          },
        ],
      },
    ],
  };
  const turn = conversation.turns[0];
  if (alternate)
    turn.candidates.push({
      ...turn.candidates[0],
      id: "alternative",
      status: "stopped",
      response: null,
    });
  const onOpen = vi.fn();
  const noop = () => {};
  render(
    <ConversationTimeline
      conversation={conversation}
      root=""
      mode="hybrid"
      busy={false}
      live={null}
      onOpen={onOpen}
      onCreateTasks={onCreateTasks}
      onCopy={onCopy}
      onTransfer={noop}
      onRetry={noop}
      onEdit={noop}
      onSelect={noop}
      onBranch={noop}
      onError={noop}
    />,
  );
  return onOpen;
}

test("answer provenance opens the submitted evidence, and a flagged claim opens its exact source", () => {
  const first = {
    id: "attachment",
    kind: "attachment" as const,
    label: "附件",
    citation: 1,
  };
  const second = {
    id: "web",
    kind: "web" as const,
    label: "网页原文",
    citation: 2,
  };
  const onOpen = timeline({
    finishReason: "stop",
    text: "当天共 15 人 [2]。",
    sources: [],
    externalSources: [first, second],
    citationChecks: [
      { status: "conflict", excerpt: "当天共 15 人", citations: [2] },
    ],
    warning: null,
  });
  expect(screen.getByText("本地资料与网页")).toBeTruthy();
  const evidence = screen.getByRole("button", { name: "本轮依据 · 2" });
  fireEvent.click(evidence);
  expect(onOpen).toHaveBeenLastCalledWith(
    expect.objectContaining({ external: first }),
    [
      expect.objectContaining({ external: first }),
      expect.objectContaining({ external: second }),
    ],
    evidence,
  );
  const flagged = screen.getByRole("button", { name: "查看引用 2" });
  fireEvent.click(flagged);
  expect(onOpen).toHaveBeenLastCalledWith(
    expect.objectContaining({ external: second }),
    expect.any(Array),
    flagged,
  );
});

test.each([
  ["stop", "direct", "直接回答 · 本轮未附来源"],
  ["no_evidence", "no-evidence", "本轮未能核实"],
])("distinguishes %s from a sourced answer", (finishReason, route, message) => {
  timeline({
    finishReason,
    text: "本轮输出",
    sources: [],
    warning: null,
    trace: { route, steps: [], unread: [] },
  });
  expect(screen.getByText(message)).toBeTruthy();
  expect(screen.queryByRole("button", { name: /^本轮依据/ })).toBeNull();
});

test("legacy search failure shows its reason once and keeps the historical trace in details", () => {
  const warning = "联网搜索暂不可用，公开资料未核验。";
  timeline({
    finishReason: "no_evidence",
    text: "未能从本轮指定资料核实请求。",
    sources: [],
    warning,
    trace: {
      route: "web-unavailable",
      steps: ["公开网页 · 检查 0 条候选"],
      unread: [],
    },
  });
  expect(screen.getAllByText(warning)).toHaveLength(1);
  expect(
    screen.getByText("未能从本轮指定资料核实请求。").closest("details")?.open,
  ).toBe(false);
  expect(screen.queryByText("已搜索，未使用网页证据")).toBeNull();

  const more = screen.getByRole("button", { name: "更多回答操作" });
  fireEvent.click(more);
  fireEvent.click(screen.getByText("技术详情"));
  expect(screen.getByText("公开网页未核验")).toBeTruthy();
  fireEvent.keyDown(more, { key: "Escape" });
  expect(more.getAttribute("aria-expanded")).toBe("false");
  expect(document.activeElement).toBe(more);
  fireEvent.click(more);
  fireEvent.pointerDown(document.body);
  expect(more.getAttribute("aria-expanded")).toBe("false");
});

test("empty search results keep the actual response and do not report a service failure", () => {
  const text = "从附件能确认预算，但没找到今年的公告。";
  const warning = "未返回网页候选。";
  timeline({
    finishReason: "no_evidence",
    text,
    sources: [],
    warning,
    trace: {
      route: "web-unavailable",
      steps: ["公开网页 · 检查 0 条候选"],
      unread: [],
    },
  });
  expect(screen.getByText(text)).toBeTruthy();
  expect(screen.getByText(warning)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "更多回答操作" }));
  fireEvent.click(screen.getByText("技术详情"));
  expect(screen.getByText("已搜索，未使用网页证据")).toBeTruthy();
});

test("creating a task from the overflow keeps the passage selected before the menu opened", () => {
  const onTask = vi.fn();
  timeline(
    {
      finishReason: "stop",
      text: "核对今年的公告。",
      sources: [],
      warning: null,
    },
    onTask,
  );
  const range = document.createRange();
  range.selectNodeContents(screen.getByText("核对今年的公告。"));
  window.getSelection()!.removeAllRanges();
  window.getSelection()!.addRange(range);
  expect(window.getSelection()!.toString()).toBe("核对今年的公告。");
  const more = screen.getByRole("button", { name: "更多回答操作" });
  fireEvent.pointerDown(more);
  window.getSelection()!.removeAllRanges();
  fireEvent.click(more);
  fireEvent.click(screen.getByRole("button", { name: "从回答创建任务" }));
  expect(onTask).toHaveBeenCalledWith(
    expect.objectContaining({ id: "turn" }),
    expect.objectContaining({ id: "answer" }),
    "核对今年的公告。",
  );
});

test("legacy generic web notices use a concise explanation and retain the full diagnostic", () => {
  const warning =
    "联网搜索暂不可用，公开资料未核验。\n所选范围未找到足够证据。请检查资料、索引或联网设置。";
  const onCopy = vi.fn();
  timeline(
    {
      finishReason: "no_evidence",
      text: "未能从本轮指定资料核实请求。",
      sources: [],
      warning,
    },
    vi.fn(),
    onCopy,
  );
  fireEvent.click(screen.getByRole("button", { name: "复制 Markdown" }));
  expect(onCopy.mock.lastCall?.[0].text).toBe(
    "暂时无法联网核实。请稍后重试，或添加可供核对的资料。",
  );
  expect(
    screen.getByText("暂时无法联网核实。请稍后重试，或添加可供核对的资料。"),
  ).toBeTruthy();
  const original = screen.getByText(/所选范围未找到足够证据/);
  expect(original.closest("details")?.open).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "更多回答操作" }));
  fireEvent.click(screen.getByText("技术详情"));
  expect(original.closest("details")?.open).toBe(true);
});

test("labels multiple answers and their states in the active interface language", () => {
  setLanguagePreference("en");
  try {
    timeline(
      { text: "答复", finishReason: "stop", sources: [], warning: null },
      undefined,
      undefined,
      true,
    );
    const alternatives = screen.getByRole("combobox", {
      name: "Answer alternatives for 整理两份资料。",
    });
    expect(alternatives.textContent).toContain("1/2 · Done");
    expect(alternatives.textContent).toContain("2/2 · Stopped");
    expect(screen.getByText("Selected 1 of 2")).toBeTruthy();
  } finally {
    setLanguagePreference("zh-CN");
  }
});

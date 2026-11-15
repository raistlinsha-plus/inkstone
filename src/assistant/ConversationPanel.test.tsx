// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { ConversationTimeline } from "./ConversationPanel";
import type { Conversation } from "./types";
import type { ChatResponse } from "../types";

afterEach(cleanup);

function timeline(response: ChatResponse) {
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
      onCopy={noop}
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

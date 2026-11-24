// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import ContextReceipt from "./ContextReceipt";
import { setLanguagePreference } from "../i18n";
import type { Candidate, Turn } from "./types";

const candidate: Candidate = {
  id: "c",
  requestId: "r",
  status: "complete",
  createdAt: "",
  error: null,
  response: {
    sources: [],
    finishReason: "stop",
    text: "Example.",
    warning: null,
  },
};
const turn: Turn = {
  id: "b",
  parentTurnId: "a",
  createdAt: "",
  question: "Example?",
  selectedCandidateId: "c",
  candidates: [candidate],
  sources: { attachments: ["new"] },
};
afterEach(cleanup);

test("legacy absence, measured zero and a failed attempt have distinct explanations", () => {
  setLanguagePreference("en");
  const view = render(<ContextReceipt candidate={candidate} turn={turn} />);
  expect(screen.getByText(/Per-request details are unavailable/)).toBeTruthy();
  expect(screen.queryByText(/No model or web request/)).toBeNull();
  view.rerender(
    <ContextReceipt
      candidate={{
        ...candidate,
        contextReceipt: { attempts: [], overflow: 0, citedSources: 0 },
      }}
      turn={turn}
    />,
  );
  expect(screen.getByText(/No model or web request/)).toBeTruthy();
  view.rerender(
    <ContextReceipt
      candidate={{
        ...candidate,
        contextReceipt: {
          attempts: [
            {
              service: "answer",
              httpStatus: null,
              inputChars: 12,
              inputTokens: null,
              outputTokens: null,
              sources: { documents: 2, attachments: 1, wiki: 0, web: 0 },
            },
          ],
          overflow: 0,
          citedSources: 0,
        },
      }}
      turn={turn}
      parent={{ ...turn, id: "a", sources: { attachments: ["old"] } }}
    />,
  );
  expect(screen.getByText("Context used · 1 request")).toBeTruthy();
  expect(screen.getByText(/Attempted · no response headers/)).toBeTruthy();
  expect(
    screen.getByText(/Passages included in the final request/).textContent,
  ).toContain("Documents 2");
  expect(
    screen.getByText(/Distinct sources cited in answer text/).textContent,
  ).toContain("0");
  expect(screen.getByText(/Selected attachments since/).textContent).toContain(
    "+1 / −1",
  );
  expect(screen.queryByText(/0 input tokens/)).toBeNull();
});

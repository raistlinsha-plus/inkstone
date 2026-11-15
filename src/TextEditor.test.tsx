// @vitest-environment jsdom
import { createRef } from "react";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { answerSourceUrl } from "./content/answerSourceLink";
import TextEditor, { type EditorHandle } from "./TextEditor";

afterEach(cleanup);

test("visual editor opens a preserved source reference only on an explicit click", async () => {
  const source = {
    documentId: "93ecb94d-5701-4f61-a6e4-683fea2f3d43",
    hash: "c".repeat(64),
    startLine: 2,
    endLine: 5,
  };
  const url = answerSourceUrl(source);
  const content = `[核对原文](${url})`;
  const onError = vi.fn();
  const onOpenAnswerSource = vi.fn();
  const onOpenDoc = vi.fn();
  const handleRef = createRef<EditorHandle>();
  const { container } = render(
    <TextEditor
      path="documents/answer.md"
      mode="visual"
      content={content}
      onChange={vi.fn()}
      onOpenAnswerSource={onOpenAnswerSource}
      onOpenDoc={onOpenDoc}
      onError={onError}
      handleRef={handleRef}
    />,
  );
  const link = await waitFor(() => {
    const anchor = container.querySelector(".ProseMirror a");
    expect(anchor).toBeTruthy();
    return anchor!;
  });
  expect(link.getAttribute("data-answer-source")).toBe(url);
  expect(link.getAttribute("href")).toBe("");
  fireEvent.click(link);
  expect(onOpenAnswerSource).not.toHaveBeenCalled();
  fireEvent.click(link, { metaKey: true });
  expect(onOpenAnswerSource).toHaveBeenCalledExactlyOnceWith(source);
  expect(handleRef.current?.getContent()).toBe(content);
  expect(onOpenDoc).not.toHaveBeenCalled();
  expect(onError).not.toHaveBeenCalled();
});

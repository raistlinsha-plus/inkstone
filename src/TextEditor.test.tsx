// @vitest-environment jsdom
import { createRef } from "react";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, expect, test, vi } from "vitest";
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

// JSDOM has no layout; ProseMirror measures the caret on document focus changes.
beforeAll(() => {
  Object.defineProperty(Range.prototype, "getClientRects", {
    configurable: true,
    value: () => [new DOMRect(0, 0, 1, 16)],
  });
});
afterAll(() => Reflect.deleteProperty(Range.prototype, "getClientRects"));

test("a pointer or accessibility click on headings moves focus out of the other panel and Escape returns it", async () => {
  const { container, getByRole, findByRole } = render(
    <>
      <button>会话更多</button>
      <TextEditor
        path="documents/heading.md"
        mode="visual"
        content="## 子标题"
        onChange={vi.fn()}
        onError={vi.fn()}
      />
    </>,
  );
  const outside = getByRole("button", { name: "会话更多" });
  const trigger = await findByRole("button", { name: "标题样式" });
  for (const activate of [
    () => fireEvent.pointerDown(trigger),
    () => fireEvent.click(trigger, { detail: 0 }),
  ]) {
    outside.focus();
    activate();
    const option = await findByRole("button", { name: "标题 2" });
    await waitFor(() => expect(document.activeElement).toBe(option));
    fireEvent.keyDown(option, { key: "ArrowDown" });
    const next = getByRole("button", { name: "标题 3" });
    expect(document.activeElement).toBe(next);
    fireEvent.keyDown(next, { key: "Escape" });
    await waitFor(() =>
      expect(trigger.getAttribute("aria-expanded")).toBe("false"),
    );
    expect(document.activeElement).toBe(trigger);
    expect(container.querySelector(".ProseMirror h2")?.textContent).toBe(
      "子标题",
    );
  }
});

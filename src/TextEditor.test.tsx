// @vitest-environment jsdom
import { act, createRef, useState } from "react";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, expect, test, vi } from "vitest";
import { answerSourceUrl } from "./content/answerSourceLink";
import Editor, { type EditorHandle as DocumentEditorHandle } from "./Editor";
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

test("the ready notification preserves the first edit and a later external revision is applied", async () => {
  const handleRef = createRef<EditorHandle>();
  const props = {
    path: "documents/first-edit.md",
    mode: "visual" as const,
    content: "原始段落",
    handleRef,
    onChange: vi.fn(),
    onError: vi.fn(),
  };
  // Crepe attaches the toolbar synchronously as the visual editor becomes
  // ready. Insert in that same tick, before React runs the ready-state effect.
  const host = document.createElement("div");
  const append = host.append.bind(host);
  host.append = (...nodes) => {
    append(...nodes);
    handleRef.current!.insertMarkdown("新输入", { mode: "visual", head: 1 });
  };
  const toolbarHost = { current: host };
  const { container, rerender } = render(
    <TextEditor {...props} toolbarHost={toolbarHost} />,
  );
  await waitFor(() => expect(props.onChange).toHaveBeenCalled());
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 25));
  });
  expect(container.querySelector(".ProseMirror")?.textContent).toContain(
    "新输入",
  );
  expect(handleRef.current?.getContent()).toContain("新输入");
  rerender(
    <TextEditor
      {...props}
      toolbarHost={toolbarHost}
      content="重新载入的资料"
    />,
  );
  await waitFor(() =>
    expect(container.querySelector(".ProseMirror")?.textContent).toBe(
      "重新载入的资料",
    ),
  );
  expect(props.onError).not.toHaveBeenCalled();
});

test("bold touching Chinese punctuation survives a source-view round trip", async () => {
  const handleRef = createRef<EditorHandle>();
  const props = { path: "note.md", onChange: vi.fn(), onError: vi.fn(), handleRef };
  const { container, rerender } = render(
    <TextEditor {...props} content="" mode="visual" />,
  );
  await waitFor(() => expect(container.querySelector(".milkdown-top-bar")).toBeTruthy());
  act(() => {
    handleRef.current!.insertMarkdown("&#x524D;**“重点”**&#x540E;", { mode: "visual", head: 1 });
  });
  expect(container.querySelector("strong")?.textContent).toBe("“重点”");
  const saved = handleRef.current!.getContent();
  rerender(<TextEditor {...props} content={saved} mode="source" />);
  await waitFor(() => expect(container.querySelector(".cm-content")).toBeTruthy());
  rerender(<TextEditor {...props} content={saved} mode="visual" />);
  await waitFor(() => expect(container.querySelector("strong")?.textContent).toBe("“重点”"));
  expect(container.querySelector(".ProseMirror")?.textContent?.trim()).toBe("前“重点”后");
});

test("draft reads and React publication wait for an IME candidate to commit", async () => {
  const { EditorView } = await import("@codemirror/view");
  const handleRef = createRef<EditorHandle>();
  const onChange = vi.fn();
  const { container } = render(
    <TextEditor mode="source" content="前后" path="note.md" onChange={onChange}
      onError={vi.fn()} handleRef={handleRef} />,
  );
  const el = container.querySelector<HTMLElement>(".cm-content")!;
  const view = EditorView.findFromDOM(el)!;
  fireEvent.compositionStart(el);
  act(() => view.dispatch({ changes: { from: 1, insert: "ni" } }));
  expect(handleRef.current!.getContent()).toBe("前后");
  expect(onChange).not.toHaveBeenCalled();
  act(() => view.dispatch({ changes: { from: 1, to: 3, insert: "你" } }));
  fireEvent.compositionEnd(el, { data: "你" });
  await waitFor(() => expect(onChange.mock.calls.map(([value]) => value)).toEqual(["前你后"]));
  expect(handleRef.current!.getContent()).toBe("前你后");
});

test("reading a draft between Chinese candidates preserves the middle paragraph and caret", async () => {
  const handle = createRef<DocumentEditorHandle>();
  function Document() {
    const [text, setText] = useState("开头\n\n2、Agentic模式\n\n3、FAQ\n\n最后一段");
    return <Editor content={text} onChange={setText} onError={vi.fn()}
      mode="visual" path="middle.md" handleRef={handle} />;
  }
  const { container, findByText } = render(<Document />);
  const paragraph = await findByText("2、Agentic模式");
  const node = paragraph.firstChild as Text;
  const editor = container.querySelector<HTMLElement>(".ProseMirror")!;
  editor.focus();
  async function enter(text: string) {
    await act(async () => {
      node.data = text;
      getSelection()!.collapse(node, node.length);
      await new Promise(resolve => setTimeout(resolve, 5));
    });
  }
  await enter("2、Agentic模式：");
  fireEvent.compositionStart(editor);
  await enter("2、Agentic模式：pin");
  act(() => {
    const draft = handle.current!.getContent();
    expect(draft).toContain("模式：");
    expect(draft).not.toContain("pin");
  });
  expect(node.isConnected).toBe(true);
  expect(getSelection()?.focusNode).toBe(node);
  expect(paragraph.textContent).toBe("2、Agentic模式：pin");
  await enter("2、Agentic模式：拼音");
  fireEvent.compositionEnd(editor, { data: "拼音" });
  await waitFor(() => expect(handle.current!.getContent()).toContain("模式：拼音"));
  expect(editor.lastElementChild?.textContent).toBe("最后一段");
});

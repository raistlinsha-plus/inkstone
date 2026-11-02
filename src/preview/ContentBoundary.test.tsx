// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import ContentBoundary from "./ContentBoundary";
afterEach(cleanup);
function Content({ broken }: { broken: boolean }) {
  if (broken) throw Error("bad content");
  return <p>恢复后的内容</p>;
}
test("one broken block keeps its literal source and the surrounding document readable, then recovers on new source", () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  const error = vi.fn();
  const view = render(
    <>
      <p>相邻正文</p>
      <ContentBoundary source="original" label="图表" onError={error}>
        <Content broken />
      </ContentBoundary>
    </>,
  );
  expect(screen.getByText("相邻正文")).toBeTruthy();
  expect(screen.getByRole("status").textContent).toContain("原文已保留");
  expect(screen.getByText("original")).toBeTruthy();
  expect(error).toHaveBeenCalledWith(expect.stringContaining("bad content"));
  view.rerender(
    <>
      <p>相邻正文</p>
      <ContentBoundary source="fixed" label="图表" onError={error}>
        <Content broken={false} />
      </ContentBoundary>
    </>,
  );
  expect(screen.getByText("恢复后的内容")).toBeTruthy();
  expect(screen.queryByRole("status")).toBeNull();
  log.mockRestore();
});

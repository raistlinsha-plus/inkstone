// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import WebSearchSettings from "./WebSearchSettings";

const api = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => api);

afterEach(() => {
  cleanup();
  api.invoke.mockReset();
});

async function openSettings(hasKey: boolean) {
  api.invoke.mockResolvedValueOnce({
    enabled: false,
    hasKey,
    provider: "brave",
  });
  const close = vi.fn();
  render(<WebSearchSettings onClose={close} />);
  const button = await screen.findByRole("button", { name: "测试连接" });
  return { button, close };
}

test("testing saved credentials is explicit, works while disabled, and never saves", async () => {
  const { button, close } = await openSettings(true);
  expect(api.invoke).toHaveBeenCalledExactlyOnceWith("web_search_settings");
  let finish!: (result: unknown) => void;
  api.invoke.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );

  fireEvent.click(button);
  fireEvent.click(button);
  expect(api.invoke).toHaveBeenCalledTimes(2);
  expect(api.invoke).toHaveBeenLastCalledWith("test_web_search_connection", {
    apiKey: null,
  });
  expect(screen.getByRole("status").textContent).toContain("正在测试");
  expect(
    (screen.getByRole("button", { name: "保存" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);

  await act(async () =>
    finish({
      status: "page_unreadable",
      searchElapsedMs: 100,
      pageElapsedMs: 300,
      candidateCount: 3,
      httpStatus: 200,
    }),
  );
  const status = screen.getByRole("status");
  expect(status.textContent).toContain("搜索接口可用");
  expect(status.textContent).toContain("无法读取正文");
  expect(status.textContent).toContain("HTTP 200");
  expect(status.textContent).toContain("3 条可尝试的候选");
  expect(close).not.toHaveBeenCalled();
});

test("an unsaved key is used only for the probe and editing it clears the result", async () => {
  const { button } = await openSettings(false);
  const key = screen.getByLabelText("Brave Search API 密钥");
  fireEvent.change(key, { target: { value: " synthetic-probe-key " } });
  api.invoke.mockResolvedValueOnce({
    status: "rate_limited",
    searchElapsedMs: 55,
    pageElapsedMs: null,
    candidateCount: null,
    httpStatus: 429,
  });

  fireEvent.click(button);
  await screen.findByText(/限流或额度限制/);
  expect(api.invoke).toHaveBeenLastCalledWith("test_web_search_connection", {
    apiKey: "synthetic-probe-key",
  });
  expect(screen.getByRole("status").textContent).toContain("HTTP 429");
  expect(screen.getByRole("status").textContent).not.toContain(
    "synthetic-probe-key",
  );
  fireEvent.change(key, { target: { value: "other-key" } });
  expect(screen.getByRole("status").textContent).toBe("");
  expect(api.invoke).toHaveBeenCalledTimes(2);
});

test("pending key deletion prevents probing and IPC errors render a fixed message", async () => {
  const { button } = await openSettings(true);
  const clear = screen.getByRole("checkbox", { name: "删除已保存的搜索密钥" });
  fireEvent.click(clear);
  expect(button.getAttribute("aria-disabled")).toBe("true");
  fireEvent.click(button);
  expect(api.invoke).toHaveBeenCalledTimes(1);
  fireEvent.click(clear);
  api.invoke.mockRejectedValueOnce("internal secret or address");
  fireEvent.click(button);
  await screen.findByText(/暂时无法运行连接测试/);
  expect(screen.queryByText(/internal secret/)).toBeNull();
});

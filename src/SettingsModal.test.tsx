// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { defaultRerankProvider, type Settings } from "./types";
const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
import SettingsModal from "./SettingsModal";
const provider = {
  enabled: false,
  baseUrl: "https://example.com/v1",
  model: "example",
  dimensions: null,
  maxInputChars: 1800,
  batchSize: 8,
  contextChars: 16000,
};
const settings: Settings = {
  embedding: { ...provider },
  chat: { ...provider },
  rerank: { ...defaultRerankProvider },
  hasEmbeddingKey: true,
  hasChatKey: true,
  hasRerankKey: false,
};
afterEach(() => {
  cleanup();
  invoke.mockReset();
});
test("model tabs support keyboard switching and independently save rerank settings", async () => {
  const onSave = vi.fn();
  invoke.mockResolvedValue(settings);
  const ui = render(
    <SettingsModal value={settings} onClose={vi.fn()} onSave={onSave} />,
  );
  const embedding = ui.getByRole("tab", { name: /向量化模型/ });
  embedding.focus();
  fireEvent.keyDown(embedding, { key: "End" });
  const tab = ui.getByRole("tab", { name: /重排模型/ });
  expect(tab.getAttribute("aria-selected")).toBe("true");
  expect(document.activeElement).toBe(tab);
  fireEvent.change(ui.getByLabelText(/重排接口地址/), {
    target: { value: "https://example.com/v2/rerank" },
  });
  fireEvent.change(ui.getByLabelText("重排模型名称"), {
    target: { value: "test-rerank" },
  });
  fireEvent.click(ui.getByRole("button", { name: "保存设置" }));
  await waitFor(() =>
    expect(invoke).toHaveBeenCalledWith(
      "save_settings",
      expect.objectContaining({
        value: expect.objectContaining({
          rerank: expect.objectContaining({
            enabled: false,
            endpoint: "https://example.com/v2/rerank",
            model: "test-rerank",
          }),
        }),
        embeddingKey: null,
        chatKey: null,
        rerankKey: null,
      }),
    ),
  );
  expect(onSave).toHaveBeenCalledOnce();
});

test("connection tests freeze their inputs and discard a late response after cancellation", async () => {
  let finish!: (value: string) => void;
  invoke.mockImplementation((command: string) =>
    command === "test_provider"
      ? new Promise<string>((resolve) => {
          finish = resolve;
        })
      : Promise.resolve(),
  );
  const ui = render(
    <SettingsModal value={settings} onClose={vi.fn()} onSave={vi.fn()} />,
  );
  fireEvent.click(ui.getByRole("button", { name: "测试连接" }));
  expect(ui.getByLabelText(/服务地址 · Base URL/).matches(":disabled")).toBe(
    true,
  );
  fireEvent.click(ui.getByRole("button", { name: "停止测试" }));
  await waitFor(() =>
    expect(ui.getByLabelText(/服务地址 · Base URL/).matches(":disabled")).toBe(
      false,
    ),
  );
  finish("过期测试结果");
  await waitFor(() => expect(ui.queryByText("过期测试结果")).toBeNull());
  expect(ui.getByText("连接测试已取消")).toBeTruthy();
});

test("rerank can explicitly test and copy a saved same-origin key without exposing it", async () => {
  const value: Settings = {
    ...structuredClone(settings),
    embedding: { ...provider, baseUrl: "https://EXAMPLE.com:443/v1" },
    chat: { ...provider, baseUrl: "https://chat.example.com/v1" },
    rerank: {
      ...defaultRerankProvider,
      endpoint: "https://example.com/v1/rerank",
      model: "reranker",
    },
  };
  invoke.mockImplementation((command: string) =>
    Promise.resolve(command === "test_reranker" ? "重排连接成功" : value),
  );
  const ui = render(
    <SettingsModal value={value} onClose={vi.fn()} onSave={vi.fn()} />,
  );
  fireEvent.click(ui.getByRole("tab", { name: /重排模型/ }));
  const reuse = ui.getByRole("checkbox", {
    name: "沿用同服务已保存的向量密钥",
  });
  expect((reuse as HTMLInputElement).checked).toBe(false);
  expect(
    (ui.getByRole("checkbox", { name: /启用相关性重排/ }) as HTMLInputElement)
      .checked,
  ).toBe(false);
  fireEvent.click(reuse);
  fireEvent.click(ui.getByRole("button", { name: "测试连接" }));
  await waitFor(() => expect(ui.getByText("重排连接成功")).toBeTruthy());
  expect(invoke).toHaveBeenCalledWith(
    "test_reranker",
    expect.objectContaining({ key: null, reuseKeyFrom: "embedding" }),
  );
  expect(
    (ui.container.querySelector('input[type="password"]') as HTMLInputElement)
      .value,
  ).toBe("");
  expect(
    invoke.mock.calls.some(([command]) => command === "save_settings"),
  ).toBe(false);
  fireEvent.click(ui.getByRole("button", { name: "保存设置" }));
  await waitFor(() =>
    expect(invoke).toHaveBeenCalledWith(
      "save_settings",
      expect.objectContaining({
        rerankKey: null,
        reuseRerankKeyFrom: "embedding",
        value: expect.objectContaining({
          rerank: expect.objectContaining({ enabled: false }),
        }),
      }),
    ),
  );
});

test("editing the rerank origin clears opt-in rather than carrying a key to another service", async () => {
  const value: Settings = {
    ...structuredClone(settings),
    hasChatKey: false,
    rerank: {
      ...defaultRerankProvider,
      endpoint: "https://example.com/rerank",
      model: "reranker",
    },
  };
  invoke.mockResolvedValue(value);
  const ui = render(
    <SettingsModal value={value} onClose={vi.fn()} onSave={vi.fn()} />,
  );
  fireEvent.click(ui.getByRole("tab", { name: /重排模型/ }));
  fireEvent.click(ui.getByRole("checkbox", { name: /沿用同服务/ }));
  const endpoint = ui.getByLabelText(/重排接口地址/);
  for (const address of [
    "https://other.example.com/rerank",
    "http://example.com/rerank",
    "https://example.com:444/rerank",
    "https://example.com/rerank?token=test",
  ]) {
    fireEvent.change(endpoint, { target: { value: address } });
    expect(ui.queryByRole("checkbox", { name: /沿用同服务/ })).toBeNull();
  }
  fireEvent.change(endpoint, {
    target: { value: "https://example.com:443/rerank" },
  });
  expect(
    (ui.getByRole("checkbox", { name: /沿用同服务/ }) as HTMLInputElement)
      .checked,
  ).toBe(false);
  fireEvent.click(ui.getByRole("button", { name: "保存设置" }));
  await waitFor(() =>
    expect(invoke).toHaveBeenCalledWith(
      "save_settings",
      expect.objectContaining({ reuseRerankKeyFrom: null, rerankKey: null }),
    ),
  );
});

test("typed rerank key and explicit deletion both replace any previous reuse choice", async () => {
  const value: Settings = {
    ...structuredClone(settings),
    hasRerankKey: true,
    rerank: {
      ...defaultRerankProvider,
      endpoint: "https://example.com/rerank",
      model: "reranker",
    },
  };
  invoke.mockResolvedValue(value);
  const ui = render(
    <SettingsModal value={value} onClose={vi.fn()} onSave={vi.fn()} />,
  );
  fireEvent.click(ui.getByRole("tab", { name: /重排模型/ }));
  fireEvent.click(ui.getByRole("checkbox", { name: /沿用同服务/ }));
  fireEvent.change(ui.getByLabelText("已保存的密钥来源"), {
    target: { value: "chat" },
  });
  const key = ui.container.querySelector(
    'input[type="password"]',
  ) as HTMLInputElement;
  fireEvent.change(key, { target: { value: "explicit-test-key" } });
  expect(
    (ui.getByRole("checkbox", { name: /沿用同服务/ }) as HTMLInputElement)
      .checked,
  ).toBe(false);
  fireEvent.click(ui.getByRole("button", { name: "保存设置" }));
  await waitFor(() =>
    expect(invoke).toHaveBeenCalledWith(
      "save_settings",
      expect.objectContaining({
        rerankKey: "explicit-test-key",
        reuseRerankKeyFrom: null,
        clearRerankKey: false,
      }),
    ),
  );
  fireEvent.change(key, { target: { value: "" } });
  fireEvent.click(ui.getByRole("checkbox", { name: /沿用同服务/ }));
  fireEvent.click(ui.getByRole("checkbox", { name: "删除已保存的此服务密钥" }));
  expect(
    (ui.getByRole("checkbox", { name: /沿用同服务/ }) as HTMLInputElement)
      .checked,
  ).toBe(false);
  fireEvent.click(ui.getByRole("button", { name: "保存设置" }));
  await waitFor(() =>
    expect(invoke).toHaveBeenCalledWith(
      "save_settings",
      expect.objectContaining({
        rerankKey: null,
        reuseRerankKeyFrom: null,
        clearRerankKey: true,
      }),
    ),
  );
});

test("closing after choosing reuse does not write any credential", () => {
  const value: Settings = {
    ...structuredClone(settings),
    rerank: {
      ...defaultRerankProvider,
      endpoint: "https://example.com/rerank",
    },
  };
  const close = vi.fn();
  const ui = render(
    <SettingsModal value={value} onClose={close} onSave={vi.fn()} />,
  );
  fireEvent.click(ui.getByRole("tab", { name: /重排模型/ }));
  fireEvent.click(ui.getByRole("checkbox", { name: /沿用同服务/ }));
  fireEvent.click(ui.getByRole("button", { name: "取消" }));
  expect(close).toHaveBeenCalledOnce();
  expect(invoke).not.toHaveBeenCalled();
});

test.each([
  ["embedding", /向量化模型/],
  ["chat", /问答模型/],
  ["rerank", /重排模型/],
] as const)(
  "%s deletion is tested without its old saved key, while a replacement clears deletion",
  async (kind, tabName) => {
    const value: Settings = {
      ...structuredClone(settings),
      hasRerankKey: true,
      rerank: {
        ...defaultRerankProvider,
        endpoint: "https://example.com/rerank",
        model: "reranker",
      },
    };
    invoke.mockImplementation((command: string) =>
      Promise.resolve(command.startsWith("test_") ? "连接测试已完成" : value),
    );
    const onSave = vi.fn();
    const ui = render(
      <SettingsModal value={value} onClose={vi.fn()} onSave={onSave} />,
    );
    fireEvent.click(ui.getByRole("tab", { name: tabName }));
    const key = ui.container.querySelector(
      'input[type="password"]',
    ) as HTMLInputElement;
    const deletion = ui.getByRole("checkbox", {
      name: "删除已保存的此服务密钥",
    }) as HTMLInputElement;
    fireEvent.change(key, {
      target: { value: "pending-replacement-for-test" },
    });
    fireEvent.click(deletion);
    expect(key.value).toBe("");
    expect(deletion.checked).toBe(true);
    fireEvent.click(ui.getByRole("button", { name: "测试连接" }));
    await waitFor(() => expect(ui.getByText("连接测试已完成")).toBeTruthy());
    const command = kind === "rerank" ? "test_reranker" : "test_provider";
    expect(invoke).toHaveBeenCalledWith(
      command,
      expect.objectContaining({ key: null, skipStoredKey: true }),
    );
    expect(invoke.mock.calls.some(([name]) => name === "save_settings")).toBe(
      false,
    );
    fireEvent.change(key, { target: { value: "new-replacement-for-test" } });
    expect(deletion.checked).toBe(false);
    fireEvent.click(ui.getByRole("button", { name: "测试连接" }));
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith(
        command,
        expect.objectContaining({
          key: "new-replacement-for-test",
          skipStoredKey: false,
        }),
      ),
    );
    await waitFor(() =>
      expect(
        ui.getByRole("button", { name: "保存设置" }).matches(":disabled"),
      ).toBe(false),
    );
    fireEvent.click(ui.getByRole("button", { name: "保存设置" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
    const clearField =
      kind === "embedding"
        ? "clearEmbeddingKey"
        : kind === "chat"
          ? "clearChatKey"
          : "clearRerankKey";
    expect(invoke).toHaveBeenCalledWith(
      "save_settings",
      expect.objectContaining({
        [kind + "Key"]: "new-replacement-for-test",
        [clearField]: false,
        reuseRerankKeyFrom: null,
      }),
    );
  },
);

test("workbench appearance applies immediately and persists independently of model settings", () => {
  const ui = render(
    <SettingsModal value={settings} onClose={vi.fn()} onSave={vi.fn()} />,
  );
  try {
    fireEvent.change(ui.getByRole("combobox", { name: "工作台外观" }), {
      target: { value: "dark" },
    });
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(localStorage.getItem("inkstone:appearance")).toBe("dark");
    expect(invoke).not.toHaveBeenCalled();
  } finally {
    delete document.documentElement.dataset.theme;
    delete document.documentElement.dataset.appearance;
    localStorage.removeItem("inkstone:appearance");
  }
});

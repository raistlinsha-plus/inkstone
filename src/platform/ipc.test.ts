import { test, expect, vi } from "vitest";
const wire = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke: wire }));
import { invoke } from "./ipc";
test("preserves identity/hash payload and original rejection at the IPC boundary", async () => {
  const args = {
    path: "中文.md",
    content: "draft",
    expectedHash: "v1",
    workspaceRoot: "/test",
  };
  const result = { hash: "v2", indexStale: true, warning: null };
  wire.mockResolvedValueOnce(result);
  expect(await invoke("save_file", args)).toBe(result);
  expect(wire).toHaveBeenLastCalledWith("save_file", args);
  const e = Error("CONFLICT:changed");
  wire.mockRejectedValueOnce(e);
  await expect(invoke("save_file", args)).rejects.toBe(e);
});
// These assertions are checked by tsc, without issuing any runtime command.
if (false) {
  // @ts-expect-error a save without version protection is invalid
  void invoke("save_file", { path: "a.md", content: "a" });
  // @ts-expect-error unknown wire name
  void invoke("made_up_command");
  // @ts-expect-error request identity is required for cancellation
  void invoke("cancel_search", {});
}

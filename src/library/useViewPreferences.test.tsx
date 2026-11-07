// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
const api = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: api.invoke }));
import { useViewPreferences } from "./useViewPreferences";
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
test("sidebar and full library share a choice and a late preference read cannot overwrite it", async () => {
  let finish!: (p: unknown) => void;
  api.invoke.mockImplementation((cmd: string) =>
    cmd === "library_get_view"
      ? new Promise((r) => {
          finish = r;
        })
      : Promise.resolve(),
  );
  const first = renderHook(() => useViewPreferences("shared"));
  const second = renderHook(() => useViewPreferences("shared"));
  await waitFor(() => expect(api.invoke).toHaveBeenCalledTimes(2));
  act(() =>
    first.result.current.update({
      version: 1,
      sort: "nameDesc",
      pinnedCollapsed: false,
    }),
  );
  await act(async () => {
    finish({ version: 1, sort: "nameAsc", pinnedCollapsed: false });
  });
  expect(first.result.current.preferences.sort).toBe("nameDesc");
  expect(second.result.current.preferences.sort).toBe("nameDesc");
});
test("failed persistence remains visible and the next successful choice clears the warning", async () => {
  let fail = true;
  api.invoke.mockImplementation(async (cmd: string) => {
    if (cmd === "library_get_view")
      return { version: 1, sort: "nameAsc", pinnedCollapsed: false };
    if (fail) throw Error("disk full");
  });
  const hook = renderHook(() => useViewPreferences("failure"));
  await waitFor(() => expect(api.invoke).toHaveBeenCalled());
  act(() =>
    hook.result.current.update({
      version: 1,
      sort: "nameDesc",
      pinnedCollapsed: false,
    }),
  );
  await waitFor(() =>
    expect(hook.result.current.warning).toContain("尚未保存"),
  );
  fail = false;
  act(() =>
    hook.result.current.update({
      version: 1,
      sort: "updatedDesc",
      pinnedCollapsed: false,
    }),
  );
  await waitFor(() => expect(hook.result.current.warning).toBe(""));
  expect(hook.result.current.preferences.sort).toBe("updatedDesc");
});

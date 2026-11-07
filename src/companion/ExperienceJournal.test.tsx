// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import ExperienceJournal from "./ExperienceJournal";
import type { Snapshot } from "./types";
afterEach(cleanup);
test("failed experience save keeps editable text and a retry succeeds", async () => {
  const snapshot = {
    timezone: "Asia/Shanghai",
    cards: [
      {
        id: "card",
        spaceId: "s",
        characterId: "motuan",
        text: "旧文字",
        day: "2026-11-05",
        kind: "complete",
      },
    ],
    pending: [],
  } as unknown as Snapshot;
  const save = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
  render(
    <ExperienceJournal
      snapshot={snapshot}
      spaceId="s"
      busy={false}
      onCard={save}
      onRetry={() => {}}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "编辑" }));
  fireEvent.change(screen.getByRole("textbox", { name: "修改经历卡" }), {
    target: { value: "重要的新文字" },
  });
  fireEvent.click(screen.getByRole("button", { name: "保存修改" }));
  await screen.findByRole("alert");
  expect(
    (screen.getByRole("textbox", { name: "修改经历卡" }) as HTMLTextAreaElement)
      .value,
  ).toBe("重要的新文字");
  fireEvent.click(screen.getByRole("button", { name: "保存修改" }));
  await waitFor(() => expect(screen.queryByRole("textbox")).toBeNull());
  expect(save.mock.calls).toEqual([
    ["card", "重要的新文字"],
    ["card", "重要的新文字"],
  ]);
});

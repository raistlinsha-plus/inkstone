// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import CharacterSprite from "./CharacterSprite";
import { GrowthOverview } from "./CompanionViews";
import type { Snapshot } from "./types";

afterEach(cleanup);

test.each(["yanzhou", "zhiwei"] as const)(
  "%s has distinct, legible static poses and stage accessories",
  (role) => {
    const draw = (
      mood: "idle" | "happy" | "reading" | "ready" | "milestone",
      outfit = 0,
    ) => (
      <CharacterSprite
        role={role}
        outfit={outfit}
        mood={mood}
        animate={false}
      />
    );
    const { container, rerender } = render(draw("idle"));
    const sprite = container.querySelector("svg")!;
    expect(sprite.getAttribute("data-companion-sprite")).toBe(role);
    expect(sprite.getAttribute("data-motion")).toBe("static");
    expect(sprite.querySelector('[data-prop="open-book"]')).toBeNull();
    const keepsake = role === "yanzhou" ? "copper-bookmark" : "leaf-clip";
    expect(sprite.querySelector(`[data-keepsake="${keepsake}"]`)).toBeTruthy();
    rerender(draw("happy"));
    expect(sprite.querySelector(".human-sprite-wave")).toBeTruthy();
    rerender(draw("reading"));
    expect(sprite.querySelector('[data-prop="open-book"]')).toBeTruthy();
    rerender(draw("ready"));
    expect(sprite.querySelector('[data-prop="offered-page"]')).toBeTruthy();
    rerender(draw("milestone", 2));
    const accessory = role === "yanzhou" ? "pocket-notebook" : "worn-shawl";
    expect(sprite.querySelector(`[data-keepsake="${accessory}"]`)).toBeTruthy();
  },
);

test("Motuan gains a leaf bookmark after acquaintance and a box at the final stage", () => {
  const draw = (outfit: number) => (
    <CharacterSprite
      role="motuan"
      mood="idle"
      outfit={outfit}
      animate={false}
    />
  );
  const { container, rerender } = render(draw(0));
  expect(container.querySelector('[data-keepsake="leaf-bookmark"]')).toBeNull();
  rerender(draw(1));
  expect(
    container.querySelector('[data-keepsake="leaf-bookmark"]'),
  ).toBeTruthy();
  expect(container.querySelector('[data-keepsake="bookmark-box"]')).toBeNull();
  rerender(draw(2));
  expect(
    container.querySelector('[data-keepsake="bookmark-box"]'),
  ).toBeTruthy();
});

test("growth names only outstanding requirements and preserves unknown legacy outcomes", () => {
  const snapshot: Snapshot = {
    generation: "g",
    revision: 1,
    timezone: "Asia/Shanghai",
    settings: {
      characterId: "motuan",
      enabled: true,
      compact: true,
      mode: "focus",
      reducedMotion: true,
    },
    roles: {
      motuan: {
        read: [0, 1],
        choices: {},
        outfit: 1,
        outcomes: { 1: "skipped" },
      },
    },
    hasRevision: false,
    events: 7,
    days: 5,
    eligible: null,
    pending: [],
    cards: [],
    preferences: [],
  };
  const open = vi.fn();
  const draw = () => (
    <GrowthOverview snapshot={snapshot} busy={false} onStory={open} />
  );
  const { rerender } = render(draw());
  const [intro, acquaintance, together] = screen
    .getAllByRole("listitem")
    .map((el) => within(el));
  expect(intro.getByText("已解锁")).toBeTruthy();
  expect(acquaintance.getByText("已跳过")).toBeTruthy();
  fireEvent.click(acquaintance.getByRole("button"));
  expect(open).toHaveBeenCalledWith(1);
  expect(together.getByText("下一章 · 还需1 条经历、一次复盘")).toBeTruthy();
  snapshot.events = 8;
  snapshot.hasRevision = true;
  snapshot.eligible = 2;
  rerender(draw());
  expect(together.getByText("下一章 · 可以开始阅读")).toBeTruthy();
  expect(screen.queryByText(/复盘时/)).toBeNull();
});

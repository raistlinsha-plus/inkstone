// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import WorkspaceRail from "./WorkspaceRail";
import SpaceNavigation from "./SpaceNavigation";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function Rail({ location = "tasks" }: { location?: string }) {
  return (
    <WorkspaceRail location={location}>
      <button aria-label="Show documents">
        <svg />
      </button>
      <SpaceNavigation
        disabled={false}
        tasksOpen={location === "tasks"}
        calendarOpen={location === "calendar"}
        generalOpen={false}
        canIndex
        indexDirty={false}
        onHome={() => {}}
        onCalendar={() => {}}
        onTasks={() => {}}
        onSearch={() => {}}
        onIndex={() => {}}
      />
      <button aria-label="Settings">
        <svg />
      </button>
    </WorkspaceRail>
  );
}

it("keeps destinations icon-only and shows one anchored hint after dwelling, dismissed as soon as the pointer leaves", () => {
  vi.useFakeTimers();
  render(<Rail />);
  const tasks = screen.getByRole("button", { name: "任务" });
  const cal = screen.getByRole("button", { name: "日历" });
  expect(tasks.textContent).toBe("");
  expect(tasks.getAttribute("aria-current")).toBe("page");
  expect(cal.getAttribute("aria-current")).toBe(null);
  expect(document.querySelector(".workspace-rail [title]")).toBeNull();
  fireEvent.pointerOver(tasks);
  expect(screen.queryByRole("tooltip")).toBeNull();
  act(() => {
    vi.advanceTimersByTime(350);
  });
  expect(screen.getByRole("tooltip").textContent).toBe("任务");
  expect(screen.getByRole("tooltip").parentElement).toBe(document.body);
  fireEvent.pointerOut(tasks, { relatedTarget: cal });
  expect(screen.queryByRole("tooltip")).toBeNull();
  fireEvent.pointerOver(cal);
  fireEvent.pointerOut(cal);
  act(() => {
    vi.runAllTimers();
  });
  expect(screen.queryByRole("tooltip")).toBeNull();
});

it("shows the accessible label on keyboard focus and closes on Escape, activation and route changes", () => {
  vi.useFakeTimers();
  const { rerender } = render(<Rail />);
  const settings = screen.getByRole("button", { name: "Settings" });
  act(() => settings.focus());
  expect(screen.getByRole("tooltip").textContent).toBe("Settings");
  fireEvent.keyDown(settings, { key: "Escape" });
  expect(screen.queryByRole("tooltip")).toBeNull();
  expect(document.activeElement).toBe(settings);
  const toggle = screen.getByRole("button", { name: "Show documents" });
  fireEvent.pointerOver(toggle);
  act(() => {
    vi.advanceTimersByTime(350);
  });
  expect(screen.getByRole("tooltip").textContent).toBe("Show documents");
  fireEvent.click(toggle);
  expect(screen.queryByRole("tooltip")).toBeNull();
  fireEvent.pointerOver(settings);
  act(() => vi.runAllTimers());
  rerender(<Rail location="calendar" />);
  expect(screen.queryByRole("tooltip")).toBeNull();
  expect(
    screen.getByRole("button", { name: "日历" }).getAttribute("aria-current"),
  ).toBe("page");
});

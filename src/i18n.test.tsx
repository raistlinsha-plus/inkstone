// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import Titlebar from "./shell/Titlebar";
import {
  documentCount,
  initializeLocale,
  msg,
  resolveLanguage,
  setLanguagePreference,
  useLocale,
} from "./i18n";
import { WikiClaimEvidence } from "./knowledge/WikiClaimEvidence";
import {
  calendarEventLabel,
  calendarMonthLabel,
} from "./calendar/localizedCalendar";
import { seasonEpisodes } from "./companion/localizedStories";
import StoryReader, { storyBookmark } from "./companion/StoryReader";
import type { CharacterId } from "./companion/types";
import { defaultRerankProvider, type Settings } from "./types";
import SettingsModal from "./SettingsModal";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
const provider = {
  enabled: false,
  baseUrl: "https://local.example/v1",
  model: "model",
  dimensions: null,
  maxInputChars: 1200,
  batchSize: 8,
  contextChars: 16000,
};
const settings: Settings = {
  chat: provider,
  embedding: provider,
  rerank: defaultRerankProvider,
  hasChatKey: false,
  hasEmbeddingKey: false,
  hasRerankKey: false,
};
afterEach(() => {
  cleanup();
  setLanguagePreference("zh-CN");
  localStorage.clear();
  vi.restoreAllMocks();
  invoke.mockClear();
});

test("selects the first supported script, retaining a locale override across restarts", () => {
  vi.spyOn(navigator, "languages", "get").mockReturnValue([
    "zh-TW",
    "en-GB",
    "zh-CN",
  ]);
  expect(resolveLanguage("system", ["ja", "zh-SG"])).toBe("zh-CN");
  expect(resolveLanguage("system", ["zh-Hant", "en-AU"])).toBe("en");
  expect(resolveLanguage("system", ["x---", "es-MX"])).toBe("en");
  expect(resolveLanguage("zh-CN", ["en"])).toBe("zh-CN");
  let stop = initializeLocale();
  expect(document.documentElement.lang).toBe("en");
  expect(localStorage.getItem("inkstone:language")).toBe("system");
  setLanguagePreference("zh-CN");
  stop();
  stop = initializeLocale();
  expect(document.documentElement.lang).toBe("zh-CN");
  stop();
});

test("upgrades an existing workspace in Chinese and follows OS changes only in system mode", () => {
  const langs = vi
    .spyOn(navigator, "languages", "get")
    .mockReturnValue(["en-GB"]);
  localStorage.setItem("inkstone:panel-width", "350");
  const stop = initializeLocale();
  expect(localStorage.getItem("inkstone:language")).toBe("zh-CN");
  expect(document.documentElement.lang).toBe("zh-CN");
  setLanguagePreference("system");
  expect(document.documentElement.lang).toBe("en");
  langs.mockReturnValue(["zh-Hans-CN"]);
  window.dispatchEvent(new Event("languagechange"));
  expect(document.documentElement.lang).toBe("zh-CN");
  stop();
});

test("switches through settings without remounting an edited field, translating submitted data, or calling a provider", () => {
  const ui = render(
    <SettingsModal value={settings} onClose={vi.fn()} onSave={vi.fn()} />,
  );
  const field = ui.getByLabelText("模型名称") as HTMLInputElement;
  fireEvent.change(field, { target: { value: "模型名称·Model" } });
  fireEvent.change(ui.getByLabelText("语言 / Language"), {
    target: { value: "en" },
  });
  expect(ui.getByRole("dialog", { name: "Model settings" })).toBeTruthy();
  expect(ui.getByLabelText("Model name")).toBe(field);
  expect(field.value).toBe("模型名称·Model");
  expect(ui.getByRole("tab", { name: /Embedding model/ })).toBeTruthy();
  expect(document.documentElement.lang).toBe("en");
  expect(localStorage.getItem("inkstone:language")).toBe("en");
  fireEvent.change(ui.getByLabelText("Language / 语言"), {
    target: { value: "zh-CN" },
  });
  expect(ui.getByLabelText("模型名称")).toBe(field);
  expect(invoke).not.toHaveBeenCalled();
});

test("shows the same original Wiki quote, title and reference after switching language", () => {
  const open = vi.fn();
  const source = {
    documentId: "id",
    path: "关闭.md",
    title: "关闭",
    quote: "我的文档",
    startLine: 9,
    endLine: 11,
    hash: "original",
  };
  function Reader() {
    useLocale();
    return (
      <WikiClaimEvidence
        claims={[{ claim: "报告", status: "supported", refIndices: [0] }]}
        sources={[source]}
        onOpen={open}
      />
    );
  }
  const ui = render(<Reader />);
  const button = ui.getByRole("button");
  act(() => setLanguagePreference("en"));
  expect(msg("关闭")).toBe("Close");
  expect(button.textContent).toContain("关闭");
  expect(ui.getByText("我的文档")).toBeTruthy();
  expect(button.textContent).toContain("9–11");
  fireEvent.click(button);
  expect(open).toHaveBeenCalledOnce();
});

test("every English story has the same stages, paragraph anchors, art and choice branches", () => {
  for (const role of ["motuan", "zhiwei", "yanzhou"] as const) {
    const en = seasonEpisodes(role, "en");
    const zh = seasonEpisodes(role, "zh-CN");
    expect(en).toHaveLength(3);
    for (const [i, episode] of en.entries()) {
      expect([episode.id, episode.stage, episode.cgId]).toEqual([
        zh[i].id,
        zh[i].stage,
        zh[i].cgId,
      ]);
      expect(episode.paragraphs).toHaveLength(zh[i].paragraphs.length);
      expect(episode.title).not.toBe(zh[i].title);
      expect(
        episode.paragraphs.every(
          (p) => p.length > 24 && !/[\u3400-\u9fff]/.test(p),
        ),
      ).toBe(true);
      expect(episode.choices.map((c) => [c.id, c.next])).toEqual(
        zh[i].choices.map((c) => [c.id, c.next]),
      );
      expect(
        episode.choices.every((choice) => choice.label && choice.result),
      ).toBe(true);
    }
  }
});

test("switching languages in a running story keeps its current paragraph and bookmark", () => {
  const role: CharacterId = "motuan";
  function Reader() {
    const { language } = useLocale();
    return (
      <StoryReader
        generation="library"
        role={role}
        episode={seasonEpisodes(role, language)[0]}
        read={false}
        choice={null}
        lockedChoice={false}
        busy={false}
        canFinish
        onChoice={vi.fn()}
        onFinish={vi.fn()}
        onSkip={vi.fn()}
      />
    );
  }
  const ui = render(<Reader />);
  fireEvent.click(ui.getByRole("button", { name: "继续" }));
  act(() => setLanguagePreference("en"));
  const episode = seasonEpisodes(role, "en")[0];
  expect(ui.getByText(episode.paragraphs[1])).toBeTruthy();
  expect(storyBookmark("library", episode.id).read()).toBe(1);
  expect(ui.getByRole("button", { name: "Previous passage" })).toBeTruthy();
});

test("English window chrome uses a single brand and correctly counts live and removed documents", () => {
  setLanguagePreference("en");
  const ui = render(
    <Titlebar workspaceName="工作计划" panelOpen={false} onToggle={vi.fn()} />,
  );
  expect(
    ui.container.querySelector(".titlebar-name")?.textContent?.trim(),
  ).toBe("Inkstone");
  expect(ui.getByText("工作计划")).toBeTruthy();
  expect(documentCount(1)).toBe("1 document");
  expect(documentCount(2)).toBe("2 documents");
  expect(documentCount(2, true)).toBe("2 removed documents");
});

test("all-day dates stay in their floating date range across DST and independent region formats", () => {
  const source = {
    id: "stable",
    title: "计划",
    start: "2026-11-01",
    end: "2026-11-03",
    timeZone: "America/Los_Angeles",
    allDay: true,
    status: "planned" as const,
    notes: "",
  };
  const us = calendarEventLabel(source, "Pacific/Honolulu", "en-US", "en");
  const gb = calendarEventLabel(source, "Asia/Shanghai", "en-GB", "en");
  expect(us).toContain("Nov 1, 2026");
  expect(us).toContain("Nov 2, 2026");
  expect(gb).toContain("1 Nov 2026");
  expect(calendarMonthLabel("2026-11-01", undefined, "en-GB")).toBe(
    "November 2026",
  );
});

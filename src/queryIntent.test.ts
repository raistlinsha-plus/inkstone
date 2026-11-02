import { expect, test } from "vitest";
import { dateQuery } from "./content/calendar";
import { isCalendarIntent } from "./queryIntent";

test("date navigation requires a schedule intent rather than any dated question", () => {
  const now = new Date("2026-10-28T02:00:00Z");
  const routes = (text: string) => {
    const range = dateQuery(text, now, "Asia/Shanghai");
    return !!range && isCalendarIntent(text, range.terms);
  };
  expect(routes("今天向量检索")).toBe(false);
  expect(routes("2026-10-28发布的版本有什么新功能？")).toBe(false);
  expect(routes("下周的产品评审纪要有哪些？")).toBe(false);
  expect(routes("下周有哪些事项？")).toBe(true);
  expect(routes("本周产品评审")).toBe(true);
  expect(routes("今天？")).toBe(true);
  expect(routes("查询2026-10-31至2026-11-02的日程")).toBe(true);
});

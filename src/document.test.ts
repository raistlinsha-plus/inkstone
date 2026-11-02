import { describe, expect, it } from "vitest";
import { chunkDocument, visualUnsupported } from "./document";

describe("document chunks and source anchors", () => {
  it("keeps plain-text line anchors across CRLF and multiple blank lines", () => {
    const chunks = chunkDocument(
      "第一段\r\n\r\n\r\n第二段\r\n下一行",
      false,
      128,
    );
    expect(chunks[0].startLine).toBe(1);
    expect(chunks[0].endLine).toBe(5);
    expect(chunks[0].text).toContain("第二段\r\n下一行");
  });
  it("preserves headings and original line ranges", () => {
    const md = "# 知识库\n\n第一段。\n\n## 检索\n\n第二段\n第三行\n";
    const chunks = chunkDocument(md, true, 200);
    expect(chunks).toHaveLength(2);
    expect(chunks[1]).toMatchObject({
      heading: "知识库 / 检索",
      startLine: 5,
      endLine: 8,
    });
    expect(chunks.map((c) => c.text).join("\n")).toContain("第二段\n第三行");
  });
  it("never exceeds API limits, including astral Unicode and heading context", () => {
    const chunks = chunkDocument(
      `# 测试\n\n${"中文🌱".repeat(300)}`,
      true,
      128,
    );
    expect(chunks.length).toBeGreaterThan(3);
    for (const c of chunks)
      expect(
        Array.from(`${c.heading}\n\n${c.text}`).length,
      ).toBeLessThanOrEqual(128);
    expect(
      chunks
        .slice(1)
        .map((c) => c.text)
        .join(""),
    ).not.toContain("�");
  });
  it("routes potentially lossy structures to source mode", () => {
    expect(visualUnsupported("<script>alert(1)</script>")).toBe(true);
    expect(visualUnsupported("[链接][a]\n\n[a]: https://example.com")).toBe(
      true,
    );
    expect(
      visualUnsupported(
        "# 标题\n\n- [x] 完成\n\n| 一 | 二 |\n|---|---|\n| 1 | 2 |",
      ),
    ).toBe(false);
  });
});

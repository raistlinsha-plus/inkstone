import { expect, test } from "vitest";
import {
  readMarkdownMind as read,
  changeMarkdownMind as change,
} from "./markdownMind";
import type { CanvasNode } from "./editableMind";
function find(n: CanvasNode, label: string): CanvasNode | undefined {
  if (n.label === label) return n;
  for (const child of n.children) {
    const match = find(child, label);
    if (match) return match;
  }
}
const source =
  "# 计划\r\n\r\n- 甲\r\n  + 细节\r\n    + 附录\r\n- 乙\r\n- 乙\r\n";
const tree = read(source, "文件名");
const id = (label: string) => find(tree, label)!.id;
test("rename the actual root and add a sibling after a complete subtree, preserving CRLF and duplicate labels", () => {
  expect(tree.label).toBe("计划");
  const renamed = change(source, "文件名", {
    type: "rename",
    id: tree.id,
    label: "新的计划",
  });
  expect(renamed.source).toEqual(source.replace("计划", "新的计划"));
  expect(read(renamed.source, "文件名").label).toBe("新的计划");
  const add = change(source, "文件名", {
    type: "sibling",
    id: id("甲"),
    label: "乙",
  });
  expect(add.source).toEqual(source.replace("- 乙\r\n", "- 乙\r\n- 乙\r\n"));
  expect(add.selection).toBe(read(add.source, "文件名").children[1].id);
});
test("move a complete subtree in and out of another list without changing attachment or unrelated text", () => {
  const moved = change(source, "文件名", {
    type: "move",
    id: id("甲"),
    target: tree.children[2].id,
    placement: "child",
  });
  expect(moved.source).toBe(
    "# 计划\r\n\r\n- 乙\r\n- 乙\r\n  - 甲\r\n    + 细节\r\n      + 附录\r\n",
  );
  const next = read(moved.source, "文件名");
  const promoted = change(moved.source, "文件名", {
    type: "move",
    id: moved.selection!,
    target: next.children[0].id,
    placement: "before",
  });
  expect(promoted.source).toEqual(source);
  expect(() =>
    change(source, "", {
      type: "move",
      id: id("甲"),
      target: id("附录"),
      placement: "after",
    }),
  ).toThrow();
});
test("move a section as a list branch with no text loss and protect adjacent prose", () => {
  const src = "# 根\n- 清单\n\n## 分类 ##\n- A\n\n## 叙述\n\n原文段落\n";
  const root = read(src, "根");
  expect(find(root, "叙述")!.movable).toBe(false);
  const moved = change(src, "根", {
    type: "move",
    id: find(root, "分类")!.id,
    target: find(root, "清单")!.id,
    placement: "child",
  });
  expect(moved.source).toContain("- 清单\n  - 分类\n    - A");
  expect(moved.source.endsWith("## 叙述\n\n原文段落\n")).toBe(true);
  expect(() =>
    change(src, "根", { type: "delete", id: find(root, "叙述")!.id }),
  ).toThrow();
});
test("keep synthetic roots and filenames independent and preserve missing final newlines", () => {
  const src = "# 甲\n\n# 乙";
  const root = read(src, "项目");
  expect(root.label).toBe("项目");
  expect(root.editable).toBe(false);
  expect(
    change(src, "项目", { type: "child", id: root.id, label: "完成" }).source,
  ).toBe(src + "\n# 完成");
  expect(() =>
    change(src, "项目", { type: "rename", id: root.id, label: "标题" }),
  ).toThrow();
});
test("rich content, front matter, inline formatting and checkboxes are never overwritten", () => {
  const src =
    "# 主题\n\n- [ ] 第一项\n\n- 简单\n\n- **富文本**\n\n## 留言\n\n普通段落\n";
  const root = read(src, "标题");
  for (const label of ["第一项", "富文本", "留言"]) {
    const n = find(root, label)!;
    expect(n.movable).toBe(false);
    expect(() => change(src, "标题", { type: "delete", id: n.id })).toThrow();
  }
  expect(
    change(src, "标题", {
      type: "rename",
      id: find(root, "简单")!.id,
      label: "[x] **字**",
    }).source,
  ).toContain("- \\[x\\] \\*\\*字\\*\\*");
});

test("a legacy CR-only file and a file with mixed endings retain untouched bytes", () => {
  for (const body of ["# 根\r- 甲\r- 乙", "# 根\r\n- 甲\n- 乙\r\n"]) {
    const item = read(body, "根").children[1];
    const result = change(body, "根", {
      type: "rename",
      id: item.id,
      label: "丙",
    });
    expect(result.source).toEqual(body.replace("乙", "丙"));
    expect(result.selection).toBe(item.id);
  }
});

test("renaming an H1 that owns rich prose only changes the heading line", () => {
  const src = "# 根 ###\n\n> 重要说明！\n\n- [ ] 待办\n";
  const root = read(src, "文件名");
  expect(root.editable).toBe(true);
  expect(
    change(src, "文件名", { type: "rename", id: root.id, label: "新根" })
      .source,
  ).toEqual(src.replace("根", "新根"));
  expect(() =>
    change(src, "文件名", { type: "delete", id: root.id }),
  ).toThrow();
});

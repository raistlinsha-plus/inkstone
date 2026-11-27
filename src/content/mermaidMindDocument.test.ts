// @vitest-environment jsdom
import { expect, test } from "vitest";
import mermaid from "mermaid";
import type { CanvasNode, MindChange } from "./editableMind";
import { changeMermaidMind, readMermaidMind } from "./mermaidMindDocument";

const sample =
  "mindmap\n  root((中心主题))\n    分支一\n      11\n      22\n        221\n        222\n    分支二\n";
const find = (source: string, label: string) => {
  function flatten(node: CanvasNode): CanvasNode[] {
    return [node, ...node.children.flatMap(flatten)];
  }
  return flatten(readMermaidMind(source)!).find((n) => n.label === label)!;
};
const move = (
  src: string,
  label: string,
  target: string,
  placement: "before" | "after" | "child",
) =>
  changeMermaidMind(src, {
    type: "move",
    id: find(src, label).id,
    target: find(src, target).id,
    placement,
  });

test("uses the source hierarchy, shapes and order, including the original seven-node RAG example", () => {
  const root = readMermaidMind(sample)!;
  expect(root.label).toBe("中心主题");
  expect(root.shape).toBe("circle");
  expect(root.children.map((c) => c.label)).toEqual(["分支一", "分支二"]);
  expect(root.children[0].children[1].children.map((c) => c.label)).toEqual([
    "221",
    "222",
  ]);
  expect(root.movable).toBe(false);
});

test("renaming a quoted root and a repeated label preserves IDs, shape, whitespace, comments and CRLF", async () => {
  const s =
    '%% map\r\nmindmap\r\n  key(("中心 (A)"))  \r\n    one[相同]\r\n    two{{相同}}';
  const root = readMermaidMind(s)!;
  const changed = changeMermaidMind(s, {
    type: "rename",
    id: root.id,
    label: "中心 (B)",
  });
  expect(changed.source).toBe(s.replace("中心 (A)", "中心 #40;B#41;"));
  expect(readMermaidMind(changed.source)!.label).toBe("中心 (B)");
  const second = changeMermaidMind(s, {
    type: "rename",
    id: root.children[1].id,
    label: "分支 #2 <2026>",
  });
  expect(second.source).toBe(
    s.replace("two{{相同}}", "two{{分支 #35;2 #60;2026#62;}}"),
  );
  expect(readMermaidMind(second.source)!.children[1].label).toBe(
    "分支 #2 <2026>",
  );
  // Verify against Mermaid's shipped grammar as well as the editable reader.
  await expect(mermaid.parse(changed.source)).resolves.toBeTruthy();
  await expect(mermaid.parse(second.source)).resolves.toBeTruthy();
});

test("edits standard Mermaid shapes without rewriting author identifiers", async () => {
  const s =
    "mindmap\n root((主题))\n  round(圆角)\n  rect[矩形]\n  cloud)云(\n  bang))爆炸((\n  hex{{六边形}}\n  普通";
  expect(readMermaidMind(s)!.children.map((n) => n.shape)).toEqual([
    "rounded",
    "rect",
    "cloud",
    "bang",
    "hexagon",
    "plain",
  ]);
  const renamed = changeMermaidMind(s, {
    type: "rename",
    id: find(s, "云").id,
    label: "新云",
  });
  expect(renamed.source).toBe(s.replace("cloud)云(", "cloud)新云("));
  await expect(mermaid.parse(renamed.source)).resolves.toBeTruthy();
});

test("adds siblings after their subtree and children at the end of their parent without changing newline policy", () => {
  const s = sample.trimEnd();
  const a = changeMermaidMind(s, {
    type: "child",
    id: find(s, "22").id,
    label: "223",
  });
  expect(a.source).toBe(s.replace("        222", "        222\n        223"));
  expect(a.selection).toBe(find(a.source, "223").id);
  const b = changeMermaidMind(s, {
    type: "sibling",
    id: find(s, "22").id,
    label: "23",
  });
  expect(b.source).toBe(s.replace("        222", "        222\n      23"));
  expect(
    changeMermaidMind(b.source, { type: "delete", id: b.selection! }).source,
  ).toBe(s);
});

test("moving a subtree carries internal comments and keeps duplicate labels distinguishable", async () => {
  const src =
    "mindmap\n\troot((计划))\n\t\tA\n\t\t\t%% B 的说明\n\t\t\tB\n\t\t\t\tchild[重复]\n\t\tC\n\t\t\tD[重复]\n";
  const moved = move(src, "B", "C", "child");
  expect(moved.source).toBe(
    "mindmap\n\troot((计划))\n\t\tA\n\t\tC\n\t\t\tD[重复]\n\t\t\t%% B 的说明\n\t\t\tB\n\t\t\t\tchild[重复]\n",
  );
  expect(moved.selection).toBe(find(moved.source, "B").id);
  await expect(mermaid.parse(moved.source)).resolves.toBeTruthy();
  expect(move(moved.source, "B", "A", "child").source).toBe(src);
});

test("reorders a whole branch, adjusts its indentation when outdenting, and rejects cycles", () => {
  expect(move(sample, "分支二", "分支一", "before").source).toBe(
    sample
      .replace("    分支二\n", "")
      .replace("    分支一\n", "    分支二\n    分支一\n"),
  );
  const moved = move(sample, "22", "分支二", "after").source;
  expect(moved).toBe(
    "mindmap\n  root((中心主题))\n    分支一\n      11\n    分支二\n    22\n      221\n      222\n",
  );
  expect(move(moved, "22", "分支二", "after").source).toBe(moved);
  expect(() => move(sample, "分支一", "222", "child")).toThrow();
  expect(() => move(sample, "11", "中心主题", "before")).toThrow();
  expect(() => move(sample, "中心主题", "分支二", "child")).toThrow();
});

test("deletion removes the subtree while retaining original comments as notes", () => {
  const s = "mindmap\n  根\n    甲\n      %% 保留说明\n      子\n    乙";
  expect(
    changeMermaidMind(s, { type: "delete", id: find(s, "甲").id }).source,
  ).toBe("mindmap\n  根\n      %% 保留说明\n    乙");
});

test("rejects source-only syntax instead of silently losing directives or formatting", () => {
  for (const src of [
    "flowchart TD\n A-->B",
    sample + "      :::highlight",
    sample + "      ::icon(fa fa-code)",
    sample + '    b["`**重要**`"]',
    "mindmap\n  root\n  second",
    "%%{init: {}}%%\nmindmap\n  root",
    "mindmap\n  root\n    child\r\n    another",
    sample + "    n[broken)",
  ]) {
    expect(readMermaidMind(src)).toBeNull();
    expect(() =>
      changeMermaidMind(src, { type: "rename", id: "m1", label: "新名称" }),
    ).toThrow();
  }
  const id = find(sample, "中心主题").id;
  for (const change of [
    { type: "delete", id },
    { type: "sibling", id, label: "x" },
    { type: "child", id, label: "a\nb" },
  ] satisfies MindChange[]) {
    expect(() => changeMermaidMind(sample, change)).toThrow();
  }
});

test("all valid drops in the sample preserve the full tree and select the moved node", () => {
  const labels = ["中心主题", "分支一", "11", "22", "221", "222", "分支二"];
  const describe = (n: CanvasNode): unknown => [
    n.label,
    n.shape,
    n.children.map(describe),
  ];
  function lookup(root: CanvasNode, label: string): CanvasNode | undefined {
    if (root.label === label) return root;
    for (const child of root.children) {
      const found = lookup(child, label);
      if (found) return found;
    }
  }
  function detach(parent: CanvasNode, child: CanvasNode) {
    const index = parent.children.indexOf(child);
    if (index >= 0) parent.children.splice(index, 1);
    else parent.children.forEach((c) => detach(c, child));
  }
  for (const label of labels.slice(1)) {
    for (const target of labels) {
      for (const placement of ["before", "after", "child"] as const) {
        const expected = readMermaidMind(sample)!;
        const moving = lookup(expected, label)!;
        const destination = lookup(expected, target)!;
        if (
          lookup(moving, target) ||
          (destination === expected && placement !== "child")
        )
          continue;
        detach(expected, moving);
        if (placement === "child") destination.children.push(moving);
        else {
          const parent = labels
            .map((l) => lookup(expected, l))
            .find((n) => n?.children.includes(destination))!;
          parent.children.splice(
            parent.children.indexOf(destination) +
              (placement === "after" ? 1 : 0),
            0,
            moving,
          );
        }
        const result = move(sample, label, target, placement);
        expect(
          describe(readMermaidMind(result.source)!),
          [label, placement, target].join(" "),
        ).toEqual(describe(expected));
        expect(result.selection).toBe(find(result.source, label).id);
      }
    }
  }
});

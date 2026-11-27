import { expect, test } from "vitest";
import { mindPresentation, withMindStyle, type MindChange } from "./editableMind";
import { childPositionKey, positionedMind, transferPositions } from "./mindPositions";
import { changeMermaidMind, readMermaidMind } from "./mermaidMindDocument";
import { layOutMind, mindConnector } from "../preview/editableMindLayout";

test.each([
  ["mermaid", "\uFEFFmindmap\r\n  Root\r\n    图\r\n"],
  ["markdown", "\uFEFF---\r\nlang: zh\r\n---\r\n# Root\r\n- 图"],
] as const)("positions and style coexist and round-trip in %s", (format, body) => {
  const key = childPositionKey("$", "图-->/%", 0);
  const positions = new Map([[key, { x: -55, y: 8.25 }]]);
  const saved = withMindStyle(body, format, "color", positions);
  expect(saved.indexOf("inkstone-mind-style")).toBeGreaterThan(saved.indexOf(format === "mermaid" ? "mindmap" : "lang: zh"));
  expect(mindPresentation(saved, format)).toMatchObject({body, style: "color", lineCount: 2, positions});
  const onlyLayout = withMindStyle(body, format, "classic", positions);
  expect(mindPresentation(onlyLayout, format)).toMatchObject({body, style: "classic", lineCount: 1, positions});
  expect(withMindStyle(mindPresentation(onlyLayout, format).body, format, "classic")).toBe(body);
  const unknown = saved.replace('inkstone-mind-layout: [', 'inkstone-mind-layout: invalid[');
  expect(mindPresentation(unknown, format).body).toContain('inkstone-mind-layout: invalid[');
});

test("pinned duplicates retain identity through rename, insert, move and delete", () => {
  let source = "mindmap\n  Root\n    Topic\n      Leaf\n    Topic\n    B\n";
  const tree = () => readMermaidMind(source)!;
  let before = positionedMind(tree(), new Map());
  const key = before.children[0].positionKey!;
  const leaf = before.children[0].children[0].positionKey!;
  const second = before.children[1].positionKey!;
  const a = {x: 30, y: -50}, b = {x: 60, y: 10}, c = {x: 0, y: 7};
  before = positionedMind(tree(), new Map([[key, a], [leaf, c], [second, b]]));
  function edit(change: MindChange) {
    const result = changeMermaidMind(source, change);
    source = result.source;
    const positions = transferPositions(before, positionedMind(tree(), new Map()), change, result.selection);
    before = positionedMind(tree(), positions);
  }
  edit({type:"rename", id:before.children[0].id, label:"Renamed"});
  expect(before.children[1].offset).toEqual(b);
  edit({type:"sibling", id:before.children[0].id, label:"Topic"});
  expect(before.children.map(n => n.offset)).toEqual([a, undefined, b, undefined]);
  edit({type:"move", id:before.children[0].id, target:before.children[3].id, placement:"child"});
  expect(before.children[2].children[0].offset).toBeUndefined();
  expect(before.children[2].children[0].children[0].offset).toEqual(c);
  edit({type:"delete", id:before.children[0].id});
  expect(before.children[0].offset).toEqual(b);
});

test("negative manual offsets move the whole branch and preserve bounds and connector anchors", () => {
  const tree = readMermaidMind("mindmap\n  Root\n    A\n      Child\n    B\n")!;
  const initial = layOutMind(tree);
  tree.children[0].offset = {x: -400, y: -250};
  const moved = layOutMind(tree);
  for (const node of [tree.children[0], tree.children[0].children[0]]) {
    const old = initial.byId.get(node.id)!, box = moved.byId.get(node.id)!;
    expect([box.x - old.x, box.y - old.y]).toEqual([-400, -250]);
  }
  expect(moved.minX).toBeLessThan(0);
  expect(moved.minY).toBeLessThan(0);
  const b = moved.byId.get(tree.children[0].id)!;
  expect(mindConnector(b)).toMatch(new RegExp(", " + (b.x + b.w) + " "));
  for (const box of moved.boxes) {
    expect(box.x + box.w).toBeLessThanOrEqual(moved.minX + moved.width);
    expect(box.y + box.h).toBeLessThanOrEqual(moved.minY + moved.height);
  }
});

import { expect, test } from "vitest";
import { selectDocuments } from "./selectors";
import type { LibraryDocument } from "../library";
const make = (id: string, title: string, opened = 1): LibraryDocument => ({
  id,
  title,
  path: title,
  opened,
  updated: 10,
  projectId: "s",
  source: "",
  status: "ready",
});
test("natural ordering and ties are independent of incoming last-open order", () => {
  const docs = [
    make("c", "100.md"),
    make("b", "10.md"),
    make("a", "2.md"),
    make("e", "同名.md"),
    make("d", "同名.md"),
  ];
  const ids = (d: LibraryDocument[]) =>
    selectDocuments(d, "s", "all", "nameAsc", "", []).map((v) => v.id);
  expect(ids(docs)).toEqual(["a", "b", "c", "d", "e"]);
  expect(ids([...docs].reverse().map((d) => ({ ...d, opened: 999 })))).toEqual(
    ids(docs),
  );
  expect(
    selectDocuments(docs, "s", "all", "updatedDesc", "", []).map((v) => v.id),
  ).toEqual(ids(docs));
});
test("recent, pins, trash and other spaces have explicit independent membership", () => {
  const docs = [
    make("a", "a.md", 0),
    make("b", "b.md", 9),
    { ...make("t", "trash.md"), status: "trashed" as const },
    { ...make("p", "purge.md"), status: "purging" as const },
    { ...make("x", "other.md"), projectId: "other" },
  ];
  expect(
    selectDocuments(docs, "s", "recent", "nameAsc", "", ["a"]).map((d) => d.id),
  ).toEqual(["b"]);
  expect(
    selectDocuments(docs, "s", "trash", "nameAsc", "", []).map((d) => d.id),
  ).toEqual(["p", "t"]);
  expect(
    selectDocuments(docs, "s", "all", "nameDesc", "", ["a"]).map((d) => d.id),
  ).toEqual(["a", "b"]);
});

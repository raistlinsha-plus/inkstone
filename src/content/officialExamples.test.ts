import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { expect, test } from "vitest";
import { calendarBlocks } from "./calendar";
test("all executable calendar examples honor the current calendar contract", () => {
  const root = fileURLToPath(new URL("../../examples/", import.meta.url));
  let checked = 0;
  function walk(dir: string) {
    for (const item of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, item.name);
      if (item.isDirectory()) walk(path);
      else if (item.name.endsWith(".md"))
        for (const block of calendarBlocks(readFileSync(path, "utf8"))) {
          expect(block.error, path).toBeNull();
          expect(block.data, path).toBeTruthy();
          checked++;
        }
    }
  }
  walk(root);
  expect(checked).toBeGreaterThanOrEqual(3);
});

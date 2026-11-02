import test from "node:test";
import assert from "node:assert/strict";
import { failureSummary } from "./diagnostics.mjs";
test("failed compiler output preserves the actual diagnostic and Unicode", () => {
  assert.match(
    failureSummary("Compiling\nerror[E0308]: 参数不匹配\nfailed"),
    /error\[E0308\]: 参数不匹配/,
  );
});
test("diagnostics are bounded and retain the final failure", () => {
  const result = failureSummary(
    Array.from({ length: 500 }, (_, i) => `line ${i}`).join("\n") +
      "\nfinal failure",
  );
  assert.ok(result.split("\n").length <= 160);
  assert.ok(result.length <= 18000);
  assert.ok(result.endsWith("final failure"));
});
test("credential-shaped values are removed before truncation", () => {
  for (const secret of ["sk-" + "x".repeat(60), "ghp_" + "a".repeat(40)]) {
    const result = failureSummary("error " + secret);
    assert.ok(!result.includes(secret));
    assert.match(result, /redacted credential/);
  }
});

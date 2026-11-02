import test from "node:test";
import assert from "node:assert/strict";
import { reserveBudget, settleBudget } from "./budget.mjs";
const p = { maxHttpAttemptsAcrossRuns: 240, maxWallSecondsAcrossRuns: 1800 };
const initial = () => ({
  version: 1,
  spentAttempts: 0,
  spentSeconds: 0,
  runs: [],
});
test("unknown termination cannot restore paid request capacity", () => {
  const r = reserveBudget(initial(), p, "report.json");
  assert.equal(r.ledger.spentAttempts, 240);
  assert.throws(() => reserveBudget(r.ledger, p, "retry.json"), /exhausted/);
  const ledger = settleBudget(r, null, 1);
  assert.equal(ledger.spentAttempts, 240);
  assert.throws(() => reserveBudget(ledger, p, "retry.json"), /exhausted/);
});
test("known final reports refund unused capacity and accumulate actual attempts/time", () => {
  const a = reserveBudget(initial(), p, "a.json");
  const ledger = settleBudget(
    a,
    {
      version: "0.6.6",
      status: "failed-or-budget-stopped",
      usage: { httpAttempts: 23 },
    },
    10.2,
  );
  const b = reserveBudget(ledger, p, "b.json");
  assert.equal(b.attempts, 217);
  assert.equal(b.seconds, 1789);
  const final = settleBudget(
    b,
    { version: "0.6.6", status: "completed", usage: { httpAttempts: 7 } },
    2,
  );
  assert.equal(final.spentAttempts, 30);
  assert.equal(final.spentSeconds, 13);
});
test("invalid or incomplete usage cannot refund a reservation", () => {
  for (const result of [
    { version: "0.6.6", status: "running", usage: { httpAttempts: 2 } },
    { version: "0.6.6", status: "completed", usage: { httpAttempts: -1 } },
    { version: "0.6.6", status: "completed", usage: { httpAttempts: 241 } },
  ]) {
    const ledger = settleBudget(
      reserveBudget(initial(), p, "a.json"),
      result,
      2,
    );
    assert.equal(ledger.spentAttempts, 240);
  }
});
test("corrupt ledger, increased maximum or exhausted time stops before launch", () => {
  assert.throws(() =>
    reserveBudget({ ...initial(), spentAttempts: -1 }, p, "a"),
  );
  assert.throws(() =>
    reserveBudget(initial(), { ...p, maxHttpAttemptsAcrossRuns: 241 }, "a"),
  );
  assert.throws(() =>
    reserveBudget({ ...initial(), spentSeconds: 1800 }, p, "a"),
  );
});

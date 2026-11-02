// Reserve before launching a child. Unknown termination is charged in full.
export function reserveBudget(previous, protocol, report) {
  if (
    protocol.maxHttpAttemptsAcrossRuns !== 240 ||
    protocol.maxWallSecondsAcrossRuns !== 1800
  )
    throw Error("Frozen budget maximum changed");
  const ledger = structuredClone(previous);
  if (
    ledger.version !== 1 ||
    !Number.isInteger(ledger.spentAttempts) ||
    ledger.spentAttempts < 0 ||
    !Number.isFinite(ledger.spentSeconds) ||
    ledger.spentSeconds < 0 ||
    !Array.isArray(ledger.runs)
  )
    throw Error("Invalid cumulative budget ledger");
  const attempts = 240 - ledger.spentAttempts;
  const seconds = Math.floor(1800 - ledger.spentSeconds);
  if (attempts <= 0 || seconds <= 0)
    throw Error("Cumulative evaluation budget exhausted; no request sent");
  const before = {
    attempts: ledger.spentAttempts,
    seconds: ledger.spentSeconds,
  };
  const run = {
    report,
    status: "reserved",
    reservedAttempts: attempts,
    reservedSeconds: seconds,
    startedAt: new Date().toISOString(),
  };
  ledger.runs.push(run);
  ledger.spentAttempts += attempts;
  ledger.spentSeconds += seconds;
  return { ledger, run, before, attempts, seconds };
}
export function settleBudget(reservation, result, elapsedSeconds) {
  const { ledger, run, before, attempts, seconds } = reservation;
  if (!Number.isFinite(elapsedSeconds) || elapsedSeconds < 0)
    throw Error("Invalid elapsed time");
  if (
    result?.version === "0.6.6" &&
    ["completed", "failed-or-budget-stopped"].includes(result.status) &&
    Number.isInteger(result.usage?.httpAttempts) &&
    result.usage.httpAttempts >= 0 &&
    result.usage.httpAttempts <= attempts
  ) {
    ledger.spentAttempts = before.attempts + result.usage.httpAttempts;
    ledger.spentSeconds =
      before.seconds + Math.min(seconds, Math.ceil(elapsedSeconds));
    run.status = result.status;
    run.actualAttempts = result.usage.httpAttempts;
  } else run.status = "unknown-charged-full-reservation";
  run.finishedAt = new Date().toISOString();
  return ledger;
}

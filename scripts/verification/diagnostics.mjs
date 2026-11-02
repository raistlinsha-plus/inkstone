/** Keep failed-stage diagnostics visible in CI without dumping unlimited logs. */
export function failureSummary(log) {
  const safe = log.replace(
    /(?:sk-[A-Za-z0-9_-]{24,}|gh[pousr]_[A-Za-z0-9]{20,})/g,
    "[redacted credential]",
  );
  return safe.split("\n").slice(-160).join("\n").slice(-18000);
}

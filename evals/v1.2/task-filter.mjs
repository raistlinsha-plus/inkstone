// Run from the repository root. Use the same frontend task functions as the desktop UI.
import { createServer } from "vite";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";

const server = await createServer({
  server: { middlewareMode: true },
  appType: "custom",
  logLevel: "error",
});
try {
  const { projectTasks, filterTasks } = await server.ssrLoadModule(
    "/src/tasks/project.ts",
  );
  const documents = Array.from({ length: 1000 }, (_, i) => ({
    documentId: String(i),
    title: "Plan-" + i + ".md",
    path: "Plan-" + i + ".md",
    hash: "h",
    content:
      "# Plan " +
      i +
      " 🖋\n\n" +
      Array.from(
        { length: 5 },
        (_, j) =>
          "- [ ] 第 " +
          j +
          " 项工作 <!--inkstone-task:v1 " +
          JSON.stringify({ id: randomUUID(), due: "2026-11-26" }) +
          "-->\n",
      ).join(""),
  }));
  function measure(run, count) {
    const samples = [];
    for (let i = 0; i < count; i++) {
      const start = performance.now();
      const value = run();
      samples.push(performance.now() - start);
      if (value.length !== 5000) throw Error("Expected 5,000 tasks.");
    }
    samples.sort((a, b) => a - b);
    return {
      n: count,
      medianMs: samples[Math.floor(count / 2)],
      p95Ms: samples[Math.ceil(count * 0.95) - 1],
    };
  }
  const cold = measure(() => projectTasks(documents), 5);
  const cached = documents.map((doc) => ({
    ...doc,
    taskHash: doc.hash,
    taskRows: projectTasks([doc]).map((item) => item.task),
  }));
  const projected = projectTasks(cached);
  const cache = measure(() => projectTasks(cached), 50);
  const filter = measure(() => filterTasks(projected, "due", "2026-11-22"), 50);
  console.log(
    "TASK_BENCH",
    JSON.stringify({
      frontendFallback: cold,
      frontendCached: cache,
      dueFilter: filter,
    }),
  );
} finally {
  await server.close();
}

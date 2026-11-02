import {
  mkdir,
  readFile,
  writeFile,
  appendFile,
  rename,
} from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
const { version } = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
);
const out = new URL(
  `../artifacts/v${version}-development/timing/`,
  import.meta.url,
);
await mkdir(out, { recursive: true });
const [action, ...args] = process.argv.slice(2);
const phases = [
  "implementation",
  "review",
  "rework",
  "automatic",
  "bundle",
  "native",
  "external-wait",
  "documentation",
  "sync",
];
const log = new URL("events.jsonl", out),
  active = new URL("active.json", out);
const load = async () =>
  JSON.parse(
    await readFile(active, "utf8").catch((e) => {
      if (e.code === "ENOENT") return "{}";
      throw e;
    }),
  );
if (action === "start") {
  const [phase, task] = args;
  if (!phases.includes(phase) || !task)
    throw Error("start <phase> <task>；phase: " + phases.join(","));
  const state = await load();
  if (state[task]) throw Error("同一工作包已有在途计时");
  const event = {
    id: randomUUID(),
    task,
    phase,
    startedAt: new Date().toISOString(),
  };
  state[task] = event;
  await writeFile(new URL("active.tmp", out), JSON.stringify(state, null, 2));
  await rename(new URL("active.tmp", out), active);
  console.log(event);
} else if (action === "stop") {
  const state = await load(),
    event = state[args[0]];
  if (!event) throw Error("没有该工作包的在途计时");
  const finishedAt = new Date().toISOString();
  await appendFile(
    log,
    JSON.stringify({
      ...event,
      finishedAt,
      durationMs: Date.parse(finishedAt) - Date.parse(event.startedAt),
    }) + "\n",
  );
  delete state[args[0]];
  await writeFile(new URL("active.tmp", out), JSON.stringify(state, null, 2));
  await rename(new URL("active.tmp", out), active);
  console.log("计时已保存（并行活动不直接相加为墙钟总量）");
} else if (action === "report") {
  const rows = (
    await readFile(log, "utf8").catch((e) => {
      if (e.code === "ENOENT") return "";
      throw e;
    })
  )
    .trim()
    .split("\n")
    .filter(Boolean)
    .map(JSON.parse);
  const phases = {};
  for (const row of rows)
    phases[row.phase] = (phases[row.phase] || 0) + row.durationMs;
  console.log(
    JSON.stringify(
      {
        samples: rows.length,
        activityDurationMs: phases,
        wallSpanMs: rows.length
          ? Math.max(...rows.map((x) => Date.parse(x.finishedAt))) -
            Math.min(...rows.map((x) => Date.parse(x.startedAt)))
          : 0,
        active: await load(),
        note: "活动时长可重叠；wallSpan包含间隔，并非净开发时间；不足样本不报告P90。",
      },
      null,
      2,
    ),
  );
} else throw Error("用法：worklog start <phase> <task> | stop <task> | report");

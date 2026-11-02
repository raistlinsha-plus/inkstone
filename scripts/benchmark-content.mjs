import { build } from "esbuild";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
const dir = await mkdtemp(join(tmpdir(), "inkstone-benchmark-"));
try {
  const outfile = join(dir, "run.cjs");
  await build({
    stdin: {
      contents: `
 import {RichMarkdownAdapter} from './src/rich/markdown.ts';
 import {inspectJson} from './src/content/json.ts';
 import {outlineTree} from './src/content/mindmap.ts';
 import {chunkStructured} from './src/content/indexing.ts';
 const text='# 长文样本\\n\\n'+('这是一段中文 Markdown 正文，用于评估本地解析速度。\\n\\n'.repeat(1600));
 const json=JSON.stringify(Object.fromEntries(Array.from({length:1000},(_,i)=>['field'+i,i])));
 const mind='# 主题\\n\\n'+Array.from({length:20},(_,i)=>'- 分组'+i+'\\n'+Array.from({length:14},(_,j)=>'  - 节点'+i+'-'+j+'\\n').join('')).join('');
 const bench=(label,fn)=>{const values=[];for(let i=0;i<35;i++){const start=performance.now();fn();if(i>=5)values.push(performance.now()-start)}values.sort((a,b)=>a-b);return{label,samples:values.length,p50ms:+values[Math.ceil(values.length*.5)-1].toFixed(2),p95ms:+values[Math.ceil(values.length*.95)-1].toFixed(2)}};
 const adapter=new RichMarkdownAdapter(text);
 const metrics=[bench('Markdown source adaptation >100 KB',()=>adapter.prepare(text)),bench('Plain Markdown serialization shortcut',()=>adapter.serialize(text+'a')),bench('JSON AST 1000 fields',()=>inspectJson(json)),bench('Mindmap AST 300 content nodes',()=>outlineTree(mind)),bench('Structured chunking 1000 JSON fields',()=>chunkStructured(json,'sample.json',1800))];
 console.log(JSON.stringify({scope:'Node.js content-processing baseline; not native input latency or complete app memory',markdownBytes:Buffer.byteLength(text),metrics,processRssMiB:+(process.memoryUsage().rss/1024/1024).toFixed(1)},null,2));
 `,
      resolveDir: process.cwd(),
      loader: "ts",
    },
    bundle: true,
    mainFields: ["module", "main"],
    platform: "node",
    format: "cjs",
    outfile,
    logLevel: "silent",
  });
  const result = spawnSync(process.execPath, [outfile], { encoding: "utf8" });
  if (result.status !== 0) throw Error(result.stderr);
  await writeFile(
    "artifacts/v0.3-development/content-performance.json",
    result.stdout,
  );
  process.stdout.write(result.stdout);
} finally {
  await rm(dir, { recursive: true, force: true });
}

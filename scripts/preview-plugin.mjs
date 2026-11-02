import { build } from "esbuild";
import { createHash } from "node:crypto";
async function frameHtml(bundle) {
  const runtime = (await bundle()).replace(/<\/script/gi, "<\\/script");
  const digest = createHash("sha256").update(runtime).digest("base64");
  // Opaque, network-disabled frames carry only a hashed local bundle. Data charts
  // load their own renderer, so ordinary Mermaid/mindmap previews do not load ECharts.
  const policy = `default-src 'none'; script-src 'sha256-${digest}'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'`;
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${policy}"><style>html,body{margin:0;background:#fffefa;color:#303c32;font:14px system-ui}#graph{height:calc(100vh - 4px);overflow:auto;cursor:grab}svg{display:block}svg text{font-family:system-ui,sans-serif}body{overscroll-behavior:none}</style></head><body><div id="graph"></div><script>${runtime}</script></body></html>`;
}
export function previewPlugin() {
  const entries = new Map([
    ["/inkstone-preview.html", "src/preview/runtime.ts"],
    ["/inkstone-chart.html", "src/preview/chart-runtime.ts"],
  ]);
  const bundled = new Map();
  const bundle = (entry) => {
    if (!bundled.has(entry))
      bundled.set(
        entry,
        build({
          entryPoints: [entry],
          bundle: true,
          write: false,
          format: "iife",
          platform: "browser",
          target: "safari16",
          minify: true,
          legalComments: "none",
        }).then((r) => r.outputFiles[0].text),
      );
    return bundled.get(entry);
  };
  return {
    name: "inkstone-isolated-preview",
    async buildStart() {
      await Promise.all([...entries.values()].map(bundle));
    },
    configureServer(server) {
      server.watcher.on("change", (path) => {
        if (/\/src\/(preview|content)\//.test(path)) bundled.clear();
      });
      server.middlewares.use(async (req, res, next) => {
        const entry = entries.get(req.url?.split("?")[0]);
        if (!entry) return next();
        try {
          res.setHeader("Content-Type", "text/html");
          res.end(await frameHtml(() => bundle(entry)));
        } catch (error) {
          next(error);
        }
      });
    },
    async generateBundle() {
      for (const [url, entry] of entries)
        this.emitFile({
          type: "asset",
          fileName: url.slice(1),
          source: await frameHtml(() => bundle(entry)),
        });
    },
  };
}

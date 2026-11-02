import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { previewPlugin } from "./scripts/preview-plugin.mjs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

export default defineConfig({
  plugins: [react(), previewPlugin()],
  resolve: {
    // Its browser export requires document; the default export also works in Workers.
    alias: {
      "decode-named-character-reference":
        require.resolve("decode-named-character-reference"),
    },
  },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      ignored: [
        "**/src-tauri/**",
        "**/artifacts/**",
        "**/Inkstone项目/**",
        "**/licenses/**",
      ],
    },
  },
  envPrefix: ["VITE_", "TAURI_ENV_*"],
  build: { target: "safari16", sourcemap: true },
});

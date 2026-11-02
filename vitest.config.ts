import { defineConfig, mergeConfig } from "vitest/config";
import vite from "./vite.config.ts";
// Product suites only: archived checkouts and Node's tooling runner are separate gates.
export default mergeConfig(
  vite,
  defineConfig({ test: { include: ["src/**/*.test.{ts,tsx}"] } }),
);

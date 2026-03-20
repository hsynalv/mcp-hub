import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    setupFiles: ["./tests/vitest.setup.js"],
    include: [
      "tests/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts}",
      "src/core/legacy/**/*.test.js",
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      exclude: [
        "node_modules/",
        "tests/",
        "cache/",
        "**/*.config.{js,ts}",
      ],
      thresholds: {
        // Core modules - strict requirements
        "src/core/**/*.js": {
          branches: 85,
          functions: 85,
          lines: 85,
          statements: 85,
        },
        // Plugin entry points - moderate requirements
        "src/plugins/*/index.js": {
          branches: 60,
          functions: 70,
          lines: 75,
          statements: 75,
        },
      },
    },
    pool: "forks",
  },
});

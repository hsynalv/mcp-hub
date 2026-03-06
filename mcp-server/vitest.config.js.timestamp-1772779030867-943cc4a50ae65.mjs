// vitest.config.js
import { defineConfig } from "file:///Users/beyazskorsky/Documents/mcp/mcp-server/node_modules/vitest/dist/config.js";
var vitest_config_default = defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts}"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      exclude: [
        "node_modules/",
        "tests/",
        "cache/",
        "**/*.config.{js,ts}"
      ]
    },
    pool: "forks"
  }
});
export {
  vitest_config_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZXN0LmNvbmZpZy5qcyJdLAogICJzb3VyY2VzQ29udGVudCI6IFsiY29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2Rpcm5hbWUgPSBcIi9Vc2Vycy9iZXlhenNrb3Jza3kvRG9jdW1lbnRzL21jcC9tY3Atc2VydmVyXCI7Y29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2ZpbGVuYW1lID0gXCIvVXNlcnMvYmV5YXpza29yc2t5L0RvY3VtZW50cy9tY3AvbWNwLXNlcnZlci92aXRlc3QuY29uZmlnLmpzXCI7Y29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2ltcG9ydF9tZXRhX3VybCA9IFwiZmlsZTovLy9Vc2Vycy9iZXlhenNrb3Jza3kvRG9jdW1lbnRzL21jcC9tY3Atc2VydmVyL3ZpdGVzdC5jb25maWcuanNcIjtpbXBvcnQgeyBkZWZpbmVDb25maWcgfSBmcm9tIFwidml0ZXN0L2NvbmZpZ1wiO1xuXG5leHBvcnQgZGVmYXVsdCBkZWZpbmVDb25maWcoe1xuICB0ZXN0OiB7XG4gICAgZ2xvYmFsczogdHJ1ZSxcbiAgICBlbnZpcm9ubWVudDogXCJub2RlXCIsXG4gICAgaW5jbHVkZTogW1widGVzdHMvKiovKi57dGVzdCxzcGVjfS57anMsbWpzLGNqcyx0cyxtdHMsY3RzfVwiXSxcbiAgICBjb3ZlcmFnZToge1xuICAgICAgcHJvdmlkZXI6IFwidjhcIixcbiAgICAgIHJlcG9ydGVyOiBbXCJ0ZXh0XCIsIFwianNvblwiLCBcImh0bWxcIl0sXG4gICAgICBleGNsdWRlOiBbXG4gICAgICAgIFwibm9kZV9tb2R1bGVzL1wiLFxuICAgICAgICBcInRlc3RzL1wiLFxuICAgICAgICBcImNhY2hlL1wiLFxuICAgICAgICBcIioqLyouY29uZmlnLntqcyx0c31cIixcbiAgICAgIF0sXG4gICAgfSxcbiAgICBwb29sOiBcImZvcmtzXCIsXG4gIH0sXG59KTtcbiJdLAogICJtYXBwaW5ncyI6ICI7QUFBMFQsU0FBUyxvQkFBb0I7QUFFdlYsSUFBTyx3QkFBUSxhQUFhO0FBQUEsRUFDMUIsTUFBTTtBQUFBLElBQ0osU0FBUztBQUFBLElBQ1QsYUFBYTtBQUFBLElBQ2IsU0FBUyxDQUFDLGdEQUFnRDtBQUFBLElBQzFELFVBQVU7QUFBQSxNQUNSLFVBQVU7QUFBQSxNQUNWLFVBQVUsQ0FBQyxRQUFRLFFBQVEsTUFBTTtBQUFBLE1BQ2pDLFNBQVM7QUFBQSxRQUNQO0FBQUEsUUFDQTtBQUFBLFFBQ0E7QUFBQSxRQUNBO0FBQUEsTUFDRjtBQUFBLElBQ0Y7QUFBQSxJQUNBLE1BQU07QUFBQSxFQUNSO0FBQ0YsQ0FBQzsiLAogICJuYW1lcyI6IFtdCn0K

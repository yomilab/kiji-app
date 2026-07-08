import { defineConfig } from "vitest/config";

const isCi = process.env.CI === "true" || process.env.KIJI_RUN_E2E_IN_CI === "1";

export default defineConfig({
  test: {
    name: "e2e",
    environment: "node",
    include: ["test/**/*.e2e.test.ts"],
    testTimeout: isCi ? 600_000 : 180_000,
    hookTimeout: isCi ? 600_000 : 180_000,
    restoreMocks: false,
    clearMocks: false,
    fileParallelism: false,
    maxWorkers: 1,
    retry: isCi ? 2 : 0,
  },
});

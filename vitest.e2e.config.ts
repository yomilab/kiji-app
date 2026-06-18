import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "e2e",
    environment: "node",
    include: ["test/**/*.e2e.test.ts"],
    testTimeout: 180_000,
    hookTimeout: 180_000,
    restoreMocks: false,
    clearMocks: false,
  },
});

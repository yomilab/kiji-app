import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

const rootDir = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      { find: "@", replacement: fileURLToPath(new URL("./src", import.meta.url)) },
      { find: /\?raw$/, replacement: `${rootDir}/test/__mocks__/rawAsset.ts` },
      {
        find: /\.(png|jpe?g|gif|webp|avif|ico|bmp|svg)$/,
        replacement: `${rootDir}/test/__mocks__/fileAsset.ts`,
      },
    ],
  },
  test: {
    name: "unit",
    environment: "jsdom",
    include: ["test/**/*.test.ts", "test/**/*.test.tsx"],
    exclude: ["test/**/*.e2e.test.ts"],
    setupFiles: ["./test/setup.ts"],
    restoreMocks: true,
    clearMocks: true,
    css: false,
    server: {
      deps: {
        inline: [
          "cheerio",
          "dom-serializer",
          "dom-handler",
          "domutils",
          "htmlparser2",
          "entities",
          "css-select",
          "css-what",
          "linkedom",
        ],
      },
    },
  },
});

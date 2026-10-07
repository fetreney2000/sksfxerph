import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // Unit + component tests. Individual files opt into jsdom with the
    // `@vitest-environment jsdom` docblock; e2e lives under Playwright.
    include: ["tests/**/*.test.{ts,tsx}"],
    globals: false,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname),
    },
  },
});

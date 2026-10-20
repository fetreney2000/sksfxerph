import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // Unit + component tests. Individual files opt into jsdom with the
    // `@vitest-environment jsdom` docblock; e2e lives under Playwright.
    include: ["tests/**/*.test.{ts,tsx}"],
    globals: false,
    /**
     * The suite must behave the same on every machine.
     *
     * Two things leak in from the developer's shell otherwise, and both break
     * tests that are otherwise correct:
     *
     *   NODE_ENV=production — React loads `react.production.js`, which has no
     *     `act` export (it is development-only), so every component test dies
     *     on "React.act is not a function". Vitest only defaults NODE_ENV to
     *     "test" when it is unset, so an inherited value wins.
     *
     *   A populated `.env` — Vite loads it, `supabaseConfigured` becomes true,
     *     and `resolveUser()` takes the Supabase branch instead of the local
     *     one. The route handlers then try to read a live `erph.user` row and
     *     answer 401, which is exactly what `tests/unit/docx-export.test.ts`
     *     ("Local mode, deliberately") is not testing.
     *
     * `playwright.config.ts` already blanks the same two variables for the
     * same reason; this is that rule applied to Vitest.
     */
    env: {
      NODE_ENV: "test",
      NEXT_PUBLIC_SUPABASE_URL: "",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "",
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname),
    },
  },
});

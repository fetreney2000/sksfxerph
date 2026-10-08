# Frontend Technology Stack — eRPH

_Refined, opinionated stack for the eRPH PWA. Companion to `erph-frontend-research.md` (UX) and `erph-backend-research.md` (Supabase/Vercel backend). Versions verified as of **4 October 2026**. Target: one school, non-commercial, **Vercel Hobby + Supabase Free**._

---

## 1 · Decision summary

| Layer | Choice | Version (Oct 2026) | One-line reason |
|---|---|---|---|
| Framework | **Next.js (App Router)** | 16.3.x (LTS, security-supported) | Ships on Vercel; route handlers replace a separate API layer; `proxy.ts` handles Supabase session refresh |
| UI runtime | **React** | 19.2 (View Transitions, `useEffectEvent`) | Next 16 pairs with React 19; **React Compiler is stable in Next 16** → automatic memoization, no `useMemo` tax |
| Language | **TypeScript** | 5.x, `strict: true` | Shared types with the SQL schema via Supabase type generation |
| Bundler | **Turbopack** | default in Next 16 | Fast dev/build; caveat with Serwist in §7 |
| Styling | **Tailwind CSS v4** | v4, CSS-first `@theme` | The mockup's token block drops straight into `@theme`; no `tailwind.config.js` |
| Components | **shadcn/ui** (v4 CLI) + **Radix primitives** | Mar 2026 | You *own* the component source — no dependency rot, full Malay-label control |
| Icons | **lucide-react** | current | Tree-shaken SVGs, matches the mockup's 1.7px stroke set |
| Forms | **react-hook-form + @hookform/resolvers + Zod v4** | v7 / v4 | One schema drives client validation, error copy, and payload shape |
| Server state | **Server Components** (reads) + **TanStack Query v5** (client mutations/live views) | v5.39+ | v5.39+ is React-19-compatible; avoids double-fetching on the editor/queue |
| Local/offline state | **Dexie 4** (IndexedDB + `liveQuery`) | v4 | Offline source of truth + reactive UI without a state library |
| Service worker | **Serwist** (`@serwist/next`) | current | Successor to next-pwa; Turbopack-compatible (see §7 caveat) |
| Connectivity | **`experimental.useOffline`** (Next built-in) | Next 16 | Framework-level online/offline signal for the sync chip |
| Auth/data | **@supabase/ssr + @supabase/supabase-js** | current | Cookie sessions in Server Components via `proxy.ts` (Next 16's middleware rename) |
| Tables | **TanStack Table v8** | v8 | Headless — the mockup's review/compliance tables map directly |
| Charts | **Hand-rolled CSS/SVG** (no library) | — | The mockup already renders the chart with divs; one chart does not justify a 100 KB dep |
| Toasts | **sonner** | current | shadcn's replacement for its deprecated `toast` component |
| Toast/dialog/popover primitives | **Radix UI** (via shadcn) | current | Keyboard + screen-reader behaviour out of the box (WCAG) |
| PDF/DOCX | **client print CSS** first, **`@react-pdf/renderer`** (browser) / **`docx`** (server) | current | Headless Chrome doesn't fit free serverless (backend doc §2.1) |
| i18n | **Typed dictionary, `ms-MY` only** (no i18next) | — | One locale; a library is dead weight. Add `next-intl` only if a second language ever appears |
| Testing | **Vitest + Testing Library + Playwright** | current | jsdom for units, real browser for the offline/sync flow |
| Lint/format | **Biome** | current | One fast binary replaces ESLint + Prettier on a Hobby project |
| Bundle analysis | `@next/bundle-analyzer` + Lighthouse CI | current | Enforces the §9 budget |

---

## 2 · Framework decision: why Next.js (and what it costs)

| | **Next.js 16 App Router** ✅ | Vite + React SPA | React Router 7 (framework) | SvelteKit |
|---|---|---|---|---|
| Vercel first-class support | ✅ native | ✅ static | ⚠️ adapter | ⚠️ adapter |
| Server route handlers (`/api/sync`, PDF, Classroom) | ✅ built-in | ⚠️ separate functions | ✅ built-in | ✅ built-in |
| Auth session refresh | ✅ `proxy.ts` | ❌ client-only | ⚠️ | ⚠️ |
| PWA/service worker | ✅ Serwist / official guide | ✅ simplest | ✅ | ✅ |
| Offline dashboard (prerendered shell) | ✅ | ✅ | ✅ | ✅ |
| Ecosystem fit with Supabase docs | ✅ most examples | ✅ | ✅ | ⚠️ |
| Ecosystem fit with shadcn/ui | ✅ first-class | ✅ | ⚠️ | ⚠️ |
| Learning curve / complexity | ⚠️ highest | ✅ lowest | ✅ | ⚠️ |
| Build times (free tier) | ✅ Turbopack | ✅ | ✅ | ✅ |

**Chosen: Next.js 16.** The deciding factors are the built-in route handlers (the offline sync, PDF export and Classroom push all need *some* server code — an SPA would need a second deployable), the `proxy.ts` session refresh that Supabase's SSR guide is written around, and Vercel's zero-config hosting.

**The honest cost:** App Router is the most complex option, and Server Components are useless the moment the app is offline (they render on the server). So the rule is strict:

> **Server Components only for read-only, online-only screens (school dashboard, reports). Everything a teacher touches offline — editor, review queue, history — is a Client Component backed by Dexie.**

**Rejected:**
- *Vite SPA* — would work, but pushes sync/PDF/Classroom into a separate serverless app; two deployables for one product.
- *React Router 7 / SvelteKit* — fine technically, but Supabase + shadcn docs are overwhelmingly Next-flavoured; wrong bet for a solo dev.
- *Remix* — effectively merged into React Router; no reason to pick it now.
- *Electron / Capacitor native shell* — a PWA installs to the home screen already; a shell adds store/signing overhead for zero users outside the school.

---

## 3 · Rendering strategy per screen

Map from the mockup's six views:

| View | Rendering | Data source | Offline? |
|---|---|---|---|
| `Minggu Ini` (dashboard) | **Server Component** shell + client hydration for the week table | `school_week_stats` RPC / `v_teacher_week` view | cached shell + last Dexie snapshot |
| `Editor RPH` | **Client Component** entirely | Dexie (`liveQuery`) → queue → `/api/sync` | ✅ full write capability |
| `Perpustakaan Templat` | Server Component (list) + client actions | `rph_template` via PostgREST | read-only cache |
| `Sejarah & Arkib` | Server Component + paginated table | `rph_document` (owner scope) | last page cached |
| `Semakan RPH` (queue) | **Client Component** + TanStack Query | RPC `review_rph`, Realtime channel | view-only offline; grading requires network |
| `Paparan Sekolah` | **Server Component** (CSR island for filters) | `v_school_compliance` | online-only (admin) |

**Rules:**
1. Never fetch in a Server Component *and* the client for the same data — pick one.
2. Anything that mutates goes through TanStack Query `useMutation` so the queue state, optimistic UI and retry are one code path.
3. Admin screens are online-only by design — don't pay offline complexity for the 2 people who review RPH.

---

## 4 · The offline layer (the part that makes or breaks this app)

```
User edits RPH (Client Component)
   └─► Dexie `documents` store  (liveQuery → UI re-renders instantly)
        └─► Dexie `syncQueue` store  {op_id, entity, payload, client_updated_at, attempts}
             ├─ online  → POST /api/sync (batched, idempotent) → apply returned versions
             └─ offline → wait; Serwist `sync` event + `online` listener retry with backoff
```

- **Dexie schema mirrors the SQL natural key**: `documents` keyed by `id`, index `[owner_id, session, week_no, plan_date]`, so the client can find duplicates before they hit the server's unique constraint.
- **`op_id` is minted once** per edit-commit (crypto.randomUUID) — retries are no-ops server-side via `sync_op`.
- **Conflict display**: `/api/sync` returns `{result:'applied', version}` or a conflict flag → the UI shows the amber "versi lain dikemas kini" chip from the mockup.
- **Never block the user on the network**: the editor's save button writes to Dexie only; sync is fire-and-forget in the background with a visible queue count (the mockup's `Disegerakkan / Luar talian · 2 belum diselesaikan` chip).
- **Service worker scope**: cache the app shell, routes, and the DSKP reference JSON; **never** cache authenticated API responses (stale RPH is a correctness bug, not just a UX one).

---

## 5 · Directory structure

```
erph/
├─ app/
│  ├─ (auth)/login/                 # Google SSO gate
│  ├─ (app)/
│  │  ├─ minggu/                    # dashboard  (RSC)
│  │  ├─ editor/[id]/               # editor     (client)
│  │  ├─ templat/  ├─ arkib/        # RSC
│  │  ├─ semakan/                   # review     (client)
│  │  └─ sekolah/                   # monitoring (RSC)
│  ├─ api/
│  │  ├─ sync/route.ts              # POST batch → rpc sync_rph
│  │  ├─ export/[id]/route.ts       # DOCX/PDF
│  │  └─ heartbeat/route.ts         # Vercel cron → keeps Supabase free project awake
│  ├─ proxy.ts                      # Next 16: Supabase getClaims() + cookie refresh
│  ├─ sw.ts                         # Serwist source
│  └─ layout.tsx
├─ components/
│  ├─ ui/                           # shadcn-generated, owned source
│  ├─ rph/                          # RphPaper, DskpPicker, CompletenessMeter…
│  └─ sync/SyncStatus.tsx
├─ lib/
│  ├─ supabase/{client,server}.ts
│  ├─ db.ts                         # Dexie instance + schema
│  ├─ sync/queue.ts                 # enqueue / flush / backoff
│  ├─ queries.ts                    # TanStack Query keys + hooks
│  ├─ schemas/rph.ts                # Zod payload schema (mirrors payload_version)
│  └─ i18n/ms.ts                    # typed dictionary
├─ db/schema.sql  (source of truth → supabase gen types typescript)
└─ tests/{unit,e2e}/
```

**Type flow:** `db/schema.sql` → `supabase gen types typescript` → `lib/database.types.ts` → PostgREST calls are fully typed; `lib/schemas/rph.ts` types the JSONB `payload` (the one thing SQL can't type for you).

---

## 6 · Key configuration notes

**`proxy.ts` (Next 16 renamed `middleware.ts` → `proxy.ts`)** — Supabase's own docs call this out: on Next 15 and earlier the file is `middleware.ts`; if you copy an older tutorial you'll ship a config that silently never runs and users get signed out mid-session.

**Tailwind v4** — no `tailwind.config.js`; the mockup's `:root` token block becomes `@theme`. Dark mode = the `html[data-theme="dark"]` override already in the mockup (toggle, not `prefers-color-scheme` — the school wants a deliberate switch).

**Fonts** — `next/font` self-hosts Inter at build time (no runtime Google Fonts request → no privacy question under PDPA, no render-blocking fetch).

**Images** — `next/image` with `formats: ['image/avif','image/webp']`; keep the app icon set tiny since the PWA manifest is cached.

**React Compiler** — stable in Next 16; skip manual `useMemo`/`useCallback` unless profiling proves a need.

---

## 7 · Known friction to plan for

| Issue | Detail | Mitigation |
|---|---|---|
| **Serwist × Turbopack** | Serwist's Turbopack support is incomplete (GitHub #54); some setups need `next build --webpack`, and dev SW testing needs `--webpack` explicitly | Keep `next dev --turbopack` for daily work; a `dev:pwa` script with `--webpack` for SW testing only. **Fallback:** the hand-rolled `public/sw.js` approach from Next's official PWAs guide (~60 lines, full control, no bundler dependency) |
| **Server Components ≠ offline** | They 404/fail without a network on first load | Precache the shell with Serwist so the *route* loads, then hydrate from Dexie |
| **Two sources of truth** | Server Components read Supabase; the editor reads Dexie | Strict per-view split (§3); never render the same data both ways on one screen |
| **PWA + `next/image`** | Images can bypass SW caching | Precache `/icons/*` explicitly in the SW manifest |
| **Realtime on 200 free connections** | Admin channel is fine; teacher channels are not needed | Teachers poll (SWR `staleTime` 30 s); only the review screen subscribes |

---

## 8 · Package manifest (starting point)

```jsonc
{
  "dependencies": {
    "next": "^16.3.8", "react": "^19.2.0", "react-dom": "^19.2.0",
    "@supabase/ssr": "latest", "@supabase/supabase-js": "latest",
    "@tanstack/react-query": "^5", "@tanstack/react-table": "^8",
    "react-hook-form": "^7", "@hookform/resolvers": "^5", "zod": "^4",
    "dexie": "^4", "dexie-react-hooks": "^1",
    "serwist": "latest", "@serwist/next": "latest",
    "sonner": "latest", "lucide-react": "latest",
    "clsx": "latest", "tailwind-merge": "latest", "class-variance-authority": "latest",
    "docx": "latest"                      // server DOCX; @react-pdf/renderer only if client PDF is needed
  },
  "devDependencies": {
    "typescript": "^5", "tailwindcss": "^4", "@tailwindcss/postcss": "^4",
    "@biomejs/biome": "latest",
    "vitest": "latest", "@testing-library/react": "latest", "jsdom": "latest",
    "@playwright/test": "latest", "msw": "latest",
    "@next/bundle-analyzer": "latest"
  }
}
```

shadcn/ui components arrive as **source files**, not dependencies — they're generated into `components/ui/`, so they never appear here.

---

## 9 · Performance & quality budget

| Metric | Budget | How enforced |
|---|---|---|
| First Load JS per route | **≤ 170 KB** (editor ≤ 200 KB) | `@next/bundle-analyzer` in CI; fail build over budget |
| LCP (Slow 4G, mid-range Android) | ≤ 2.5 s | Lighthouse CI |
| INP | ≤ 200 ms | Lighthouse CI |
| Accessibility score | ≥ 95 | Lighthouse CI (Radix gives most of it for free) |
| Time-to-first-RPH (new teacher) | < 5 min | manual usability pass, SUS ≥ 68 |
| Median weekly RPH (with clone) | < 5 min | product metric |
| Offline cold start (airplane mode) | shell loads < 1.5 s | Playwright offline test |
| Zero unhandled RHF/Zod errors | 100 % | unit tests on `lib/schemas/rph.ts` |

**Deliberately excluded to protect the budget:** chart libraries, i18n frameworks, date libraries (`Intl.DateTimeFormat` + `Asia/Kuala_Lumpur` covers it), CSS-in-JS, Redux/Zustand (Dexie + TanStack Query own state).

---

## 10 · Testing strategy

1. **Unit (Vitest + jsdom)** — Zod payload schema, completeness calculation (must agree with SQL `rph_completeness()` — test the same fixtures against both), sync queue backoff, i18n dictionary completeness.
2. **Component (Testing Library)** — DskpPicker, CompletenessMeter, review grade buttons incl. keyboard `1`/`0`.
3. **E2E (Playwright)** — login → draft → **airplane mode** → edit → reload (Dexie survives) → online → sync chip clears → admin grades → notification appears. This *is* the product; it's one test worth automating.
4. **API/RLS (Playwright `request` or supabase-js with two users)** — teacher A cannot read teacher B's RPH; a client `PATCH status='approved'` must be rejected by `guard_review_fields`.
5. **MSW** for route-handler mocking in component tests.

---

## 11 · Free-tier compatibility (recap)

Everything above fits **Vercel Hobby + Supabase Free**:
- No edge runtime anywhere — all handlers are Node runtime (300 s max, far beyond need).
- Vercel cron: **1×/day** → only `/api/heartbeat` + the daily digest; all sub-daily scheduling lives in `pg_cron`.
- Static assets + `next/image` sit well inside Hobby's ~100 GB bandwidth; PDFs stream from **Supabase Storage signed URLs**, not through Vercel.
- One Serwist service worker = one cached asset family; Dexie data is device-local (0 bytes of quota traffic).
- The **only** paid-tier temptation is wanting preview branches (Supabase) or sub-daily cron (Vercel) — both mitigated in the backend doc §2.2.

---

## 12 · Build order

1. `create-next-app` + Tailwind v4 + shadcn init + Biome — port the mockup tokens into `@theme`.
2. `proxy.ts` + Supabase clients + login → verify session refresh on Next 16.
3. Generate types from `db/schema.sql`; wire RLS-tested reads (dashboard as RSC).
4. Dexie + editor (client) with local-only save — **offline works before sync does**.
5. `/api/sync` + queue flush + sync chip states.
6. Review queue (client + `review_rph` RPC + keyboard shortcuts).
7. Serwist shell caching + Playwright offline test.
8. Export (print CSS → DOCX), reports, polish, Lighthouse CI gate.

Steps 4→5 is the deliberate sequencing: a working local-first editor means the app is *usable* even if the network layer slips.

---

## Sources
- Next.js releases (16.3.8, 30 Sep 2026) & security notes: https://github.com/vercel/next.js/releases · https://nextjs.org/blog
- Next.js PWAs guide (incl. `useOffline`): https://nextjs.org/docs/app/guides/progressive-web-apps
- Serwist + Next.js 16 (Turbopack caveat): https://blog.logrocket.com/nextjs-16-pwa-offline-support · https://aurorascharff.no/posts/dynamically-generating-pwa-app-icons-nextjs-16-serwist
- Supabase SSR client creation & the Next 16 `proxy.ts` rename: https://supabase.com/docs/guides/auth/server-side/creating-a-client
- Tailwind v4 + shadcn/ui (v4 CLI, sonner): https://ui.shadcn.com/docs/tailwind-v4 · https://ui.shadcn.com/docs/changelog/2026-03-cli-v4
- React Query v5 + React 19: https://tkdodo.eu/blog/react-19-and-suspense
- Dexie 4 (`liveQuery`, offline-first): https://dexie.org
- Zod 4: https://news.ycombinator.com/item?id=44030850

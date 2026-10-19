---
AIGC:
    Label: "1"
    ContentProducer: 001191440300708461136T1XGW3
    ProduceID: e821b9ee54e031e8318c478725a8d21c_627f4186c98111f196f9525400248c00
    ReservedCode1: YFTX+K5rigjGeWyhFfI+0BR+B29JOB88ihChraBC96zcp+KS7Ev0nBabkXLn9HZrnn8k04ZGiZZAIlDqPdAYCWYzlDhsjC0kkjiM0AbVfMymrh5KxGttXP/Zi52kkr/g8+9f37tqFmrEETlteIZPAK+lOac3E0xYITCEiQ4lNgzEARhVhUTwcnxyJS4=
    ContentPropagator: 001191440300708461136T1XGW3
    PropagateID: e821b9ee54e031e8318c478725a8d21c_627f4186c98111f196f9525400248c00
    ReservedCode2: YFTX+K5rigjGeWyhFfI+0BR+B29JOB88ihChraBC96zcp+KS7Ev0nBabkXLn9HZrnn8k04ZGiZZAIlDqPdAYCWYzlDhsjC0kkjiM0AbVfMymrh5KxGttXP/Zi52kkr/g8+9f37tqFmrEETlteIZPAK+lOac3E0xYITCEiQ4lNgzEARhVhUTwcnxyJS4=
---

# Architecture

## 1. Goals

Milestone 1 builds a **runnable foundation** for the AI Software Factory MVP:

- A maintainable monorepo shared by the Web app and background Worker.
- Real persistence (Neon PostgreSQL via Drizzle) for the complete future workflow.
- Real authentication (Neon Auth) — no fake users.
- A typed, persisted workflow engine with safe job ownership and recovery.
- Deployment-ready configuration for Railway (Web + Worker).

Everything AI-related (OpenAI, sandboxes, previews, exports) is **reserved**
for later milestones and is never simulated as working.

## 2. Package manager

**npm workspaces** (npm >= 10). Reasons:

- No extra install step (npm ships with Node).
- Mature workspace support with `--workspaces` and `-w <pkg>` flags.
- Sufficient for a two-app, four-package monorepo without overengineering.

## 3. Monorepo structure and package boundaries

```text
apps/
  web/        Next.js app: Neon Auth routes, server actions, protected dashboard,
              project CRUD (M1 scope). Depends on @asf/core types + @asf/db schema.
  worker/     Node.js TS worker: safe job claiming, leases, recovery, dispatch.
              Depends on @asf/core + @asf/db.
packages/
  db/         Drizzle schema (all tables), drizzle config, migrate runner,
              createDb client (postgres-js). No business logic.
  core/       Pure TypeScript: workflow states, transitions, approval stages,
              events, job semantics (lease/backoff), unit-tested. No I/O.
  agents/     AI Provider abstraction + OpenAI stub (NOT implemented in M1 —
              calling throws NOT_IMPLEMENTED_M1).
  integrations/ Sandbox provider contract (VercelSandboxProvider stub) and
              TechnologyAdapter registry for generated apps. No runtime calls.
templates/    Reserved for M4/M5 generated application templates.
```

Dependency direction: `apps/* → packages/*`, `packages/*` never depend on
`apps/*`. `core` depends on nothing. `db` depends on Drizzle only. This keeps
future agent, sandbox, and provider replacements local.

## 4. Authentication (Neon Auth)

- SDK: `@neondatabase/auth` (beta, Better Auth based), per current Neon docs.
- Server: `createNeonAuth({ baseUrl, cookies: { secret } })` in
  `apps/web/lib/auth/server.ts`; auth handler mounted at `app/api/auth/[...path]`.
- Client: `createAuthClient` available for later interactive flows.
- Session: `auth.getSession({ headers })` in server actions and pages.
- Protection: `middleware.ts` redirects unauthenticated `/dashboard/*` to
  `/auth/sign-in`; every data access re-validates ownership via `ownerId`.
- Users are provisioned in the **Neon Console** (Authentication → Users), or
  via Neon's sign-up endpoints; M1 web UI exposes sign-in (email/password).
- Callback configuration: set the web app URL as an allowed callback origin
  in the Neon Console so the auth handler can issue session cookies.

No custom password system exists. Missing variables fail loudly at request time.

## 5. Worker and job queue

- Worker polls `workflow_jobs` for `status = 'queued' AND available_at <= now`.
- Claiming uses one atomic `UPDATE … RETURNING` with
  `FOR UPDATE SKIP LOCKED`, so two workers can never process the same job.
- Claimed jobs get `claimed_by`, `lease_expires_at`, `started_at`.
- On startup (and each loop) `recoverStaleJobs` resets expired
  `claimed/running` leases back to `queued` (crash recovery).
- Failures: `failJob` increments `attempts`; while attempts remain it requeues
  with exponential backoff (`available_at`), otherwise it marks the job failed.
- Success: `completeJob` writes `result` + `finished_at`; lifecycle events are
  recorded in `lifecycle_events` for auditability.
- M1 handler: `project_initialization` — advances a project from
  `idea_submitted` to `consultation` through the typed state machine. It is an
  **internal pipeline verification**, not an AI agent run.
- Idempotency foundation: status guards prevent double processing; retries are
  explicit; future handlers should use idempotency keys on side effects.

## 6. Railway deployment

Two Railway services, both from the same repo:

| Service | Root Directory | Build Command | Start Command |
|---|---|---|---|
| Web | `.` | `npm ci && npm run build` | `npm run start:web` |
| Worker | `.` | `npm ci && npm run build` | `npm run start:worker` |

`apps/web/next.config.mjs` uses `output: "standalone"`; the built standalone
server is started via `npm run start:web` (which runs `next start`). For
production it is recommended to set the Web service start command to
`node apps/web/.next/standalone/apps/web/server.js` after a workspace-aware
build, or keep `next start` for simplicity. Worker uses `tsx` to run
`apps/worker/src/index.ts`.

Environment variables to attach to **both** services:

- `DATABASE_URL`
- `NEON_AUTH_BASE_URL`
- `NEON_AUTH_COOKIE_SECRET`
- Worker overrides (`WORKER_ID`, `WORKER_POLL_INTERVAL_MS`, …) as needed.

Keep development and production configuration separate: `.env` is local only;
Railway variables are set in the dashboard; `.env.example` documents the keys.

## 7. Security rules applied in M1

- No API keys committed; `.env*` ignored; `.env.example` contains placeholders.
- Server credentials never reach the browser (server actions only).
- Ownership checks on every project read/action (`ownerId` equality).
- Destructive cleanup is not implemented in M1; when added (M8) it will be
  explicit, auditable, idempotent, and never touch user-owned resources.
- Generated-code execution (M5+) will be restricted to isolated sandboxes.

## 8. Future extension points

- `packages/agents` — provider abstraction allows new AI providers.
- `packages/integrations/src/sandbox` — replace Vercel Sandbox without touching
  the agent engine.
- `packages/integrations/src/adapters` — technology adapters for generated apps.
- `lifecycle_events` + `usage_logs` — audit and cost foundations for M6/M8.
*（内容由AI生成，仅供参考）*

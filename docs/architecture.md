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
- Vercel Web and Railway Worker using the existing Neon database.

M2 adds real OpenAI consultation through the persistent Worker; see
[M2 architecture and configuration](m2-consultation.md). Sandboxes, prototypes,
PRDs, coding, previews and exports remain future milestones.

## 2. Package manager

**npm workspaces** (npm >= 10). Reasons:

- No extra install step (npm ships with Node).
- Mature workspace support with `--workspaces` and `-w <pkg>` flags.
- Sufficient for a two-app, four-package monorepo without overengineering.

## 3. Monorepo structure and package boundaries

```text
apps/
  web/        Next.js app: Neon Auth routes, server actions, protected dashboard,
              project CRUD and consultation UI/actions. No paid AI execution.
  worker/     Node.js TS worker: safe job claiming, leases, recovery, dispatch.
              Depends on @asf/core + @asf/db.
packages/
  db/         Drizzle schema (all tables), drizzle config, migrate runner,
              createDb client (postgres-js). No business logic.
  core/       Pure TypeScript: workflow states, transitions, approval stages,
              events, job semantics (lease/backoff), unit-tested. No I/O.
  agents/     AIProvider/OpenAIProvider, Planner schema/prompt, pricing and
              transactional consultation operations shared by Web and Worker.
  integrations/ Reserved package for later sandbox/technology integrations.
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
- Users register at `/auth/sign-up` through the existing Neon Auth SDK's
  `signUp.email` method. The web UI supports sign-in, sign-out, verification
  links and verification codes; provider-issued sessions are preserved.
- Callback configuration: set the web app URL as an allowed callback origin
  in the Neon Console so the auth handler can issue session cookies.

No custom password system exists. Missing variables fail loudly at request time.

## 5. Worker and job queue

- Worker polls `workflow_jobs` for `status = 'queued' AND available_at <= now`.
- Claiming uses one atomic `UPDATE … RETURNING` with
  `FOR UPDATE SKIP LOCKED`, so two workers can never process the same job.
- Claimed jobs get `claimed_by`, `lease_expires_at`, `started_at`.
- On startup and periodically, `recoverStaleJobs` resets expired
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
- Database failures log a sanitized cause chain with driver/PostgreSQL codes
  and messages. SQL, parameters, stacks and PostgreSQL detail fields are omitted.
  Permanent errors stop the Worker immediately with exit code 1. Transient and
  unknown loop failures stop after five consecutive failures, waiting 5, 10, 20
  and 40 seconds between attempts (longer poll intervals are respected up to a
  60-second retry cap). A successful iteration resets this budget. Database
  failures during dispatch leave the job for lease recovery instead of consuming
  a job attempt. Railway's committed policy permits at most five process restarts;
  check the service dashboard for overrides.

### Timestamp binding regression

With the locked Drizzle 0.44.7 / postgres.js 3.4.9 versions, Drizzle replaces
postgres.js's timestamp serializers with pass-through functions. Raw `sql`
interpolation of a JavaScript `Date` bypasses Drizzle's column encoder, leaving
a Date in the driver's wire-protocol binding. This throws `ERR_INVALID_ARG_TYPE`
("Received an instance of Date") before PostgreSQL executes the statement.
Both recovery and claiming now use `sql.param(date, workflowJobs.<column>)`,
which encodes a timestamp as an ISO string while retaining parameter binding.
The `timestamptz` columns and `workflow_job_status` enum require no migration.

The Neon schema and enum were inspected in a read-only transaction. A read-only
`SELECT` reproduced the raw Date error and succeeded with the column encoder.
Production queue updates were not executed for verification.

Run the regular regression suite with `npm test`. To also exercise the complete
migration, recovery/claim behavior, rollback, and fatal Worker process exit, use
an **empty disposable local** PostgreSQL database named `asf_worker_test`:

```sh
WORKER_TEST_DATABASE_URL=postgres://user:password@127.0.0.1:5432/asf_worker_test npm test
```

The integration test rejects remote hosts and other database names, and rolls
back its DDL and test rows. It never reads `DATABASE_URL`. No new Worker
environment variables are required. Leave Railway offline until an operator
chooses to deploy and resume it; pushing a fix branch does not require deployment.

## 6. Deployment (Vercel Web, Railway Worker)

Vercel hosts the existing Next.js Web application. Railway runs the existing
Worker, using the root `railway.json` build/start commands and bounded restart
policy. Neon supplies the shared PostgreSQL database and Web authentication.

Set `DATABASE_URL` on both services. Neon Auth variables belong on Web;
`OPENAI_API_KEY` and model/pricing settings belong only on the Worker. Optional
private Blob credentials belong on Web. No deployment settings need to be changed
automatically for M2; see [the M2 manual setup](m2-consultation.md).

Keep local environment files ignored. Web development reads `apps/web/.env.local`;
Worker commands require exported variables or an explicit Node `--env-file`.
Railway deployment/resumption and merging require the user's approval.

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

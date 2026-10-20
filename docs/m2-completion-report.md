# M2 completion report

## 1. Architecture

Dedicated branch: `feat/m2-consultation`, based on latest main `cb43bad`.
Merged M1 Worker fix `fa72efb` is included and its regression suite passes.
Vercel Web handles authenticated requests and presentation, Railway Worker executes
all paid AI through the existing durable PostgreSQL queue, and Neon supplies
PostgreSQL/Auth. No new service, queue or replacement authentication system was added.
The existing agents package had no source implementation; M2 supplies its provider
abstraction, OpenAI provider, Planner and shared consultation operations there.

## 2. Files changed

- `.env.example`
- `README.md`
- `apps/web/app/actions/consultation.ts`
- `apps/web/app/actions/projects.ts`
- `apps/web/app/api/projects/[id]/assets/[assetId]/route.ts`
- `apps/web/app/api/projects/[id]/assets/route.ts`
- `apps/web/app/dashboard/projects/[id]/page.tsx`
- `apps/web/components/consultation-workspace.tsx`
- `apps/web/components/create-project-form.tsx`
- `apps/web/lib/reference-images.ts`
- `apps/web/next.config.mjs`
- `apps/web/package.json`
- `apps/web/test/consultation-workspace.test.tsx`
- `apps/web/test/reference-images.test.ts`
- `apps/web/test/reference-routes.test.ts`
- `apps/worker/package.json`
- `apps/worker/src/consultation.ts`
- `apps/worker/src/index.ts`
- `apps/worker/src/scripts/test-live-consultation.ts`
- `apps/worker/test/consultation.integration.test.ts`
- `docs/architecture.md`
- `docs/development-roadmap.md`
- `docs/m2-consultation.md`
- `docs/m2-live-test-result.json`
- `package-lock.json`
- `package.json`
- `packages/agents/package.json`
- `packages/agents/src/consultation.ts`
- `packages/agents/src/index.ts`
- `packages/agents/src/planner.ts`
- `packages/agents/src/pricing.ts`
- `packages/agents/src/provider.ts`
- `packages/agents/src/schema.ts`
- `packages/agents/test/fixtures.ts`
- `packages/agents/test/planner.test.ts`
- `packages/agents/tsconfig.json`
- `vitest.config.ts`

- `docs/m2-completion-report.md` — this report.

## 3. Implemented features

- Atomic project creation, initial saved idea, state-machine transition and AI job.
- Real official OpenAI SDK integration with strict structured output and local validation.
- Adaptive consultation prompt retaining history, corrections and requested technology.
- Project Details chat, queued/processing status, retry/error handling and saved history.
- Editable structured summary and explicit owner confirmation of the current revision.
- Completion advances only to `prototype_pending`; no M3 or later work is queued.
- Project-row serialization, request idempotency, stale-revision protection and ownership checks.
- Persisted agent attempts, reported input/output/cached tokens, duration and estimated USD.
- Prepaid budget reservations, conservative uncertain-outcome settlement and bounded retries.
- Periodic stale-lease recovery retaining the M1 timestamp encoders and database circuit breaker.
- Optional private image intake/proxy with authentication, ownership, type/size/count checks.

## 4. Database changes

No DDL/schema changes or new migrations. M2 uses the existing M1 tables and the
consultation key in `projects.current_state`. Tests applied the existing M1 DDL
only to disposable loopback PostgreSQL databases. No production writes or migrations
were performed. Full conversation and owner-confirmed summary are the future handoff.

## 5. Actual verification

| Check | Result |
| --- | --- |
| Clean install using repository-pinned npm 10.9.8 | Passed |
| Node runtime | 22.23.3 |
| `npm run typecheck` (including agents) | Passed |
| `npm run lint` | Passed, zero ESLint warnings |
| Full suite with both local PostgreSQL test URLs | **71 tests passed, zero skipped** |
| `npm run build:web` | Passed |
| `npm run build:worker` | Passed |
| Chrome UI preview, 1280px and 390px widths | Rendered with no page errors or horizontal overflow |
| `git diff --check` | Passed |
| Real OpenAI consultation through the persistent queue | Passed: 3 successful calls, validated summary and explicit completion to `prototype_pending` |

Coverage includes state transitions, response validation, persisted conversation,
ownership, concurrent duplicate delivery, failed API calls, input and budget limits,
actual Worker handlers, token/cost persistence, summary edits, explicit completion,
crashed-attempt recovery, private-route boundaries and M1 queue/exit regressions.
PostgreSQL integration tests use a real local PostgreSQL server. API behavior tests
use mocked HTTP through the official SDK; UI and Blob/session tests use explicit
mocks. The browser preview also uses mocked actions. None of those prove live API,
private storage or a production authenticated browser session succeeds. A separate
live OpenAI test has now passed; its persisted receipts were independently read back
from the local database, as detailed below.

## 6. Required environment

Worker: existing `DATABASE_URL`, real `OPENAI_API_KEY`, optional `OPENAI_MODEL`
(default `gpt-4.1-mini-2025-04-14`), input/output token limits and timeout. Unknown
models require all three verified per-million-token prices and a pricing source.
Default verified standard rates: input $0.40, cached input $0.10, output $1.60.
Web: existing database/Neon Auth settings. Optional reference uploads require
`BLOB_READ_WRITE_TOKEN` for a private store. OpenAI keys belong only on the Worker.
Full settings and commands are in [the M2 guide](m2-consultation.md).

## 7. Manual setup and deployment

1. Review this branch; approve merging separately. Main was not changed by this task.
2. Configure the real OpenAI key and model on the Railway Worker; verify pricing and
   provider-side spending limits. No database migration is needed for M2.
3. Configure the existing Web/Neon Auth origin and, optionally, a private Blob store.
4. The capped local live test has passed. Repeat only with an explicit budget if
   configuration or implementation changes. The ignored local key file was not committed.
5. Deploy/resume Railway only when explicitly approved. Keep its process-restart
   policy bounded (committed maximum five retries); stop it after manual testing.

No automatic deployment, merge, production data modification or M3 work occurred.

## 8. Known issues and verification limits

- Real OpenAI consultation passed after the key was supplied in an ignored local
  file. The opt-in live test still refuses non-loopback/non-test databases. For
  production, configure the key on the Railway Worker only; Web does not need it.
- Private Blob configuration was unavailable, so a real upload/download was not
  attempted. Its code and security boundaries are tested with mocks and the UI
  reports missing configuration.
- No fresh production Neon Auth browser login was performed; existing auth is
  preserved, ownership is exercised against PostgreSQL and route/session boundaries
  are tested. Build output includes the existing Neon Auth dynamic-cookie diagnostics;
  the build succeeds.
- An external paid request and a PostgreSQL commit cannot be atomic. Unconfirmed
  outcomes are marked uncertain, retain a conservative cost estimate and require
  explicit retry; no exact token counts are invented.
- History over the configured input bound stops before paid execution. M2 does not
  implement paid history compaction, vision analysis, prototypes or PRDs.

## 9. Actual live API usage and test cost

The live test completed on **2026-10-20 at 16:14 MYT** using
`gpt-4.1-mini-2025-04-14` through the real official SDK and persistent Worker
job handlers. It used only a disposable local PostgreSQL database and a
**$0.05 project budget**. It did not start or deploy Railway.

| Call | Input tokens | Output tokens | Cached tokens | API duration | Estimated USD |
| --- | ---: | ---: | ---: | ---: | ---: |
| Initial clarification | 642 | 102 | 0 | 3,870 ms | $0.000420 |
| Follow-up clarification | 893 | 130 | 0 | 3,240 ms | $0.000566 |
| Requirements summary | 1,046 | 326 | 0 | 2,901 ms | $0.000940 |
| **Total** | **2,581** | **558** | **0** | **10,011 ms** | **$0.001926** |

Total reported tokens: **3,139**. Costs use the configured verified standard
rates and upward microdollar rounding per run; they are estimates, not a final
OpenAI billing invoice. No mocked tokens are included in these totals.

Read-back verification confirmed six saved messages, three succeeded jobs,
three succeeded agent runs and three usage records. The real summary contained
the library's target users, goals, required/optional features, authentication,
data, UI, preferred technology, intended usage and assumptions, with no open
questions. Explicit test-owner confirmation advanced the project to
`prototype_pending`; all jobs remained `consultation_turn`, with no prototype
or later milestone generated. Receipts are summarized in
[`m2-live-test-result.json`](m2-live-test-result.json). The temporary test server
was stopped after verification.

## 10. M3 readiness

The persistence contract and reviewed-summary handoff are implemented and tested:
`projects.current_state.consultation.summary`, completion timestamp/revision,
conversation, job/run/usage records and lifecycle audit. M3 implementation has not
started. The real OpenAI consultation and summary handoff are now verified.
Production deployment and a fresh authenticated browser smoke test remain manual.
Await user approval before merging or starting M3.

# M2: AI Consultation Engine

## Architecture and scope

Vercel serves the existing Next.js Web app; Railway runs the existing persistent
Worker; Neon provides PostgreSQL and authentication. `feat/m2-consultation` starts
from latest main (`cb43bad`), including the merged timestamp-binding/circuit-breaker
fix (`fa72efb`). The existing `@asf/agents` package had only a manifest, despite M1
documentation describing a provider stub. M2 implements `AIProvider` and
`OpenAIProvider` there rather than adding another service or queue.

Project creation saves the idea, enters `consultation` through the state machine,
and queues a `consultation_turn` in one transaction. Authenticated Web actions
save answers and corrections; they never execute AI. The Worker sends full history
and the latest summary to the Planner using the official OpenAI SDK Responses API
with a strict Zod-derived JSON schema. It validates the result locally before
persisting assistant messages and requirements. No fake AI fallback exists.

The prompt asks focused, adaptive questions, accepts corrections, avoids redundant
or unnecessary technical questions, and separates requested technologies from
current MVP support. Arbitrary ideas, including Python desktop apps, remain valid.
The UI displays questions, history, job state, errors/retry, cost estimates, editable
requirements and explicit completion. Only a ready summary without unanswered
questions may enter `prototype_pending`, and only after its owner confirms the
current revision. Completion creates no prototype/PRD/coding/deployment job.

## Persistence, concurrency and recovery

No schema changes or migrations are required. Existing tables hold:

| Table                                 | M2 records                                                                               |
| ------------------------------------- | ---------------------------------------------------------------------------------------- |
| `projects.current_state.consultation` | revision, current job, status, requirements summary, completion confirmation             |
| `consultation_messages`               | initial idea, user answers/corrections and validated assistant messages                  |
| `workflow_jobs`                       | persistent consultation turns, backoff and bounded attempts                              |
| `agent_runs`                          | every execution attempt, model/pricing snapshot, reservation, usage/result or safe error |
| `usage_logs`                          | estimated USD and actual reported input/output/cached tokens and duration in metadata    |
| `project_assets`                      | private reference pathname, original safe filename, MIME type and project ownership      |
| `lifecycle_events`                    | state changes, response/failure/retry and owner confirmation                             |

All consultation mutations serialize on the project row. Ownership checks run on
both reads and writes, including private asset access. An owner-supplied request
UUID is checked under this lock, making duplicate delivery idempotent. A revision
check prevents stale tabs from appending an answer or confirming an old summary.
Only one active turn per project is allowed. User messages and jobs commit together,
so an API failure cannot erase an answer. Message timestamps use `clock_timestamp()`
so inserts inside the same transaction retain their conversational order.

Before a paid call the Worker commits an agent run and conservative budget
reservation under the project lock, then releases the lock during network I/O.
The successful response, token/cost record, assistant message, summary and job
completion commit atomically. Reclaimed or completed jobs cannot execute the same
paid attempt again. A restart during an in-flight paid request leaves an uncertain
outcome: recovery settles the reservation as an estimated upper bound, records no
invented tokens and requires an explicit user retry. A remote HTTP call and a
Postgres transaction cannot offer exactly-once billing across a process crash.

Worker stale-lease recovery now also runs periodically (half the lease duration,
minimum 30 seconds) while preserving the startup option and timestamp encoders.
The database circuit breaker still stops permanent database failures immediately
and bounds transient/unknown loop failures. SDK internal retries are disabled.
Confirmed rate limits retry at most three job attempts, with the existing
exponential backoff (30 and 60 seconds). Authentication/configuration errors,
invalid/refused/incomplete responses and uncertain timeouts do not auto-repeat
paid calls. Infrastructure database failures reach the existing circuit breaker.

## Pricing and budgets

Default model: `gpt-4.1-mini-2025-04-14`. Standard text prices were verified on
2026-10-20: $0.40 input, $0.10 cached input and $1.60 output per million tokens.
Source: [official model pricing](https://developers.openai.com/api/docs/models/gpt-4.1-mini).
Structured output follows the [official guide](https://developers.openai.com/api/docs/guides/structured-outputs).

Cost is always an **estimate**, computed from API-reported tokens and the saved
pricing snapshot, rounded upward to a microdollar. It is not a billing invoice.
Unconfirmed API outcomes retain the reserved upper bound and explicitly mark
actual token usage unknown. A project's existing USD usage, outstanding reservations
and the proposed request must fit its `budget_limit_cents` before any paid request.
Input reservations use the complete payload's UTF-8 byte count plus 4,096 tokens
of protocol headroom as a conservative bound; output is capped at configuration.
The input bound defaults to 32,000, and oversized histories fail without an API call.
There is no automatic paid history compaction in M2.

Changing to an unrecognized model fails closed until the operator supplies all
three rates and a verification source. Operators must verify rates for their model
and service tier; the defaults use standard synchronous text pricing, not batch,
priority or other paid tools. M2 enables no model tools or vision requests.

## Environment and manual configuration

| Variable                                        | Where            | Default / requirement                                      |
| ----------------------------------------------- | ---------------- | ---------------------------------------------------------- |
| `DATABASE_URL`                                  | Vercel + Worker  | existing Neon database                                     |
| `NEON_AUTH_BASE_URL`, `NEON_AUTH_COOKIE_SECRET` | Vercel           | existing Neon Auth, correct allowed Vercel origin          |
| `OPENAI_API_KEY`                                | Worker only      | real project-scoped API key; never public or committed     |
| `OPENAI_MODEL`                                  | Worker           | `gpt-4.1-mini-2025-04-14`                                  |
| `OPENAI_MAX_INPUT_TOKENS`                       | Worker           | conservative bound limit, `32000`                          |
| `OPENAI_MAX_OUTPUT_TOKENS`                      | Worker           | `2500` (maximum `16000`)                                   |
| `OPENAI_TIMEOUT_MS`                             | Worker           | `45000`; timeout plus 30 seconds must fit inside the lease |
| `OPENAI_INPUT_USD_PER_MILLION`                  | Worker           | optional override, all rates must be supplied together     |
| `OPENAI_CACHED_INPUT_USD_PER_MILLION`           | Worker           | optional override                                          |
| `OPENAI_OUTPUT_USD_PER_MILLION`                 | Worker           | optional override                                          |
| `OPENAI_PRICING_SOURCE`                         | Worker           | required with overrides; source/date of verified pricing   |
| `BLOB_READ_WRITE_TOKEN`                         | Vercel, optional | token for a **private** Vercel Blob store                  |

Existing Worker configuration remains supported. Default lease: 120 seconds.
Set a provider-side project spending limit as an additional account control.
The repository Railway restart policy is bounded to five process restarts; check
for dashboard overrides. No Railway deployment or automatic merge is part of M2.

For local Web development, configure `apps/web/.env.local`. `tsx` does not load
root `.env` implicitly: export Worker environment variables or run Node 22 with
`--env-file=.env --import tsx apps/worker/src/index.ts`. Never point a test script
at production. Web and Worker can share the existing M1 schema; no production
migration or data initialization is needed for this feature.

## Optional private reference intake

Connect a private Blob store to Vercel and supply its read/write token. The server
uploads with `access: 'private'`, saves a project-scoped random pathname and serves
images through an authenticated ownership-checked proxy with `private, no-store`
and `nosniff` headers. Neither credentials nor private storage URLs reach clients.
PNG, JPEG and WebP declared MIME types must match signatures. Streamed uploads
are bounded to 4 MiB plus multipart overhead; each project has a 20-image limit.
SVG and other active formats are rejected. Metadata failure triggers cleanup of
only the newly uploaded blob. Images are intake for later prototype guidance;
M2 does not analyze images or generate prototypes. Users can describe design
cues in chat. When configuration is absent the UI says uploads are unavailable.

## Verification commands

```sh
npm ci
npm run typecheck
npm run lint
npm test
npm run build:web
npm run build:worker
```

The regular suite includes mocked SDK transport and UI/session/storage boundaries;
these are not evidence of successful live OpenAI or Blob access. Set explicit
loopback URLs to include real PostgreSQL integration suites. They reject remote
hosts and unexpected database names and never use `DATABASE_URL`:

```sh
CONSULTATION_TEST_DATABASE_URL=postgres://user:pass@127.0.0.1:5432/asf_m2_test \
WORKER_TEST_DATABASE_URL=postgres://user:pass@127.0.0.1:5432/asf_worker_test npm test
```

Create empty disposable databases first. M2 tests apply the existing M1 DDL in the
local M2 database only and leave uniquely named test projects there for inspection.
The original queue regression suite rolls its local DDL/data back. Never deploy
or run a production Worker against these databases.

A separate opt-in live test exercises the real persistent queue, official SDK,
conversation, summary, confirmation and real usage recording, using only an
empty disposable local database. It makes at most three calls and sets the test
project budget to **$0.05** before the first call:

```sh
CONSULTATION_LIVE_DATABASE_URL=postgres://user:pass@127.0.0.1:5432/asf_m2_live_test \
node --env-file=.env --import tsx apps/worker/src/scripts/test-live-consultation.ts
```

It rejects absent keys and remote/non-test databases. It never starts Railway.
Do not rerun paid tests blindly after an uncertain result; inspect the local
project and usage first. Stop the local test database after verification.

## M3 handoff

The owner-confirmed, schema-validated requirements remain in
`projects.current_state.consultation.summary`, with the full conversation, audit
history and confirmation revision. M3 can read this as prototype input; M4 can
later use it for PRD generation. Neither milestone is implemented or started here.

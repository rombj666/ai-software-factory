# M3 — AI Prototype Engine

Implemented on `feat/m3-prototype`, starting from main commit `36df42c`.
M3 ends at `prototype_approved`. It does not generate PRDs, development plans,
functional code, QA runs, previews or later jobs. No deployment is performed.

## Architecture and persistence

The Web app remains a lightweight authenticated UI/action layer. The persistent
Railway Worker performs all paid planning/image requests and Blob writes.
Existing project locks, job leases, circuit breaker, budget ledger and state
machine remain in place. The text provider accepts a selectable response schema;
its existing M2 schema, model, output limit and behavior remain the defaults.

No schema change or migration is required. All records use existing M1 tables:

| Existing location | M3 use |
| --- | --- |
| `projects.current_state.consultation` | Completed, owner-reviewed requirements and revision |
| `projects.current_state.prototype` | Current design, revision, acceptance, active job, screen approvals, final artifact ID |
| `workflow_jobs` | Durable `prototype_task`, request identity/hash, selected screen/settings, one attempt |
| `agent_runs` | Shared project reservation; durable reserved/dispatched phase; pricing/model snapshot |
| `prototype_versions` | Immutable private image path, project-wide version, prompt, status, creation time |
| `artifacts` / `prototype_design` | Design specifications and accepted-plan snapshots |
| `artifacts` / `prototype_image` | Screen/version, plan snapshot, requirement traceability, feedback, base/reference IDs, model/settings/cost |
| `artifacts` / `prototype_handoff` | Approved screen IDs/versions, layouts, controls, navigation, interactions, tokens, requirements, approval metadata |
| `approvals` | Owner decisions on individual screens and final plan version |
| `project_assets` | Existing uploaded reference images; uploads extended to `prototype_pending` |
| `usage_logs` | Reported token usage and estimated USD, or clearly labeled retained reservation |
| `cleanup_jobs` | Deterministic generated-image orphan cleanup, bounded attempts |
| `lifecycle_events` | Generation/failure and final state-machine transition |

All database verification used disposable localhost databases. Production Neon
and Neon Auth schemas were not modified. There is no production migration step.

## User flow

1. Finish M2 consultation with reviewed requirements and no open questions.
2. Open Project Details → Prototype Workspace. Planning does not start automatically.
3. Request a planning estimate, review the reservation/model, then confirm it.
4. Worker calls the existing OpenAI text model using a strict design schema.
5. Review product-specific screens, direction, colors, typography, layout,
   navigation, controls, interactions, responsive expectations and limitations.
   Edit names/purposes/layouts, add/remove screens, or edit the full structured
   specification. Requirement references must match approved functionality,
   goals, authentication or data requirements exactly.
6. Accept the design plan. Select one screen and low/medium/high quality with
   landscape, portrait or square resolution. Desktop/portrait and
   mobile/landscape mismatches are rejected.
7. Review the estimate and explicitly confirm one paid image request.
8. Worker calls the official Images API (`images.generate`, one PNG), fully
   decodes and validates the returned image, writes Private Blob, and commits
   metadata/version/usage atomically. UI polls durable saved status.
9. Revisions use `images.edit` with the selected version as the first image and
   optionally an uploaded reference as the second. Regenerate starts a new
   image from the current specification. Both need a fresh paid confirmation.
10. Browse previous versions and open authenticated full-size previews. New
    versions invalidate that screen's approval. Design changes invalidate all
    approvals and require new images for the changed plan revision.
11. Approve the latest version of each screen. Final approval requires every
    current screen and the accepted plan, records the owner/version decisions,
    saves the structured handoff and uses `WorkflowStateMachine` to transition
    to `prototype_approved`. No subsequent milestone is enqueued.

The owner can retrieve the approved handoff through
`GET /api/projects/:id/prototype-handoff` or the shared
`readPrototypeHandoff` function. Image references use
`/api/projects/:id/prototypes/:versionId`; private Blob locations are excluded
from Web DTOs and the handoff.

## Image API and pricing

Default image model: `gpt-image-2.5-flare` (the verified dated snapshot is also
accepted). No silent model substitution. The installed official OpenAI SDK
supports this model and generation/editing parameters.

Official rates verified 2026-10-21, standard processing, USD per million tokens:

| Token category | Rate |
| --- | ---: |
| Text input | $5 |
| Image input | $8 |
| Image output | $30 |

Sources: [Flare model](https://developers.openai.com/api/docs/models/gpt-image-2.5-flare),
[official pricing](https://developers.openai.com/api/docs/pricing),
[image guide/calculator](https://developers.openai.com/api/docs/guides/image-generation).
Direct Images API calls do not assume cached-input discounts.

The output estimator follows the official calculator's formula for explicit
size/quality. Each request reserves twice that output estimate plus 1,024
output tokens of headroom, plus prompt UTF-8 byte length and 4,096 input tokens
of headroom. This is a conservative application estimate, not a provider-side
hard spending cap or a fabricated exact charge. Auto quality/size, multiple
images, streaming and partial images are not enabled.

Editing requires separate evidence for a conservative per-input-image token
bound. The official material consulted establishes rates and output estimates,
but does not establish a reliable Flare edit-input ceiling for all accepted
image sizes. Therefore **edits fail closed until both
`OPENAI_IMAGE_EDIT_INPUT_TOKEN_BOUND` and `OPENAI_IMAGE_EDIT_BOUND_SOURCE` are
configured**. Do not borrow GPT Image 1 or text-vision token rules or copy the
integration tests' synthetic bound. The operator must verify a bound covering
all accepted inputs (12 MiB, up to 8,294,400 pixels). Without reliable evidence,
leave editing disabled. Generations and regenerations do not need this bound.

Quotes bind request settings, revision, model and pricing into a fingerprint.
Enqueue validates confirmation and the current quote under the owner/project
lock, reserves cost immediately in `agent_runs`, and checks total recorded plus
reserved cost against the existing project budget. Web and Worker must use the
same pricing configuration. The Worker rechecks its configuration against the
approved reservation before dispatch. Snapshots persist rates, sources, input
bound provenance and the estimator's margin.

Reported text/image/output tokens determine estimated cost where available.
Missing or invalid usage retains the confirmed reservation; no token counts are
invented. Unexpected provider overruns are recorded rather than hidden, and
reduce the remaining budget for future requests. The UI labels estimates.

## Reliability and security

- Every read/write requires the authenticated project owner. Private images
  use authenticated server endpoints with `private, no-store`, `Vary: Cookie`
  and `nosniff`; no public Blob URL redirect or client token exposure.
- Design data is strict/bounded (1–12 screens, 24 KB), with unique IDs and valid
  navigation. Up to 120 successful image versions per project and 20 uploaded
  references. Reference upload retains same-origin and streamed size checks.
- Generated and edit-input images are fully decoded with `sharp`; invalid,
  truncated, animated or oversized payloads fail validation. Generated images
  must match the requested dimensions. Bytes are normalized to metadata-free PNG.
- Actual image bytes stay in Private Blob. Generated paths are deterministic
  per job and never overwrite earlier versions.
- Paid API SDK retries are disabled. Jobs have one attempt. Image API timeout
  defaults to 60 seconds; it plus 30 seconds must fit the Worker lease. Blob
  operations have 15-second abort signals and streamed download size limits.
- Project locks and revision guards serialize competing Web/Worker mutations.
  Stable request IDs deduplicate duplicate submissions and reject reused IDs
  with changed content. Approval is tied to exact current screen/plan versions.
- A durable dispatch marker commits before each paid API call. Recovery may
  execute a reservation interrupted before dispatch, but never replays a
  dispatched attempt. Unknown outcomes retain the cost conservatively, fail
  the job, and require an explicit new request after usage review.
- Usage, image version, artifact and job completion commit together. Database
  failures escape to the existing circuit breaker and retain reservations.
- Before upload, the Worker creates a delayed cleanup record. Failed or crashed
  uploads remain tracked even if the final database transaction never commits.
  The sweeper only handles `prototype_orphan` paths, shares the project's
  finalization lock, skips active runs, and preserves any linked version.
  Deletes are repeatable with at most three attempts. Failed cleanup records
  remain auditable for operator review; never delete all project Blob paths.

## Configuration and manual deployment

No new API key is required. Keep all keys and tokens server-side.

| Variable | Services | Purpose |
| --- | --- | --- |
| `OPENAI_API_KEY` | Worker | Existing OpenAI key |
| `OPENAI_MODEL` | Web + Worker | Existing text planning model; M2 default unchanged |
| `OPENAI_PROTOTYPE_IMAGE_MODEL` | Web + Worker | `gpt-image-2.5-flare` |
| `OPENAI_PROTOTYPE_IMAGE_TIMEOUT_MS` | Worker | Default `60000` |
| `OPENAI_PROTOTYPE_PLAN_MAX_OUTPUT_TOKENS` | Web + Worker | Default `6000`; separate from M2 |
| `BLOB_READ_WRITE_TOKEN` | Web + Worker | Same **Private Blob store** on both |
| `OPENAI_IMAGE_EDIT_INPUT_TOKEN_BOUND` | Web + Worker | Verified per-image edit input ceiling; absent means editing blocked |
| `OPENAI_IMAGE_EDIT_BOUND_SOURCE` | Web + Worker | Evidence for that bound |
| `OPENAI_IMAGE_*_USD_PER_MILLION`, `OPENAI_IMAGE_PRICING_SOURCE` | Web + Worker | Optional complete rate/source override, see `.env.example` |

Existing database, Neon Auth, text pricing and timeout configuration remain.
The default Worker lease is 120 seconds. If increasing API timeouts, adjust the
lease and maintain the validation margin.

After review/merge, manually deploy Web to Vercel and Worker to Railway. Confirm
both use the same Private Blob store, model access and any required OpenAI
organization verification. Neon needs no schema changes or managed-auth edits.
No automatic merge or deployment was performed for this branch.

## Verification

Automated commands: `npm run typecheck`, `npm run lint`, `npm test`,
`npm run build:web`, `npm run build:worker`.

Database tests opt in only to these disposable localhost databases:

```sh
PROTOTYPE_TEST_DATABASE_URL=postgresql://USER@127.0.0.1:PORT/asf_m3_test \
CONSULTATION_TEST_DATABASE_URL=postgresql://USER@127.0.0.1:PORT/asf_m2_test \
WORKER_TEST_DATABASE_URL=postgresql://USER@127.0.0.1:PORT/asf_worker_test \
npm test
```

M3 tests cover completed-summary loading, structured planning, editing and
acceptance, requirement traceability, generation/edit SDK requests, image
validation, private storage/route boundaries, cross-user denial, history,
screen/final approval, state-machine transition, duplicate requests, concurrent
Workers, stale revisions/quotes, budget reservations, usage and missing usage,
access rejection, transport uncertainty, pre/post-dispatch crash recovery and
orphan cleanup. OpenAI/Blob calls and Web sessions/actions are mocked. Database
integration uses real PostgreSQL and the existing versioned migration, applied
only to disposable databases. Existing M1 and M2 tests are included.

The web production build emits the same Neon SDK static-render diagnostics as
before; protected/auth pages are dynamic and the build succeeds.

### Controlled live image test

**Not run.** The local configuration has an OpenAI key but no
`BLOB_READ_WRITE_TOKEN`; full private storage/retrieval prerequisites are absent.
Model access has not been probed. No paid generation was attempted and no
provider/image usage was fabricated. Recorded in
[`m3-live-image-result.json`](m3-live-image-result.json).

The authorized live-test ceiling is $0.15, one low-quality Flare UI image, no
production customer data, disposable database, identifiable test Blob path and
safe cleanup. Before attempting it, supply the missing private-store token,
verify the conservative quoted reservation fits $0.15, use only synthetic
requirements, and retain the first request's receipt. Do not retry access or
verification failures, uncertain outcomes, or rerun the paid test without new
approval. Record actual model, dimensions, quality, reported usage, estimated
cost and both Blob retrieval and authenticated HTTP image retrieval separately.

## Limitations and M4 readiness

The code supports real provider/storage integrations, but successful live Flare
execution, real Blob persistence and production authenticated retrieval remain
unverified. Editing is intentionally gated on verified input-bound evidence.
There is no interactive executable prototype: images are static references.
Image legibility and design fidelity require human review. The UI exposes
low/medium/high quality and three common resolutions, not every model option.

M4 can consume the approved structured handoff without reverse-engineering
pixels. Handoff and approval contracts are implemented/tested; live-service
acceptance remains pending. M4 itself has not been started.

## Changed files

| Area | Files |
| --- | --- |
| Domain and integrations | `packages/agents/src/prototype.ts`, `prototype-schema.ts`, `prototype-pricing.ts`, `prototype-provider.ts`, `prototype-storage.ts` |
| Existing text provider | `packages/agents/src/provider.ts` |
| Worker | `apps/worker/src/prototype.ts`, `apps/worker/src/index.ts` |
| Web actions and UI | `apps/web/app/actions/prototype.ts`, `apps/web/components/prototype-workspace.tsx`, `apps/web/app/dashboard/projects/[id]/page.tsx` |
| Private routes | `apps/web/app/api/projects/[id]/prototypes/[versionId]/route.ts`, `apps/web/app/api/projects/[id]/prototype-handoff/route.ts`, existing `apps/web/app/api/projects/[id]/assets/route.ts` |
| Tests | `packages/agents/test/prototype.test.ts`, `prototype-storage.test.ts`, `prototype-fixtures.ts`; `apps/worker/test/prototype.integration.test.ts`; `apps/web/test/prototype-workspace.test.tsx`, `prototype-routes.test.ts` |
| Dependencies/config | `packages/agents/package.json`, `package-lock.json`, `.env.example` |
| Documentation | `README.md`, `docs/development-roadmap.md`, `docs/m3-prototype.md`, `docs/m3-live-image-result.json` |

The verification run passed all five required commands. The full opted-in test
suite passed **128 tests across 16 files, with no skips**, including the existing
M1 Worker circuit-breaker and M2 database integration suites. No real OpenAI or
Blob calls occurred in these tests. Temporary PostgreSQL resources were stopped
after verification.

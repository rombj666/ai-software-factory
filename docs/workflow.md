---
AIGC:
    Label: "1"
    ContentProducer: 001191440300708461136T1XGW3
    ProduceID: e821b9ee54e031e8318c478725a8d21c_6899361bc98111f18b7f525400393706
    ReservedCode1: 52XeB/BwyvdbBeXSZHAodVtVvENrCOgP6hSJzYCDsf+wEkjzUG2TyEApE1wTTa9tKGWND9+Ub4NRSPikpl9I3V99IS5v4VOdvsNDqFmrs7m94sFRqc27EhnB0do5Wgeww6D5IxQATaqD+yOTmO5IcSGTRyq22vHIu8Tuo4P16kooxl1A/hmrOroZWtk=
    ContentPropagator: 001191440300708461136T1XGW3
    PropagateID: e821b9ee54e031e8318c478725a8d21c_6899361bc98111f18b7f525400393706
    ReservedCode2: 52XeB/BwyvdbBeXSZHAodVtVvENrCOgP6hSJzYCDsf+wEkjzUG2TyEApE1wTTa9tKGWND9+Ub4NRSPikpl9I3V99IS5v4VOdvsNDqFmrs7m94sFRqc27EhnB0do5Wgeww6D5IxQATaqD+yOTmO5IcSGTRyq22vHIu8Tuo4P16kooxl1A/hmrOroZWtk=
---

# Workflow

All project workflows and background jobs are **persisted in Neon**. There is
no in-memory state. The state machine lives in `packages/core` (pure, tested),
the job queue lives in `apps/worker`.

## Project state machine

Typed states (`ProjectStatus`):

```
idea_submitted → consultation → prototyping → prototype_review → prd_review
→ planning → plan_review → development → qa → delivered
```

Plus control states: `paused`, `stopped`, `cancelled`.

Valid transitions (enforced by `WorkflowStateMachine.transition`):

| From | To | Condition / event |
|---|---|---|
| `idea_submitted` | `consultation` | project initialization (internal M1 job) |
| `consultation` | `prototyping` | consultation completed (M2) |
| `prototyping` | `prototype_review` | prototype version generated (M3) |
| `prototype_review` | `prd_review` | prototype approved (M3) |
| `prototype_review` | `prototyping` | changes requested / regenerate (M3) |
| `prd_review` | `planning` | PRD approved (M4) |
| `prd_review` | `consultation` | PRD rejected → reconsult (M4) |
| `planning` | `plan_review` | development plan created (M4) |
| `plan_review` | `development` | plan approved (M4) |
| `plan_review` | `planning` | plan changes requested (M4) |
| `development` | `qa` | code complete (M5) |
| `qa` | `delivered` | QA passed (M6) |
| `qa` | `development` | auto-fix retry (M6, bounded by `retry_count`/`max_retries`) |
| any active | `paused` | budget exhausted / user pause (M6+) |
| `paused` | previous active | resume |
| any active | `stopped` | user stop |
| `stopped` / `paused` | `cancelled` | cancel |
| `stopped` / `paused` / any | `consultation` | restart with new requirements (future) |

Transitions that fail validation return `{ ok: false, error }`; invalid
transitions never mutate the database.

## Approval stages

Approvals are typed (`ApprovalType`): `prototype`, `prd`, `plan`. Decisions:
`approved | changes_requested | rejected`. Each decision is recorded in the
`approvals` table with actor, type, stage, decision and comment; it also
appends a `lifecycle_events` row. Approval gates block automatic progress:
the workflow cannot advance past a gate until the matching approval exists.

## Events

Every state change and job outcome appends to `lifecycle_events`
(`project_id`, `event_type`, `payload`, `created_at`). This gives an
auditable timeline per project and feeds the future dashboard.

## Jobs and the queue

`workflow_jobs` drives background work:

| Column | Meaning |
|---|---|
| `type` | job type (M1: `project_initialization`) |
| `payload` | JSON arguments |
| `status` | `queued / claimed / running / succeeded / failed / cancelled` |
| `attempts` | processing attempts |
| `max_attempts` | retry budget (default 3) |
| `available_at` | earliest claim time (backoff gate) |
| `claimed_by` | worker identity holding the lease |
| `lease_expires_at` | lease deadline; stale leases are recovered |
| `result` / `error` | outcome payloads |
| `process_key` | unique idempotency key hook (future) |

### Claiming (safe ownership)

```text
UPDATE workflow_jobs
SET status = 'claimed', claimed_by = :worker, lease_expires_at = :lease, started_at = now()
WHERE id = (
  SELECT id FROM workflow_jobs
  WHERE status = 'queued' AND available_at <= now()
  ORDER BY created_at ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED
)
RETURNING id, payload, attempts
```

One atomic statement: concurrent workers cannot claim the same job.

### Lease and recovery

- A claimed job has a lease (`lease_expires_at = now() + lease_seconds`).
- `recoverStaleJobs()` resets any `claimed/running` job whose lease expired
  back to `queued` (crash recovery on Worker restart).
- The Worker runs recovery at startup and once per poll loop.

### Stop, failure, retry

- **Stop**: user-level stop is a project transition to `stopped`; queued jobs
  for a stopped project are not newly enqueued (M1 defines states; M2+ wires
  the user actions).
- **Failure**: `failJob` increments `attempts`; if `attempts < max_attempts`
  the job is requeued with exponential backoff (`available_at` grows by
  `2^(attempts-1)` base interval); otherwise it becomes `failed` with `error`.
- **Retry**: manual re-queue can set `status='queued'`, reset attempts, and
  clear the error.

## Internal pipeline verification (M1)

To prove the database → worker path without an AI agent:

```bash
npm run worker:seed:internal-job   # with DATABASE_URL set
npm run dev:worker                 # or npm run start:worker
```

The seed creates a project `Internal M1 Pipeline Verification` at
`idea_submitted` and queues a `project_initialization` job. The Worker claims
the job, transitions the project to `consultation` through the typed state
machine, writes the result, and appends lifecycle events. This is a real
internal job — **not** an AI agent execution and never reported as one.
*（内容由AI生成，仅供参考）*

---
AIGC:
    Label: "1"
    ContentProducer: 001191440300708461136T1XGW3
    ProduceID: e821b9ee54e031e8318c478725a8d21c_652731acc98111f18b7f525400393706
    ReservedCode1: Z1El7APWEkfXI7+TEZ2B0EBMeDSr6Mh22rtQpC3s753MgJtfNnGmPc7rDhTOJBzl49tLNekXT1B7N333vie9a1Kluhq9LH1gUh2+LUuj/qMj0X4IBK3tUvpMzjqkJo0jbtpHlfHu2LuxIV7DuYZSpOZlStVdpQOpjhwanWQ0zFoYtuK+OXpDjzOQEOg=
    ContentPropagator: 001191440300708461136T1XGW3
    PropagateID: e821b9ee54e031e8318c478725a8d21c_652731acc98111f18b7f525400393706
    ReservedCode2: Z1El7APWEkfXI7+TEZ2B0EBMeDSr6Mh22rtQpC3s753MgJtfNnGmPc7rDhTOJBzl49tLNekXT1B7N333vie9a1Kluhq9LH1gUh2+LUuj/qMj0X4IBK3tUvpMzjqkJo0jbtpHlfHu2LuxIV7DuYZSpOZlStVdpQOpjhwanWQ0zFoYtuK+OXpDjzOQEOg=
---

# Database

Neon PostgreSQL accessed through **Drizzle ORM** (`packages/db`). All DDL is
version-controlled in `packages/db/drizzle` (generated SQL migrations) and can
be applied offline or against a live Neon database.

## Tables

| Table | Purpose |
|---|---|
| `projects` | User projects: idea, title, owner, status, budget (default $20.00), retry counters |
| `tasks` | Development tasks from the approved plan (M4+) |
| `agent_runs` | One row per agent execution attempt (Planner/Developer/QA) with status, inputs, outputs |
| `artifacts` | Persisted artifacts: PRDs, plans, QA reports, code bundles (M4+) |
| `approvals` | Approval gate records (prototype, PRD, plan) with decision and actor |
| `usage_logs` | AI/token/infrastructure cost ledger per project (M2+/M6) |
| `workflow_jobs` | Background job queue: type, payload, status, attempts, lease, result/error |
| `previews` | Temporary preview deployments (M7): URL, expires_at, cleanup status |
| `exports` | Code exports: ZIP/GitHub, retention/expiry timestamps (M7) |
| `consultation_messages` | AI consultation conversation history (M2) |
| `prototype_versions` | Generated prototype versions + review state (M3) |
| `project_assets` | Reference images / uploads (M2/M3) |
| `lifecycle_events` | Append-only workflow events for auditability |
| `cleanup_jobs` | Retention/cleanup records for temporary resources (M8) |

Authentication user/session data lives in the **Neon Auth**-managed schema
(Better Auth standard tables). The application does not duplicate or modify
that schema; `projects.owner_id` references Neon Auth user ids as opaque text.

## Relationships

```text
projects 1─* tasks
projects 1─* agent_runs
projects 1─* artifacts
projects 1─* approvals
projects 1─* usage_logs
projects 1─* workflow_jobs        (nullable project_id)
projects 1─* consultation_messages
projects 1─* prototype_versions
projects 1─* project_assets
projects 1─* lifecycle_events
projects 1─* previews
projects 1─* exports
previews 1─* cleanup_jobs
```

## Key columns and constraints

- `projects.owner_id text not null` — authorization boundary; every project
  read/write in M1 filters by it.
- `projects.status` — enum over `ProjectStatus` (see `packages/core`).
- `projects.budget_cents` — default 2000 ($20.00); M1 foundation for cost control.
- `projects.retry_count` / `max_retries` — per-project fix-cycle budget (M6).
- `workflow_jobs.status` — enum over `JobStatus` (`queued | claimed | running |
  succeeded | failed | cancelled`).
- `workflow_jobs.available_at` — earliest allowed claim time (backoff gate).
- `workflow_jobs.lease_expires_at` — claim lease for crash recovery.
- Unique index on `workflow_jobs.process_key` when set (idempotency hook).
- Indexes: ownership lookups, job queue polls, event ordering, approval actor
  and decision lookups.

## Migration workflow

```bash
# Edit packages/db/src/schema.ts, then:
npm run db:generate        # creates SQL in packages/db/drizzle (offline, no DB needed)
npm run db:migrate         # applies pending migrations to DATABASE_URL
```

Migration files are plain SQL under `packages/db/drizzle`. The migration
runner tracks applied versions in a `drizzle.__drizzle_migrations` table and
applies only pending files. This makes CI/deploy migrations deterministic.

## Neon Auth data

Configure Neon Auth in the Neon Console. The SDK expects:

- `NEON_AUTH_BASE_URL`
- `NEON_AUTH_COOKIE_SECRET`
- Allowed callback/origin URLs for the Web app.

Users are created in the Neon Console or via Neon Auth sign-up endpoints.
`projects.owner_id` stores `session.user.id` returned by Neon Auth.
*（内容由AI生成，仅供参考）*

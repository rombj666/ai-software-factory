---
AIGC:
    Label: "1"
    ContentProducer: 001191440300708461136T1XGW3
    ProduceID: e821b9ee54e031e8318c478725a8d21c_6c86d2cac98111f196f9525400248c00
    ReservedCode1: o5pkcYsEw8kb58O7KNlxkN6aQcIdksw4GCtjlj42fku9WVoO5zx2TTw0NzRxn4D6B/7BMnAPDdo9JHQpncC3Oa/SBeM/K5BGLqRx5c7sZwyrYpX/T+Tlh4OeSEAb3doMqggjOnNqTM7CMqW4O5IHXRoEwkRHXQFGCopHRd3lYkmEjknhRNolL2/eeGM=
    ContentPropagator: 001191440300708461136T1XGW3
    PropagateID: e821b9ee54e031e8318c478725a8d21c_6c86d2cac98111f196f9525400248c00
    ReservedCode2: o5pkcYsEw8kb58O7KNlxkN6aQcIdksw4GCtjlj42fku9WVoO5zx2TTw0NzRxn4D6B/7BMnAPDdo9JHQpncC3Oa/SBeM/K5BGLqRx5c7sZwyrYpX/T+Tlh4OeSEAb3doMqggjOnNqTM7CMqW4O5IHXRoEwkRHXQFGCopHRd3lYkmEjknhRNolL2/eeGM=
---

# Development Roadmap

Complete MVP roadmap. **M1–M3 implementations are present; M4 onward remain future work.**

## M1 — Foundation & Infrastructure ✅ (implemented)

- Monorepo (npm workspaces): `apps/web`, `apps/worker`, `packages/db`,
  `packages/core`, `packages/agents`, `packages/integrations`.
- Neon PostgreSQL schema + versioned Drizzle migrations (projects, tasks,
  agent_runs, artifacts, approvals, usage_logs, workflow_jobs, previews,
  exports, consultation, prototypes, assets, events, cleanup).
- Real Neon Auth integration: login, logout, sessions, protected dashboard,
  per-project ownership checks.
- Foundational UI: Login, Dashboard, Create Project, Project List, Project
  Details. Creating a project persists idea, title, ownership, initial state.
- Workflow foundations: typed states, valid transitions, approval stages,
  events, database-backed jobs, safe claiming, leases, crash recovery,
  stop/failure/retry states, operational Worker.
- `.env.example`, Railway two-service config, README + docs, real tests.

## M2 — AI Consultation (implemented; requires live service configuration)

Idea submission, dynamic clarification questions, consultation history
(`consultation_messages`), requirement collection, reference-image intake
(`project_assets`). Planner Agent + OpenAI text integration (`packages/agents`).

## M3 — Prototype Engine (implemented; live image verification pending)

OpenAI image generation, prototype revisions, image storage (private Blob),
version tracking (`prototype_versions`), prototype review/approval
(`approvals` type `prototype`).
See [M3 operations and verification](m3-prototype.md), including the required
verified input-token bound for image editing.

## M4 — PRD & Development Planning

PRD generation and approval, technology recommendation, template selection,
architecture generation, task planning (`tasks`), plan approval
(`approvals` type `plan`).

## M5 — AI Developer & Sandbox

OpenAI Developer integration, Vercel Sandbox
(`packages/integrations/src/sandbox`), real file editing, command execution,
GitHub repository creation and commits, per-task progress (`agent_runs`,
`artifacts`).

## M6 — QA & Auto Fix

Real test execution, structured bug reports, automatic repair up to 3 fix
cycles (`projects.retry_count`/`max_retries`), budget enforcement
(`usage_logs`, `projects.budget_cents`), pauses.

## M7 — On-Demand Preview & Code Export

Temporary Vercel previews (`previews`, 72h expiry), ZIP download and GitHub
export (`exports`), delivery details, retention timestamps.

## M8 — Cleanup, Recovery & End-to-End Validation

Retention policies, automatic cleanup (`cleanup_jobs`), worker recovery and
failure handling hardening, full workflow verification.

---

## Cross-milestone principles

- Never fake AI, GitHub, Sandbox, or deployment success.
- Keep provider abstractions (AI, Sandbox) replaceable.
- Preserve ownership checks and audit events from day one.
- Add billing/quota foundations (`budget_cents`, `usage_logs`) before paid AI
  usage begins (M2/M6).
*（内容由AI生成，仅供参考）*

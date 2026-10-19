---
AIGC:
    Label: "1"
    ContentProducer: 001191440300708461136T1XGW3
    ProduceID: e821b9ee54e031e8318c478725a8d21c_5b190a59c98111f18b7f525400393706
    ReservedCode1: 6qluFeXEbCb/KEUe8sOr3yVC+eF0zqfTylKBzkv2NnnCUEqQVRwjBxsuhVL6cld9L2HMIDebIbrvqn6nrdrEKJNyiVxTxnR5vdpUk6VyTtz5rVrQmIQqCy0zei2QteQts7d8/tBIep8FFSuFq83bEKc5JCjqU8uoJlbedof37rIo64IFHBnsqGWZi3k=
    ContentPropagator: 001191440300708461136T1XGW3
    PropagateID: e821b9ee54e031e8318c478725a8d21c_5b190a59c98111f18b7f525400393706
    ReservedCode2: 6qluFeXEbCb/KEUe8sOr3yVC+eF0zqfTylKBzkv2NnnCUEqQVRwjBxsuhVL6cld9L2HMIDebIbrvqn6nrdrEKJNyiVxTxnR5vdpUk6VyTtz5rVrQmIQqCy0zei2QteQts7d8/tBIep8FFSuFq83bEKc5JCjqU8uoJlbedof37rIo64IFHBnsqGWZi3k=
---

# AI Software Factory — Milestone 1

Turn a product idea into a **real, tested, exportable software application**.

This repository implements **Milestone 1 (Foundation & Infrastructure)** of the
AI Software Factory MVP: a runnable monorepo with Neon PostgreSQL (Drizzle),
real Neon Auth, a foundational Web app, a typed workflow engine, and an
operational background Worker. Later milestones (AI consultation, prototyping,
coding, QA, preview/export) are **not** implemented or simulated here.

## Repository layout

```text
ai-software-factory/
├── apps/
│   ├── web/            # Next.js + TypeScript + Tailwind (Dashboard, Auth, Projects)
│   └── worker/         # Node.js + TypeScript background worker (job queue)
├── packages/
│   ├── db/             # Drizzle schema, versioned migrations, db client
│   ├── core/           # Typed workflow state machine, job semantics, tests
│   ├── agents/         # AI Provider abstraction (OpenAI stub for M2+)
│   └── integrations/   # Sandbox provider + technology adapter contracts
├── templates/          # (planned M4/M5) generated application templates
├── docs/               # architecture, database, workflow, roadmap
├── .env.example        # environment variable template (no real secrets)
└── package.json        # npm workspaces root
```

## Technology stack

| Component | Technology |
|---|---|
| Frontend / API | Next.js + TypeScript + Tailwind CSS |
| Background Worker | Node.js + TypeScript (tsx) |
| Database | Neon PostgreSQL |
| ORM | Drizzle ORM |
| Authentication | Neon Auth (`@neondatabase/auth`, Better Auth based) |
| Hosting | Railway (Web + Worker services) |
| AI / Sandbox / Preview | Reserved for M2+ (placeholders only) |

## Quick start

Prerequisites: Node.js >= 20, npm >= 10.

```bash
# 1. Install dependencies (npm workspaces)
npm install

# 2. Configure environment
cp .env.example .env
#    Fill DATABASE_URL, NEON_AUTH_BASE_URL, NEON_AUTH_COOKIE_SECRET

# 3. Apply database migrations (requires a reachable Neon Postgres)
npm run db:generate   # optional: (re)generate SQL from schema
npm run db:migrate    # apply migrations to DATABASE_URL

# 4. Run the Web app
npm run dev:web       # http://localhost:3000

# 5. Run the Worker (in another terminal)
npm run dev:worker

# 6. Verify internal database→worker pipeline (optional, needs DATABASE_URL)
npm run worker:seed:internal-job   # creates a project + queued job
```

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev:web` / `dev:worker` | Run web / worker in watch mode |
| `npm run build` | Build all workspaces |
| `npm run typecheck` | TypeScript check across workspaces |
| `npm run lint` | ESLint across the monorepo |
| `npm test` | Vitest unit tests (workflow transitions, job semantics) |
| `npm run db:generate` | Generate Drizzle migration SQL offline |
| `npm run db:migrate` | Apply migrations to `DATABASE_URL` |
| `npm run start:web` | Start built web app |
| `npm run start:worker` | Start worker (requires `DATABASE_URL`) |
| `npm run worker:seed:internal-job` | Seed internal verification job |

## Environment configuration

See [`.env.example`](.env.example). Milestone 1 requires:

- `DATABASE_URL` — Neon Postgres connection string
- `NEON_AUTH_BASE_URL` — Neon Auth base URL from the Neon Console
- `NEON_AUTH_COOKIE_SECRET` — random secret for session cookie signing

All other variables are documented placeholders for later milestones (OpenAI,
GitHub, Vercel Sandbox/Preview, Blob storage). **Never commit real keys.**

## Railway deployment (two services)

Full instructions in [docs/architecture.md](docs/architecture.md#railway-deployment).

| Service | Build Command | Start Command |
|---|---|---|
| Web | `npm ci && npm run build` | `npm run start:web` |
| Worker | `npm ci && npm run build` | `npm run start:worker` |

Connect both services to `DATABASE_URL`, `NEON_AUTH_BASE_URL`,
`NEON_AUTH_COOKIE_SECRET`. See docs for the Neon Auth redirect/callback URL
configuration.

## Documentation

- [docs/architecture.md](docs/architecture.md) — architecture decisions, package boundaries, deployment
- [docs/database.md](docs/database.md) — schema, relationships, migrations
- [docs/workflow.md](docs/workflow.md) — state machine, approvals, job queue, recovery
- [docs/development-roadmap.md](docs/development-roadmap.md) — M1–M8 roadmap

## Current limitations (M1)

- AI consultation, prototyping, PRD/planning, coding, QA, preview and export are **not implemented** — they are planned milestones.
- Neon Auth requires configuration in the Neon Console (base URL, callback URLs, users).
- OpenAI / GitHub / Vercel credentials are placeholders; no external service is called.
- Worker processing requires a reachable `DATABASE_URL` and a queue containing jobs.
- No real API keys are committed to this repository.
*（内容由AI生成，仅供参考）*

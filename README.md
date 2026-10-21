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

# AI Software Factory — Milestones 1–2

Turn a product idea into a **real, tested, exportable software application**.

This repository includes the M1 foundation and M2 AI Consultation Engine:
Neon PostgreSQL and Auth, the existing Next.js Web app, a persistent Worker,
and real OpenAI product consultation with saved history, editable requirements,
usage estimates and project budget enforcement. Prototype generation, PRDs,
coding, QA and preview/export remain future milestones.

See [the M2 implementation and configuration guide](docs/m2-consultation.md).
## Repository layout

```text
ai-software-factory/
├── apps/
│   ├── web/            # Next.js + TypeScript + Tailwind (Dashboard, Auth, Projects)
│   └── worker/         # Node.js + TypeScript background worker (job queue)
├── packages/
│   ├── db/             # Drizzle schema, versioned migrations, db client
│   ├── core/           # Typed workflow state machine, job semantics, tests
│   ├── agents/         # AI Provider, OpenAI Planner, consultation persistence and pricing
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
| Hosting | Vercel Web + Railway Worker |
| AI consultation | Official OpenAI SDK with structured responses (Worker only) |
| Sandbox / Preview | Future milestones |

## Quick start

Prerequisites: Node.js 22.x, npm 10.9.8 (repository toolchain).

```bash
# 1. Install dependencies (npm workspaces)
npm ci

# 2. Configure environment
cp .env.example .env
#    Fill DATABASE_URL and OPENAI_API_KEY for the Worker.
#    Set DATABASE_URL and Neon Auth variables in apps/web/.env.local for the Web.

# 3. Apply database migrations (requires a reachable Neon Postgres)
npm run db:generate   # optional: (re)generate SQL from schema
npm run db:migrate    # apply migrations to DATABASE_URL

# 4. Run the Web app
npm run dev:web       # http://localhost:3000

# 5. Run the Worker (in another terminal)
node --env-file=.env --import tsx apps/worker/src/index.ts

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
| `npm test` | Unit/UI tests; real PostgreSQL integration tests when explicit local test URLs are set |
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

M2 also requires `OPENAI_API_KEY` on the Worker. Model and verified pricing are
configurable. Optional reference intake needs a private `BLOB_READ_WRITE_TOKEN`
on Vercel. GitHub, Sandbox and Preview remain future configuration.
**Never commit real keys.**

## Deployment

Vercel hosts Web; Railway hosts the Worker; Neon hosts the shared database/Auth.
Use the existing service settings, with `npm run build:worker` / `npm run start:worker`
for Railway. Configure Neon Auth's allowed origin for the Vercel Web domain.
Only the Worker needs `OPENAI_API_KEY`. See [M2 configuration](docs/m2-consultation.md)
for pricing, budgets and optional private Blob setup. Deploy and resume Railway
only after review and approval; pushing the development branch does not deploy it.

## Documentation

- [docs/architecture.md](docs/architecture.md) — architecture decisions, package boundaries, deployment
- [docs/database.md](docs/database.md) — schema, relationships, migrations
- [docs/workflow.md](docs/workflow.md) — state machine, approvals, job queue, recovery
- [docs/development-roadmap.md](docs/development-roadmap.md) — M1–M8 roadmap

## Current limitations

- Prototype generation, PRD/planning, coding, QA, preview and export remain future milestones.
- Neon Auth and OpenAI require real service configuration; missing credentials never produce fake output.
- Private image uploads need a configured private Blob store. M2 stores references but does not analyze images.
- Cost estimates use configured pricing, not an exact billing invoice. Unconfirmed paid calls retain conservative reservations.
- Worker processing requires a reachable database and an explicitly running Worker.
- See [M2 verification and handoff](docs/m2-consultation.md) for real API testing and current validation limits.
*（内容由AI生成，仅供参考）*

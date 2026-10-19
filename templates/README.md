# Templates directory

Generated application templates used by the AI Developer pipeline.

| Directory | Technology | Status |
|---|---|---|
| `nextjs-default/` | Next.js + TypeScript + Tailwind CSS | Planned — filled in M4/M5 |
| `react-vite/` | React + Vite + TypeScript | Planned — filled in M4/M5 |

Milestone 1 does not ship concrete templates. The Technology Adapter contract
lives in `packages/integrations/src/adapters` and documents the exact commands
each template must provide. Templates are consumed inside sandboxes starting
in M5.

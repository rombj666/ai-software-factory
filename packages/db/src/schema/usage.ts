import {
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { projects } from "./projects";
import { approvalStatusEnum } from "./enums";

/**
 * AI / infrastructure usage logs. Foundation for cost visibility and budget
 * controls. Amount stored as numeric for exact accounting.
 */
export const usageLogs = pgTable(
  "usage_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
    kind: text("kind").notNull(), // tokens | compute | storage | external_api
    provider: text("provider").notNull(), // openai | vercel | github | ...
    amount: numeric("amount").notNull(),
    unit: text("unit").notNull(),
    currency: text("currency").notNull().default("USD"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("usage_logs_project_idx").on(table.projectId),
    index("usage_logs_recorded_at_idx").on(table.recordedAt),
  ],
);

/**
 * Approval gates: prototype, PRD and development plan approvals.
 * `reviewerId` is the Neon Auth user id of the approver.
 */
export const approvals = pgTable(
  "approvals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(), // prototype | prd | development_plan
    status: approvalStatusEnum("status").notNull().default("pending"),
    reviewerId: text("reviewer_id").notNull(),
    comment: text("comment"),
    version: integer("version").notNull().default(1),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("approvals_project_idx").on(table.projectId)],
);
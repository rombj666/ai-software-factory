import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { projects } from "./projects";
import { agentRunStatusEnum, taskStatusEnum } from "./enums";

/**
 * Development tasks inside a project (planned by the future Planner Agent).
 * M1 defines the table and ownership/index rules; task creation happens from
 * M4 onward.
 */
export const tasks = pgTable(
  "tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description"),
    kind: text("kind").notNull().default("general"),
    status: taskStatusEnum("status").notNull().default("todo"),
    assignee: text("assignee"),
    retryCount: integer("retry_count").notNull().default(0),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("tasks_project_idx").on(table.projectId)],
);

/**
 * Agent execution runs (Planner / Developer / QA). Persisted so progress UI
 * reads real state only.
 */
export const agentRuns = pgTable(
  "agent_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    agentType: text("agent_type").notNull(),
    status: agentRunStatusEnum("status").notNull().default("pending"),
    input: jsonb("input").$type<Record<string, unknown>>().default({}),
    output: jsonb("output").$type<Record<string, unknown>>().default({}),
    error: text("error"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("agent_runs_project_idx").on(table.projectId)],
);
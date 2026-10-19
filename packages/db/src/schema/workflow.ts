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
import { cleanupJobStatusEnum, jobStatusEnum } from "./enums";

/**
 * Database-backed background jobs consumed by the Worker. Safe claiming is
 * implemented with `available_at` + lease expiry (see docs/workflow.md).
 */
export const workflowJobs = pgTable(
  "workflow_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
    type: text("type").notNull(), // project_initialization | ...
    status: jobStatusEnum("status").notNull().default("queued"),
    payload: jsonb("payload").$type<Record<string, unknown>>().default({}),
    result: jsonb("result").$type<Record<string, unknown>>().default({}),
    error: text("error"),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    claimedBy: text("claimed_by"),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    availableAt: timestamp("available_at", { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("workflow_jobs_claim_idx").on(table.status, table.availableAt),
    index("workflow_jobs_lease_idx").on(table.leaseExpiresAt),
    index("workflow_jobs_project_idx").on(table.projectId),
  ],
);

/**
 * Append-only workflow event log (audit trail of state transitions).
 */
export const lifecycleEvents = pgTable(
  "lifecycle_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
    eventType: text("event_type").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("lifecycle_events_project_idx").on(table.projectId),
    index("lifecycle_events_type_idx").on(table.eventType),
  ],
);

/**
 * Resource cleanup jobs (preview teardown, export artifact expiry). Destructive
 * cleanup must be explicit, auditable and idempotent; tracked here.
 */
export const cleanupJobs = pgTable(
  "cleanup_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
    resourceType: text("resource_type").notNull(), // preview | export_artifact | sandbox | ...
    status: cleanupJobStatusEnum("status").notNull().default("pending"),
    externalId: text("external_id"),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    scheduledFor: timestamp("scheduled_for", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("cleanup_jobs_status_idx").on(table.status, table.scheduledFor),
    index("cleanup_jobs_project_idx").on(table.projectId),
  ],
);
import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { projectStatusEnum } from "./enums";

/**
 * A user project: the top-level aggregate for the whole MVP workflow.
 *
 * In M1 a project only persists the user's idea, title, ownership and the
 * initial workflow state. `ownerId` is the Neon Auth (Better Auth) user id.
 */
export const projects = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: text("owner_id").notNull(),
    title: text("title").notNull(),
    idea: text("idea").notNull(),
    status: projectStatusEnum("status").notNull().default("idea_submitted"),
    // Project-level budget control (cents) - foundation for resource limits.
    // Default $20.00 (2000 cents) per project for M1.
    budgetLimitCents: integer("budget_limit_cents").notNull().default(2000),
    currentState: jsonb("current_state").$type<Record<string, unknown>>().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("projects_owner_idx").on(table.ownerId),
    index("projects_status_idx").on(table.status),
    uniqueIndex("projects_owner_title_idx").on(table.ownerId, table.title),
  ],
);
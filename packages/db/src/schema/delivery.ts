import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { projects } from "./projects";
import { exportStatusEnum, previewStatusEnum } from "./enums";

/**
 * Generated / uploaded artifacts (prototype images, PRD, plans, source code,
 * QA reports). Storage URIs may point at Vercel Blob or the GitHub repo.
 */
export const artifacts = pgTable(
  "artifacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    storageUri: text("storage_uri"),
    checksum: text("checksum"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("artifacts_project_idx").on(table.projectId)],
);

/**
 * Temporary on-demand previews (Vercel). Separate lifecycle from coding
 * workflow; expires after 72h by policy.
 */
export const previews = pgTable(
  "previews",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    status: previewStatusEnum("status").notNull().default("requested"),
    url: text("url"),
    externalId: text("external_id"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("previews_project_idx").on(table.projectId)],
);

/**
 * Code exports (ZIP download / GitHub export). Separate lifecycle from the
 * coding workflow, with its own status progression.
 */
export const exports = pgTable(
  "exports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    status: exportStatusEnum("status").notNull().default("requested"),
    kind: text("kind").notNull().default("zip"),
    downloadUrl: text("download_url"),
    githubRepoUrl: text("github_repo_url"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("exports_project_idx").on(table.projectId)],
);
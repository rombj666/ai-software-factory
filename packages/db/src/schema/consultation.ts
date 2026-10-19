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
import { messageRoleEnum, prototypeVersionStatusEnum } from "./enums";

/**
 * Consultation conversation history (M2+). Defined in M1 so the full workflow
 * can be persisted without later destructive migrations.
 */
export const consultationMessages = pgTable(
  "consultation_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    role: messageRoleEnum("role").notNull(),
    content: text("content").notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("consultation_messages_project_idx").on(table.projectId)],
);

/**
 * Generated prototype versions with approval history (M3+).
 */
export const prototypeVersions = pgTable(
  "prototype_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    imageStorageUri: text("image_storage_uri").notNull(),
    prompt: text("prompt"),
    status: prototypeVersionStatusEnum("status").notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("prototype_versions_project_idx").on(table.projectId),
    index("prototype_versions_project_version_idx").on(table.projectId, table.version),
  ],
);

/**
 * Uploaded project assets (reference images / attachments).
 */
export const projectAssets = pgTable(
  "project_assets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    kind: text("kind").notNull().default("reference_image"),
    storageUri: text("storage_uri").notNull(),
    filename: text("filename"),
    mimeType: text("mime_type"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("project_assets_project_idx").on(table.projectId)],
);
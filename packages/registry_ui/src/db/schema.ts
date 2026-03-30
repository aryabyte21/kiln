import { pgTable, text, timestamp } from "drizzle-orm/pg-core"

export const tools = pgTable("tools_view", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  version: text("version").notNull().default("1.0.0"),
  author: text("author").notNull().default(""),
  category: text("category").notNull().default("general"),
  tagsJson: text("tags_json").notNull().default("[]"),
  specJson: text("spec_json").notNull(),
  registeredAt: timestamp("registered_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
})

// Drizzle type helpers
export type Tool = typeof tools.$inferSelect
export type NewTool = typeof tools.$inferInsert

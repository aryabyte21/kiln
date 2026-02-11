import { pgTable, serial, text, timestamp, varchar } from 'drizzle-orm/pg-core';

export const ideas = pgTable('ideas', {
  id: serial('id').primaryKey(),
  slug: varchar('slug', { length: 120 }).notNull().unique(),
  title: varchar('title', { length: 200 }).notNull(),
  problem: text('problem').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export type Idea = typeof ideas.$inferSelect;
export type NewIdea = typeof ideas.$inferInsert;

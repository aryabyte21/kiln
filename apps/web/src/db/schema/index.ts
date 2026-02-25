import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  integer,
  numeric,
  boolean,
  serial,
  varchar,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

// ---------------------------------------------------------------------------
// Legacy table (kept for backwards-compat with existing data)
// ---------------------------------------------------------------------------

export const ideas = pgTable('ideas', {
  id: serial('id').primaryKey(),
  slug: varchar('slug', { length: 120 }).notNull().unique(),
  title: varchar('title', { length: 200 }).notNull(),
  problem: text('problem').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export type Idea = typeof ideas.$inferSelect;
export type NewIdea = typeof ideas.$inferInsert;

// ---------------------------------------------------------------------------
// OpenSwarm Core Tables — mirrors Go control plane SQL schema
// ---------------------------------------------------------------------------

// Swarm definitions (from applied swarm.yaml)
export const swarms = pgTable('swarms', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull().unique(),
  spec: jsonb('spec').notNull(),
  status: text('status').notNull().default('pending'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const swarmsRelations = relations(swarms, ({ many }) => ({
  agentSpecs: many(agentSpecs),
  tasks: many(tasks),
}));

export type Swarm = typeof swarms.$inferSelect;
export type NewSwarm = typeof swarms.$inferInsert;

// Agent specifications within a swarm
export const agentSpecs = pgTable(
  'agent_specs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    swarmId: uuid('swarm_id')
      .notNull()
      .references(() => swarms.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    model: text('model').notNull(),
    policyName: text('policy_name'),
    config: jsonb('config').notNull().default({}),
  },
  (table) => [uniqueIndex('agent_specs_swarm_name_idx').on(table.swarmId, table.name)]
);

export const agentSpecsRelations = relations(agentSpecs, ({ one }) => ({
  swarm: one(swarms, { fields: [agentSpecs.swarmId], references: [swarms.id] }),
}));

export type AgentSpec = typeof agentSpecs.$inferSelect;
export type NewAgentSpec = typeof agentSpecs.$inferInsert;

// Policy definitions
export const policies = pgTable('policies', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull().unique(),
  spec: jsonb('spec').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export type Policy = typeof policies.$inferSelect;
export type NewPolicy = typeof policies.$inferInsert;

// Task records
export const tasks = pgTable(
  'tasks',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    swarmId: uuid('swarm_id').references(() => swarms.id),
    agentRole: text('agent_role').notNull(),
    assignedAgentId: text('assigned_agent_id'),
    input: text('input').notNull(),
    output: text('output'),
    status: text('status').notNull().default('pending'),
    tokensUsed: integer('tokens_used').notNull().default(0),
    costUsd: numeric('cost_usd', { precision: 10, scale: 6 }).notNull().default('0'),
    latencyMs: integer('latency_ms'),
    error: text('error'),
    traceId: text('trace_id'),
    metadata: jsonb('metadata').default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (table) => [
    index('idx_tasks_swarm_status').on(table.swarmId, table.status),
    index('idx_tasks_agent_role').on(table.agentRole),
    index('idx_tasks_created_at').on(table.createdAt),
  ]
);

export const tasksRelations = relations(tasks, ({ one }) => ({
  swarm: one(swarms, { fields: [tasks.swarmId], references: [swarms.id] }),
}));

export type Task = typeof tasks.$inferSelect;
export type NewTask = typeof tasks.$inferInsert;

// Agent genomes
export const genomes = pgTable(
  'genomes',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    agentRole: text('agent_role').notNull(),
    generation: integer('generation').notNull(),
    parentIds: text('parent_ids').array(),
    genes: jsonb('genes').notNull(),
    fitness: jsonb('fitness').default({}),
    active: boolean('active').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('idx_genomes_role_gen').on(table.agentRole, table.generation),
    index('idx_genomes_active').on(table.active),
  ]
);

export type Genome = typeof genomes.$inferSelect;
export type NewGenome = typeof genomes.$inferInsert;

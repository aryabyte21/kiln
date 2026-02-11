import 'server-only';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres, { type Sql } from 'postgres';
import { DATABASE_URL } from './config';
import * as schema from './schema';

const globalForDb = globalThis as typeof globalThis & {
  __cs5224PostgresClient?: Sql;
};

const queryClient =
  globalForDb.__cs5224PostgresClient ??
  postgres(DATABASE_URL, { max: process.env.NODE_ENV === 'production' ? 10 : 1 });

if (process.env.NODE_ENV !== 'production') {
  globalForDb.__cs5224PostgresClient = queryClient;
}

export const db = drizzle(queryClient, { schema });

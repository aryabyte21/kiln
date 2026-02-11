import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

const connectionString = process.env.DATABASE_URL ?? 'postgres://cs5224:cs5224@localhost:5432/cs5224';
const queryClient = postgres(connectionString, { max: 1 });

export const db = drizzle(queryClient);

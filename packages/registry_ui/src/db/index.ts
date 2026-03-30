import { drizzle } from "drizzle-orm/postgres-js"
import postgres from "postgres"

import * as schema from "./schema"

const connectionString = process.env.DATABASE_URL || ""

// For server-side only — this file should only be imported in API routes / server components
const client = connectionString ? postgres(connectionString) : null
export const db = client ? drizzle(client, { schema }) : null

export { schema }

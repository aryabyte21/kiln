import { z } from 'zod';

/**
 * Environment variable validation schema
 *
 * This ensures all required environment variables are present and valid
 * at build time and runtime. Add new variables here as needed.
 */
const envSchema = z.object({
  // Database
  DATABASE_URL: z.string().url().describe('Postgres connection string'),

  // Node environment
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

  // Backend services (optional for local dev)
  NEXT_PUBLIC_PY_API_URL: z.string().url().optional().default('http://localhost:8000'),
  NEXT_PUBLIC_GO_API_URL: z.string().url().optional().default('http://localhost:8080'),

  // Add your custom env vars here
  // NEXT_PUBLIC_API_KEY: z.string().min(1),
});

export type Env = z.infer<typeof envSchema>;

/**
 * Validates and returns parsed environment variables
 *
 * @throws {z.ZodError} if validation fails
 * @returns {Env} validated environment variables
 */
function validateEnv(): Env {
  try {
    return envSchema.parse({
      DATABASE_URL: process.env.DATABASE_URL,
      NODE_ENV: process.env.NODE_ENV,
      NEXT_PUBLIC_PY_API_URL: process.env.NEXT_PUBLIC_PY_API_URL,
      NEXT_PUBLIC_GO_API_URL: process.env.NEXT_PUBLIC_GO_API_URL,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      const missingVars = error.errors
        .map((err) => `  - ${err.path.join('.')}: ${err.message}`)
        .join('\n');

      throw new Error(
        `❌ Invalid environment variables:\n${missingVars}\n\n` +
          `💡 Check your .env file and ensure all required variables are set.`
      );
    }
    throw error;
  }
}

/**
 * Validated environment variables
 *
 * Import this in your app code instead of accessing process.env directly:
 *
 * @example
 * import { env } from '@/lib/env';
 * const dbUrl = env.DATABASE_URL;
 */
export const env = validateEnv();

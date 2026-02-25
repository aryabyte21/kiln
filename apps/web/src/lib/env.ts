import { z } from 'zod';

const envSchema = z.object({
  DATABASE_URL: z.string().url().describe('Postgres connection string'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  NEXT_PUBLIC_CP_URL: z.string().url().optional().default('http://localhost:9090'),
});

export type Env = z.infer<typeof envSchema>;

function validateEnv(): Env {
  try {
    return envSchema.parse({
      DATABASE_URL: process.env.DATABASE_URL,
      NODE_ENV: process.env.NODE_ENV,
      NEXT_PUBLIC_CP_URL: process.env.NEXT_PUBLIC_CP_URL,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      const missingVars = error.errors
        .map((err) => `  - ${err.path.join('.')}: ${err.message}`)
        .join('\n');

      throw new Error(`Invalid environment variables:\n${missingVars}\n\nCheck your .env file.`);
    }
    throw error;
  }
}

export const env = validateEnv();

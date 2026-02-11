import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'drizzle-kit';
import { DEFAULT_DATABASE_URL } from './src/db/config';

const appRoot = dirname(fileURLToPath(import.meta.url));
const envPaths = [
  resolve(appRoot, '../../.env'),
  resolve(appRoot, '../../.env.local'),
  resolve(appRoot, '.env'),
  resolve(appRoot, '.env.local'),
];

for (const envPath of envPaths) {
  if (existsSync(envPath)) {
    process.loadEnvFile?.(envPath);
  }
}

export default defineConfig({
  schema: './src/db/schema/index.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL,
  },
});

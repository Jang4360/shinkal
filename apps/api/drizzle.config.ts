import { defineConfig } from 'drizzle-kit';
import { config } from 'dotenv';
import path from 'node:path';

config({ path: path.resolve(process.cwd(), '../../.env') });
config();

export default defineConfig({
  dialect: 'sqlite',
  schema: './src/db/schema.ts',
  out: './drizzle',
  dbCredentials: {
    url: process.env.TURSO_DATABASE_URL || '',
    authToken: process.env.TURSO_AUTH_TOKEN,
  },
});

import { config } from 'dotenv';
import path from 'node:path';

const isWorkerRuntime = typeof (globalThis as { WebSocketPair?: unknown }).WebSocketPair !== 'undefined';

if (!isWorkerRuntime) {
  config({ path: path.resolve(process.cwd(), '../../.env') });
  config({ path: path.resolve(process.cwd(), '.env') });
  config();
}

export const env = {
  TURSO_DATABASE_URL: process.env.TURSO_DATABASE_URL,
  TURSO_AUTH_TOKEN: process.env.TURSO_AUTH_TOKEN,
  APP_PASSWORD: process.env.APP_PASSWORD,
  AUTH_TOKEN_SECRET: process.env.AUTH_TOKEN_SECRET,
  APP_ORIGIN: process.env.APP_ORIGIN || 'http://localhost:5173',
  APP_ENV: process.env.APP_ENV || process.env.NODE_ENV || 'development',
  COOKIE_SECURE: process.env.COOKIE_SECURE ? process.env.COOKIE_SECURE === 'true' : process.env.NODE_ENV === 'production',
  COOKIE_SAME_SITE: process.env.COOKIE_SAME_SITE || (process.env.NODE_ENV === 'production' ? 'None' : 'Lax'),
  SENTRY_DSN: process.env.SENTRY_DSN,
  DISCORD_WEBHOOK_URL: process.env.DISCORD_WEBHOOK_URL,
  CF_ANALYTICS_TOKEN: process.env.CF_ANALYTICS_TOKEN,
  CF_ACCOUNT_ID: process.env.CF_ACCOUNT_ID || process.env.CLOUDFLARE_ACCOUNT_ID,
  OPS_MIN_ACTIVITY_HOURS: process.env.OPS_MIN_ACTIVITY_HOURS || '24',
  PORT: Number(process.env.PORT || 8787),
};

export function assertEnv() {
  const missing = ['TURSO_DATABASE_URL', 'TURSO_AUTH_TOKEN', 'APP_PASSWORD', 'AUTH_TOKEN_SECRET'].filter((key) => !env[key as keyof typeof env]);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
  if (env.AUTH_TOKEN_SECRET && env.AUTH_TOKEN_SECRET.length < 32) {
    throw new Error('AUTH_TOKEN_SECRET must be at least 32 characters.');
  }
}

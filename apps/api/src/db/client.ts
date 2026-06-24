import { createClient, type Client } from '@libsql/client/web';
import { drizzle } from 'drizzle-orm/libsql';
import { assertEnv, env } from '../env';
import * as schema from './schema';

type DbClient = ReturnType<typeof drizzle>;

let client: Client | null = null;
let database: DbClient | null = null;

export function getLibsql() {
  if (!client) {
    assertEnv();
    client = createClient({
      url: env.TURSO_DATABASE_URL!,
      authToken: env.TURSO_AUTH_TOKEN,
    });
  }
  return client;
}

export function getDb() {
  if (!database) {
    database = drizzle(getLibsql(), { schema });
  }
  return database;
}

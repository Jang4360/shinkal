import { migrate } from 'drizzle-orm/libsql/migrator';
import { getDb } from './client';

await migrate(getDb(), { migrationsFolder: './drizzle' });
console.log('Migrations applied');

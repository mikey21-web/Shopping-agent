/**
 * Migration entry point. The schema is idempotent, so "migrate" simply applies
 * it and reports what the database now contains.
 */

import { applySchema, closeDb, getDb, select } from './index.ts';
import { config } from '../config.ts';

function main(): void {
  const started = Date.now();
  applySchema();
  const tables = select<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
  );
  console.log(`[migrate] database: ${config.databasePath}`);
  console.log(`[migrate] tables (${tables.length}): ${tables.map((t) => t.name).join(', ')}`);
  console.log(`[migrate] completed in ${Date.now() - started}ms`);
  closeDb();
}

main();

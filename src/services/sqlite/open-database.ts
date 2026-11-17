import { Database } from 'bun:sqlite';
import { instrumentSlowQueries } from './slow-query-log.js';

export type SqliteOpenOptions = ConstructorParameters<typeof Database>[1];

/**
 * The only sanctioned place a worker-resident module constructs a SQLite
 * connection. It applies no pragma and no guard, because prompt import and
 * restore open foreign or read-only files that must not be written; each caller
 * keeps its own pragmas. What it guarantees is that the connection is timed:
 * a slow statement logs SLOW_QUERY and every statement counts toward the
 * enclosing SQL scope (sql-scope.ts). tests/sqlite/sqlite-opener-coverage.test.ts
 * fails when another module constructs a Database directly.
 */
export function openSqliteDatabase(filename: string, options?: SqliteOpenOptions): Database {
  return instrumentSlowQueries(new Database(filename, options));
}

/** A store constructor's argument: instrument a connection the caller opened, or open a path through the sanctioned opener. */
export function instrumentOrOpen(dbOrPath: string | Database, options?: SqliteOpenOptions): Database {
  return dbOrPath instanceof Database ? instrumentSlowQueries(dbOrPath) : openSqliteDatabase(dbOrPath, options);
}

import { afterAll, describe, expect, it } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'fs';
import { tmpdir } from 'os';
import { join, relative } from 'path';

import { instrumentOrOpen, openSqliteDatabase } from '../../src/services/sqlite/open-database.js';
import { SessionSearch } from '../../src/services/sqlite/SessionSearch.js';
import { SessionStore } from '../../src/services/sqlite/SessionStore.js';
import { startSqlScope } from '../../src/services/sqlite/sql-scope.js';

const REPO_ROOT = join(import.meta.dir, '..', '..');
const SCAN_ROOTS = ['src'];
const SOURCE_FILE = /\.(?:ts|mts|mjs|js|cjs)$/;

/**
 * Modules that may construct a Database themselves. Everything else in src/
 * goes through openSqliteDatabase so its statements are timed and counted.
 */
const ALLOWLIST: Record<string, string> = {
  'src/services/sqlite/open-database.ts': 'the opener itself',
  'src/services/backup/sqlite-file-job.ts': 'CHILD_SCRIPT source text; runs in a child bun process, not the worker',
  'src/services/work-view/request-groups.mjs': 'CLI-only runCli fallback; the worker injects the WorkViewRoutes connection',
  'src/cli/claude-md-commands.ts': 'CLI process (claude-md generate/clean); not the worker, opens the file the command names',
  'src/cli/handlers/file-context-dedupe.ts': 'hook process handler; short-lived, not the worker',
  'src/npx-cli/install/usage-summary.ts': 'npx installer process; reads a database before any worker exists',
};

function sourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) found.push(...sourceFiles(full));
    else if (SOURCE_FILE.test(name) && !name.endsWith('.d.ts')) found.push(full);
  }
  return found;
}

/** Names bound to bun:sqlite's Database value in `source` (aliases included); type-only imports do not count. */
function databaseBindings(source: string): string[] {
  const names = new Set<string>();
  for (const match of source.matchAll(/^import\s*\{([^}]*)\}\s*from\s*['"]bun:sqlite['"]/gm)) {
    for (const part of match[1].split(',')) {
      const entry = part.trim();
      if (entry.startsWith('type ')) continue;
      const [name, alias] = entry.split(/\s+as\s+/);
      if (name === 'Database') names.add(alias ?? name);
    }
  }
  // `import Sqlite from 'bun:sqlite'`: Bun's default export is the Database class itself.
  for (const match of source.matchAll(/^import\s+(\w+)\s*(?:,\s*\{[^}]*\}\s*)?from\s*['"]bun:sqlite['"]/gm)) {
    if (match[1] !== 'type') names.add(match[1]);
  }
  // `import * as ns from 'bun:sqlite'`: ns.Database (matched by any `x.Database` below) and ns.default are the class.
  for (const match of source.matchAll(/^import\s+\*\s+as\s+(\w+)\s+from\s*['"]bun:sqlite['"]/gm)) {
    names.add(`${match[1]}.default`);
  }
  for (const match of source.matchAll(/(?:const|let|var)\s*\{([^}]*)\}\s*=\s*require\(\s*['"]bun:sqlite['"]\s*\)/g)) {
    for (const part of match[1].split(',')) {
      const [name, alias] = part.trim().split(/\s*:\s*/);
      if (name === 'Database') names.add(alias ?? name);
    }
  }
  if (/import\(\s*['"]bun:sqlite['"]\s*\)\s*\.\s*Database\b/.test(source)) names.add('Database');
  return [...names];
}

/** Direct constructions of a bun:sqlite Database found in `source`; one hit per call site (keyed by where the match ends). */
function findDirectConstructions(source: string): string[] {
  const hits = new Map<number, string>();
  const collect = (pattern: RegExp): void => {
    for (const match of source.matchAll(pattern)) hits.set((match.index ?? 0) + match[0].length, match[0]);
  };
  collect(/\bnew\s+\w+\.Database\s*\(|\b\w+\.Database\.(?:open|deserialize)\s*\(/g);
  for (const name of new Set([...databaseBindings(source), 'Database'])) {
    const escaped = name.replace(/[$.]/g, '\\$&');
    collect(new RegExp(`\\bnew\\s+${escaped}\\s*\\(|\\b${escaped}\\.(?:open|deserialize)\\s*\\(`, 'g'));
  }
  return [...hits.values()];
}

const files = SCAN_ROOTS.flatMap(root => sourceFiles(join(REPO_ROOT, root)));
const violations = files
  .map(file => ({ file: relative(REPO_ROOT, file), hits: findDirectConstructions(readFileSync(file, 'utf8')) }))
  .filter(entry => entry.hits.length > 0);

describe('SQLite connections go through the instrumented opener', () => {
  it('scans the worker-resident tree and finds the opener (the scan is not vacuous)', () => {
    expect(files.length).toBeGreaterThan(100);
    expect(violations.map(entry => entry.file)).toContain('src/services/sqlite/open-database.ts');
  });

  it('constructs a Database directly only in allowlisted files', () => {
    const unexpected = violations.filter(entry => !(entry.file in ALLOWLIST));
    expect(unexpected.map(entry => `${entry.file}: ${entry.hits.join(', ')}`)).toEqual([]);
  });

  it('keeps no stale allowlist entry', () => {
    const flagged = new Set(violations.map(entry => entry.file));
    expect(Object.keys(ALLOWLIST).filter(file => !flagged.has(file))).toEqual([]);
  });

  it('flags an aliased import, a require destructure, a lazy import and a plain construction', () => {
    expect(findDirectConstructions(`import { Database as Db } from 'bun:sqlite';\nconst d = new Db(p);`)).toHaveLength(1);
    expect(findDirectConstructions(`const { Database } = require('bun:sqlite');\nnew Database(p, { readonly: true });`)).toHaveLength(1);
    expect(findDirectConstructions(`const { Database: Handle } = require('bun:sqlite');\nnew Handle(p);`)).toHaveLength(1);
    expect(findDirectConstructions(`import { Database } from 'bun:sqlite';\nconst x = Database.open(p);`)).toHaveLength(1);
    expect(findDirectConstructions(`const D = require('bun:sqlite') as typeof import('bun:sqlite');\nnew D.Database(p);`)).toHaveLength(1);
  });

  it('flags a default import and a namespace import (Bun exports the Database class as the default)', () => {
    expect(findDirectConstructions(`import Sqlite from 'bun:sqlite';\nconst d = new Sqlite(p);`)).toHaveLength(1);
    expect(findDirectConstructions(`import Sqlite, { type Statement } from 'bun:sqlite';\nconst d = new Sqlite(p, { readonly: true });`)).toHaveLength(1);
    expect(findDirectConstructions(`import * as ns from 'bun:sqlite';\nconst d = new ns.Database(p);`)).toHaveLength(1);
    expect(findDirectConstructions(`import * as ns from 'bun:sqlite';\nconst d = new ns.default(p);`)).toHaveLength(1);
    expect(findDirectConstructions(`import * as ns from 'bun:sqlite';\nconst d = ns.Database.open(p);`)).toHaveLength(1);
  });

  it('does not flag a module that imports only the Database type or value without constructing one', () => {
    expect(findDirectConstructions(`import { Database } from 'bun:sqlite';\nexport const isDb = (x: unknown) => x instanceof Database;`)).toEqual([]);
    expect(findDirectConstructions(`import * as ns from 'bun:sqlite';\nexport type Db = ns.Database;`)).toEqual([]);
  });

  it('does not flag a type-only import, an instanceof check or the opener call', () => {
    expect(findDirectConstructions(`import type { Database } from 'bun:sqlite';\nfunction f(d: Database) {}`)).toEqual([]);
    expect(findDirectConstructions(`import { Database } from 'bun:sqlite';\nif (x instanceof Database) {}`)).toEqual([]);
    expect(findDirectConstructions(`const db = openSqliteDatabase(path, { readonly: true });`)).toEqual([]);
  });
});

describe('src/ scan boundaries', () => {
  it('does not flag the server key service, which imports Database as a value but never constructs one', () => {
    const file = 'src/server/auth/sqlite-api-key-service.ts';
    expect(findDirectConstructions(readFileSync(join(REPO_ROOT, file), 'utf8'))).toEqual([]);
    expect(violations.map(entry => entry.file)).not.toContain(file);
  });

  it('covers the CLI, server, storage and utils trees, not only src/services and src/shared', () => {
    const roots = new Set(files.map(file => relative(REPO_ROOT, file).split('/')[1]));
    for (const root of ['cli', 'server', 'storage', 'utils', 'services', 'shared']) expect(roots.has(root)).toBe(true);
  });
});

describe('openSqliteDatabase returns an instrumented connection', () => {
  const directory = mkdtempSync(join(tmpdir(), 'claude-mem-opener-'));
  afterAll(() => rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 }));

  /** Statements the enclosing SQL scope counted; an uninstrumented connection counts none. */
  function countedStatements(db: Database): number {
    const scope = startSqlScope('opener-test', { thresholdMs: -1, warn: () => {} });
    scope.run(() => {
      db.query('SELECT 1 AS one').get();
      db.run('SELECT 2');
    });
    return scope.end()?.statements ?? 0;
  }

  it('counts statements when called with no options', () => {
    expect(countedStatements(openSqliteDatabase(':memory:'))).toBeGreaterThan(0);
  });

  it('counts statements with explicitly undefined options, which Bun treats like no options', () => {
    const db = openSqliteDatabase(':memory:', undefined);
    expect(countedStatements(db)).toBeGreaterThan(0);
    expect(db.query('SELECT 5 AS five').get()).toEqual({ five: 5 });
  });

  it('counts statements on a read-only connection and keeps it read-only', () => {
    const path = join(directory, 'ro.db');
    const writer = openSqliteDatabase(path);
    writer.run('CREATE TABLE t (id INTEGER)');
    writer.close();
    const db = openSqliteDatabase(path, { readonly: true });
    expect(countedStatements(db)).toBeGreaterThan(0);
    expect(() => db.run('INSERT INTO t VALUES (1)')).toThrow();
    db.close();
  });

  it('is what a plain Database lacks: the same calls on an unwrapped connection count nothing', () => {
    expect(countedStatements(new Database(':memory:'))).toBe(0);
  });

  it('instrumentOrOpen instruments a supplied connection in place and opens a path through the opener', () => {
    const supplied = new Database(':memory:');
    expect(instrumentOrOpen(supplied)).toBe(supplied);
    expect(countedStatements(supplied)).toBeGreaterThan(0);
    expect(countedStatements(instrumentOrOpen(':memory:'))).toBeGreaterThan(0);
  });
});

describe('the storage classes run their statements through the instrumented connection', () => {
  const directory = mkdtempSync(join(tmpdir(), 'claude-mem-adoption-'));
  afterAll(() => rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 }));

  function statementsCounted(build: () => { close(): void }): number {
    const scope = startSqlScope('adoption', { thresholdMs: -1, warn: () => {} });
    scope.run(() => build().close());
    return scope.end()?.statements ?? 0;
  }

  it('SessionSearch constructed on :memory: counts statements', () => {
    expect(statementsCounted(() => new SessionSearch(':memory:'))).toBeGreaterThan(0);
  });

  it('SessionStore constructed on a file path counts statements', () => {
    expect(statementsCounted(() => new SessionStore(join(directory, 'store.db')))).toBeGreaterThan(0);
  });

  it('a plain Database handed to SessionStore is instrumented in place', () => {
    const plain = new Database(':memory:');
    expect(statementsCounted(() => new SessionStore(plain))).toBeGreaterThan(0);
  });
});

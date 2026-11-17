import { afterAll, describe, expect, it } from 'bun:test';
import { Database } from 'bun:sqlite';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { instrumentSlowQueries, type SlowQueryContext } from '../../src/services/sqlite/slow-query-log.js';
import { stampSourceMapIdentity } from '../../scripts/build-hooks.js';
import {
  INSTRUMENTATION_MODULES,
  SITE_OWN_FRAMES,
  SOURCE_MAP_IDENTITY_KEY,
  bundleDigest,
  callersOfSite,
  captureSite,
  createAdjacentMapReader,
  createCachedMapLoader,
  parseStackFrame,
  resolveFrame,
  takeHandedSite,
  withHandedSite,
  type FileStat,
  type MapLoader,
} from '../../src/services/sqlite/stack-source-map.js';

const BUNDLE = '/x/plugin/scripts/worker-service.cjs';

/** Column 0 maps to source 0 (slow-query-log.ts); column 10 maps to source 1 (SessionStore.ts). */
function twoSourceMap(): object {
  return {
    version: 3,
    file: 'worker-service.cjs',
    sources: ['../../src/services/sqlite/slow-query-log.ts', '../../src/services/sqlite/SessionStore.ts'],
    names: [],
    mappings: 'AAAA,UCAA',
  };
}

const loadTwoSourceMap: MapLoader = path => (path === BUNDLE ? twoSourceMap() : null);

describe('parseStackFrame', () => {
  it('reads the frame forms Bun prints', () => {
    expect(parseStackFrame('    at fn (/a/b.ts:12:34)')).toEqual({ fn: 'fn', file: '/a/b.ts', line: 12, column: 34 });
    expect(parseStackFrame('    at /a/b.ts:5:6')).toEqual({ fn: undefined, file: '/a/b.ts', line: 5, column: 6 });
    expect(parseStackFrame('    at async load (/a/b.cjs:1:2)')).toEqual({ fn: 'load', file: '/a/b.cjs', line: 1, column: 2 });
    expect(parseStackFrame('    at Object.get method (/a/b.ts:7:8)')?.fn).toBe('Object.get method');
  });

  it('skips lines that are not located frames', () => {
    expect(parseStackFrame('Error')).toBeNull();
    expect(parseStackFrame('    at <anonymous>')).toBeNull();
    expect(parseStackFrame('    at all (native)')).toBeNull();
  });
});

describe('resolveFrame', () => {
  it('maps a bundle position to its source file and keeps the bundle position for offline lookup', () => {
    const resolved = resolveFrame({ fn: 'a.b', file: BUNDLE, line: 1, column: 11 }, loadTwoSourceMap);
    expect(resolved.mapped).toBe(true);
    expect(resolved.source).toBe('src/services/sqlite/SessionStore.ts');
    expect(resolved.display).toContain('(src/services/sqlite/SessionStore.ts:1:1)');
    expect(resolved.display).toContain('[worker-service.cjs:1:11]');
  });

  it('keeps the raw frame when there is no map or the position is unmapped', () => {
    const none = resolveFrame({ fn: 'f', file: BUNDLE, line: 3, column: 4 }, () => null);
    expect(none).toEqual({ display: `f (${BUNDLE}:3:4)`, source: BUNDLE, mapped: false, mapAvailable: false });
    const beyond = resolveFrame({ file: BUNDLE, line: 99, column: 1 }, loadTwoSourceMap);
    expect(beyond.mapped).toBe(false);
    expect(beyond.mapAvailable).toBe(true);
  });

  it('survives a loader that throws or returns a payload that is not a source map', () => {
    expect(resolveFrame({ file: BUNDLE, line: 1, column: 1 }, () => { throw new Error('read failed'); }).mapped).toBe(false);
    expect(resolveFrame({ file: BUNDLE, line: 1, column: 1 }, () => ({ version: 'nope' })).mapped).toBe(false);
  });
});

describe('source map columns', () => {
  it('reads frame columns as 1-based: column 10 is the end of source 0, column 11 the start of source 1', () => {
    const before = resolveFrame({ file: BUNDLE, line: 1, column: 10 }, loadTwoSourceMap);
    const at = resolveFrame({ file: BUNDLE, line: 1, column: 11 }, loadTwoSourceMap);
    expect(before.source).toBe('src/services/sqlite/slow-query-log.ts');
    expect(at.source).toBe('src/services/sqlite/SessionStore.ts');
  });
});

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function decodeVlq(segment: string): number[] {
  const values: number[] = [];
  let value = 0;
  let shift = 0;
  for (const char of segment) {
    const digit = BASE64.indexOf(char);
    value += (digit & 31) << shift;
    if (digit & 32) {
      shift += 5;
      continue;
    }
    values.push(value & 1 ? -(value >> 1) : value >> 1);
    value = 0;
    shift = 0;
  }
  return values;
}

interface DecodedSegment {
  line: number;
  column: number;
  source: string;
}

/** Segments of a source map decoded without node:module, as ground truth independent of SourceMap.findEntry. */
function decodeSegments(payload: { sources: string[]; mappings: string }): DecodedSegment[] {
  const segments: DecodedSegment[] = [];
  let sourceIndex = 0;
  let originalLine = 0;
  let originalColumn = 0;
  payload.mappings.split(';').forEach((lineText, line) => {
    let column = 0;
    for (const text of lineText.split(',')) {
      if (!text) continue;
      const fields = decodeVlq(text);
      column += fields[0];
      if (fields.length < 4) continue;
      sourceIndex += fields[1];
      originalLine += fields[2];
      originalColumn += fields[3];
      segments.push({ line, column, source: `${payload.sources[sourceIndex]}:${originalLine}:${originalColumn}` });
    }
  });
  return segments;
}

const REAL_BUNDLE = join(import.meta.dir, '..', '..', 'plugin', 'scripts', 'worker-service.cjs');

describe('the built worker bundle map', () => {
  const mapPath = `${REAL_BUNDLE}.map`;

  const shippedIdentity = (): { size: number; sha256: string } | undefined => (
    (JSON.parse(readFileSync(mapPath, 'utf8')) as Record<string, unknown>)[SOURCE_MAP_IDENTITY_KEY] as { size: number; sha256: string } | undefined
  );

  it.skipIf(!existsSync(mapPath))('an unstamped shipped map is refused, so a bundle built before the stamp existed logs raw frames', () => {
    if (shippedIdentity() !== undefined) return;
    expect(createAdjacentMapReader({ runningBundlePath: REAL_BUNDLE })(REAL_BUNDLE)).toBeNull();
  });

  it.skipIf(!existsSync(mapPath) || shippedIdentity() === undefined)('a reader bound to the shipped bundle accepts its stamped map, which matches the bundle bytes', () => {
    const identity = shippedIdentity()!;
    const payload = createAdjacentMapReader({ runningBundlePath: REAL_BUNDLE })(REAL_BUNDLE) as { sources?: string[] } | null;
    expect(identity.size).toBe(statSync(REAL_BUNDLE).size);
    expect(identity.sha256).toBe(bundleDigest(readFileSync(REAL_BUNDLE)));
    expect(payload?.sources?.length).toBeGreaterThan(0);
  });

  it.skipIf(!existsSync(mapPath))('resolves a real position to its src/services path, with the 1-based column off-by-one pinned', () => {
    const payload = JSON.parse(readFileSync(mapPath, 'utf8')) as { sources: string[]; mappings: string };
    const segments = decodeSegments(payload);
    const index = segments.findIndex((segment, i) => (
      i > 0
      && segments[i - 1].line === segment.line
      && segments[i - 1].source !== segment.source
      && /(?:^|\/)src\/services\/sqlite\/SessionStore\.ts:/.test(segment.source)
      && /(?:^|\/)src\//.test(segments[i - 1].source)
    ));
    expect(index).toBeGreaterThan(0);
    const previous = segments[index - 1];
    const target = segments[index];
    const loadReal: MapLoader = path => (path === REAL_BUNDLE ? payload : null);

    const at = resolveFrame({ file: REAL_BUNDLE, line: target.line + 1, column: target.column + 1 }, loadReal);
    expect(at.mapped).toBe(true);
    expect(at.source).toBe('src/services/sqlite/SessionStore.ts');
    expect(at.display).toContain(`[worker-service.cjs:${target.line + 1}:${target.column + 1}]`);

    const one = resolveFrame({ file: REAL_BUNDLE, line: target.line + 1, column: target.column }, loadReal);
    expect(one.source).toBe(previous.source.replace(/^\.\.\/(?:\.\.\/)*/, '').replace(/:\d+:\d+$/, ''));
    expect(one.source).not.toBe(at.source);
  });
});

/** A site as `captureSite` makes it: the capture and the entry first, then the frames under test. */
function siteWithOwnFrames(stack: string): Error {
  const [header, ...frames] = stack.split('\n');
  const site = new Error('sql call site');
  site.stack = [
    header || 'Error',
    '    at captureSite (/r/src/services/sqlite/stack-source-map.ts:1:1)',
    '    at entry (/r/src/services/sqlite/slow-query-log.ts:2:2)',
    ...frames,
  ].join('\n');
  return site;
}

const selectCallerFrames = (stack: string, options: Parameters<typeof callersOfSite>[1] = {}) => callersOfSite(siteWithOwnFrames(stack), options);

describe('frames after the two own frames (through callersOfSite)', () => {
  it('names the application source even though every frame is in one minified bundle', () => {
    const stack = [
      'Error',
      `    at a (${BUNDLE}:1:1)`,
      `    at b (${BUNDLE}:1:11)`,
    ].join('\n');
    const { caller, callers } = selectCallerFrames(stack, { loadMap: loadTwoSourceMap });
    expect(caller).toContain('src/services/sqlite/SessionStore.ts');
    expect(caller).toContain('[worker-service.cjs:1:11]');
    expect(callers).toHaveLength(1);
    expect(callers.join('\n')).not.toContain('slow-query-log');
  });

  it('filters the logging modules by raw path when frames are TypeScript source, not test files', () => {
    const stack = [
      'Error',
      '    at slowQueryCallers (/r/src/services/sqlite/slow-query-log.ts:46:3)',
      '    at recordSqlBusy (/r/src/services/sqlite/sql-scope.ts:10:1)',
      '    at all (bun:sqlite:1:1)',
      '    at run (/r/tests/sqlite/slow-query-log.test.ts:20:5)',
      '    at fn (/r/src/services/worker/Thing.ts:9:9)',
    ].join('\n');
    const { caller, callers } = selectCallerFrames(stack, { loadMap: () => null });
    expect(caller).toContain('tests/sqlite/slow-query-log.test.ts');
    expect(callers).toHaveLength(2);
  });

  it('falls back to the first raw frames with the bundle position when nothing else is left', () => {
    const own = `/r/src/services/sqlite/slow-query-log.ts`;
    const stack = ['Error', `    at x (${own}:1:1)`, `    at y (${own}:2:2)`].join('\n');
    const { caller, callers } = selectCallerFrames(stack, { loadMap: () => null });
    expect(callers).toHaveLength(2);
    expect(caller).toBe(`x (${own}:1:1)`);
  });

  it('logs raw bundle frames with line and column when no map is available', () => {
    const stack = ['Error', `    at q (${BUNDLE}:15:704)`].join('\n');
    const { caller } = selectCallerFrames(stack, { loadMap: () => null });
    expect(caller).toBe(`q (${BUNDLE}:15:704)`);
  });

  it('keeps the first frames of an application-first bundle stack when no map is available', () => {
    const stack = [
      'Error',
      `    at app (${BUNDLE}:15:704)`,
      `    at later (${BUNDLE}:16:5)`,
      `    at last (${BUNDLE}:17:5)`,
      `    at beyond (${BUNDLE}:18:5)`,
    ].join('\n');
    const { caller, callers } = selectCallerFrames(stack, { loadMap: () => null });
    expect(caller).toBe(`app (${BUNDLE}:15:704)`);
    expect(callers).toEqual([`app (${BUNDLE}:15:704)`, `later (${BUNDLE}:16:5)`, `last (${BUNDLE}:17:5)`]);
    expect(selectCallerFrames(stack, { loadMap: () => { throw new Error('no map'); } }).caller).toBe(`app (${BUNDLE}:15:704)`);
  });

  it('keeps at most three frames, or the limit asked for, whether or not a map is available', () => {
    const stack = ['Error', ...Array.from({ length: 10 }, (_, i) => `    at f${i} (${BUNDLE}:1:${i + 1})`)].join('\n');
    expect(selectCallerFrames(stack, { loadMap: () => null }).callers).toHaveLength(3);
    expect(selectCallerFrames(stack, { loadMap: () => null, limit: 1 }).callers).toEqual([`f0 (${BUNDLE}:1:1)`]);
    expect(selectCallerFrames(stack, { loadMap: () => null, limit: 5 }).callers).toHaveLength(5);
  });

  it('does not take Bun native frames or node: internals for the application caller', () => {
    const stack = [
      'Error',
      `    at map (native:1:11)`,
      `    at processTicksAndRejections (native:7:39)`,
      `    at tick (node:internal/process/task_queues.js:95:5)`,
      `    at app (/r/src/services/worker/Thing.ts:9:9)`,
    ].join('\n');
    const { callers } = selectCallerFrames(stack, { loadMap: () => null });
    expect(callers).toEqual(['app (/r/src/services/worker/Thing.ts:9:9)']);
    expect(selectCallerFrames(stack, { loadMap: loadTwoSourceMap }).callers).toEqual(['app (/r/src/services/worker/Thing.ts:9:9)']);
    const nativeOnly = ['Error', '    at map (native:1:11)', `    at q (${BUNDLE}:15:704)`].join('\n');
    expect(selectCallerFrames(nativeOnly, { loadMap: () => null }).callers).toEqual([`q (${BUNDLE}:15:704)`]);
  });

  it('keeps source mapping when the only unmapped .js frames are runtime internals', () => {
    const stack = ['Error', `    at b (${BUNDLE}:1:11)`, '    at tick (node:internal/process/task_queues.js:95:5)'].join('\n');
    const { callers } = selectCallerFrames(stack, { loadMap: loadTwoSourceMap });
    expect(callers).toHaveLength(1);
    expect(callers[0]).toContain('src/services/sqlite/SessionStore.ts');
  });

  it('treats every instrumentation module as an own frame, including the SQL text helper', () => {
    expect(INSTRUMENTATION_MODULES).toContain('sql-text');
    for (const name of INSTRUMENTATION_MODULES) {
      const stack = ['Error', `    at helper (/r/src/services/sqlite/${name}.ts:1:1)`, '    at app (/r/src/services/worker/Thing.ts:9:9)'].join('\n');
      expect(selectCallerFrames(stack, { loadMap: () => null }).caller).toBe('app (/r/src/services/worker/Thing.ts:9:9)');
    }
  });

  it('reports unknown for an empty stack', () => {
    expect(selectCallerFrames('', { loadMap: () => null })).toEqual({ caller: 'unknown', callers: [] });
  });
});

describe('createCachedMapLoader', () => {
  it('reads each bundle once, caches a missing map, and reloads after idle eviction', () => {
    let time = 0;
    const reads: string[] = [];
    const timers: Array<() => void> = [];
    const loader = createCachedMapLoader({
      readPayload: path => {
        reads.push(path);
        return path.endsWith('a.cjs') ? { version: 3 } : null;
      },
      idleMs: 60_000,
      now: () => time,
      schedule: callback => {
        timers.push(callback);
        return { unref: () => {} };
      },
    });
    loader('/x/a.cjs');
    loader('/x/a.cjs');
    loader('/x/missing.cjs');
    loader('/x/missing.cjs');
    expect(reads).toEqual(['/x/a.cjs', '/x/missing.cjs']);

    time = 30_000;
    timers.shift()?.();
    loader('/x/a.cjs');
    expect(reads).toHaveLength(2);

    time = 200_000;
    timers.shift()?.();
    loader('/x/a.cjs');
    expect(reads).toEqual(['/x/a.cjs', '/x/missing.cjs', '/x/a.cjs']);
  });

  it('treats a read that throws as no map', () => {
    const loader = createCachedMapLoader({ readPayload: () => { throw new Error('bad json'); }, schedule: () => ({}) });
    expect(loader('/x/a.cjs')).toBeNull();
  });
});

describe('createAdjacentMapReader with a fake file system', () => {
  const MAP = `${BUNDLE}.map`;
  const BYTES = new TextEncoder().encode('bundle bytes');
  const DIGEST = bundleDigest(BYTES);
  const stampedPayload = (overrides: Record<string, unknown> = {}) => ({
    version: 3,
    sources: ['a.ts'],
    names: [],
    mappings: 'AAAA',
    [SOURCE_MAP_IDENTITY_KEY]: { size: BYTES.length, sha256: DIGEST },
    ...overrides,
  });
  const file = (overrides: Partial<FileStat> = {}): FileStat => ({ mtimeNs: 5_000n, ctimeNs: 5_000n, size: BYTES.length, ino: 7n, ...overrides });

  /** The map path reads as JSON text, the bundle path as its bytes; a path that has no stat is missing. */
  function fakeRead(path: string, payload: object, reads: string[]): Uint8Array {
    if (path === MAP) {
      reads.push(path);
      return new TextEncoder().encode(JSON.stringify(payload));
    }
    return BYTES;
  }

  function fakeFiles(stats: Record<string, FileStat | null>, payload: object = stampedPayload()) {
    const reads: string[] = [];
    const reader = createAdjacentMapReader({
      runningBundlePath: BUNDLE,
      stat: path => stats[path] ?? null,
      readFile: path => fakeRead(path, payload, reads),
    });
    return { reader, reads, stats };
  }

  it('reads the map while the bundle is the file that was loaded and the map carries its identity', () => {
    const { reader, reads } = fakeFiles({ [BUNDLE]: file(), [MAP]: file({ mtimeNs: 5_001n, size: 9 }) });
    expect((reader(BUNDLE) as { sources: string[] }).sources).toEqual(['a.ts']);
    expect(reader(BUNDLE)).not.toBeNull();
    expect(reads).toEqual([MAP, MAP]);
  });

  it('takes its snapshot when the reader is created, not at first use', () => {
    const stats: Record<string, FileStat | null> = { [BUNDLE]: file(), [MAP]: file() };
    const reader = createAdjacentMapReader({
      runningBundlePath: BUNDLE,
      stat: path => stats[path] ?? null,
      readFile: path => fakeRead(path, stampedPayload(), []),
    });
    stats[BUNDLE] = file({ ino: 8n, ctimeNs: 9_000n });
    expect(reader(BUNDLE)).toBeNull();
  });

  it('returns null, without reading the map, when size, mtime, ctime or inode differs from the loaded file', () => {
    const { reader, reads, stats } = fakeFiles({ [BUNDLE]: file(), [MAP]: file() });
    expect(reader(BUNDLE)).not.toBeNull();
    const before = reads.length;
    for (const changed of [{ size: BYTES.length + 1 }, { mtimeNs: 5_500n }, { ctimeNs: 5_500n }, { ino: 99n }]) {
      stats[BUNDLE] = file(changed);
      expect(reader(BUNDLE)).toBeNull();
    }
    expect(reads).toHaveLength(before);
  });

  it('returns null for a map with no identity, a wrong size, or a digest of different bytes', () => {
    const stats = { [BUNDLE]: file(), [MAP]: file() };
    const bare = { version: 3, sources: ['a.ts'], names: [], mappings: 'AAAA' };
    expect(fakeFiles(stats, bare).reader(BUNDLE)).toBeNull();
    expect(fakeFiles(stats, stampedPayload({ [SOURCE_MAP_IDENTITY_KEY]: { size: BYTES.length + 1, sha256: DIGEST } })).reader(BUNDLE)).toBeNull();
    expect(fakeFiles(stats, stampedPayload({ [SOURCE_MAP_IDENTITY_KEY]: { size: BYTES.length, sha256: bundleDigest(new TextEncoder().encode('other')) } })).reader(BUNDLE)).toBeNull();
  });

  it('is not the running bundle: another script path, a data file or no running bundle at all', () => {
    const stats = { [BUNDLE]: file(), [MAP]: file(), '/x/other.cjs': file(), '/x/data.json': file() };
    const { reader } = fakeFiles(stats);
    expect(reader('/x/other.cjs')).toBeNull();
    expect(reader('/x/data.json')).toBeNull();
    const notAScript = createAdjacentMapReader({ runningBundlePath: '/x/src/Thing.ts', stat: path => stats[path as keyof typeof stats] ?? null });
    expect(notAScript('/x/src/Thing.ts')).toBeNull();
    expect(createAdjacentMapReader({ runningBundlePath: null, stat: () => file() })(BUNDLE)).toBeNull();
  });

  it('returns null when the bundle changed after the process started, however its map is stamped', () => {
    const stats = { [BUNDLE]: file({ ctimeNs: 20_000_000_000n }), [MAP]: file() };
    const reader = createAdjacentMapReader({
      runningBundlePath: BUNDLE,
      processStartedAtMs: 10_000,
      stat: path => stats[path] ?? null,
      readFile: path => fakeRead(path, stampedPayload(), []),
    });
    expect(reader(BUNDLE)).toBeNull();
  });

  it('returns null for a missing bundle or a missing map, and for a map that is not JSON', () => {
    expect(fakeFiles({ [MAP]: file() }).reader(BUNDLE)).toBeNull();
    const missingMap = createAdjacentMapReader({
      runningBundlePath: BUNDLE,
      stat: path => (path === BUNDLE ? file() : null),
      readFile: path => {
        if (path === MAP) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
        return BYTES;
      },
    });
    expect(missingMap(BUNDLE)).toBeNull();
    const notJson = createAdjacentMapReader({
      runningBundlePath: BUNDLE,
      stat: path => (path === BUNDLE ? file() : null),
      readFile: path => (path === MAP ? new TextEncoder().encode('{not json') : BYTES),
    });
    expect(notJson(BUNDLE)).toBeNull();
  });

  it('reads the bundle for its digest once and keeps the digest while the bundle is the loaded file', () => {
    let byteReads = 0;
    const stats = { [BUNDLE]: file(), [MAP]: file() };
    const reader = createAdjacentMapReader({
      runningBundlePath: BUNDLE,
      stat: path => stats[path] ?? null,
      readFile: path => {
        if (path === MAP) return new TextEncoder().encode(JSON.stringify(stampedPayload()));
        byteReads++;
        return BYTES;
      },
    });
    expect(reader(BUNDLE)).not.toBeNull();
    expect(reader(BUNDLE)).not.toBeNull();
    expect(byteReads).toBe(1);
  });

  it('refuses when the bundle stat changes while its bytes are read', () => {
    const stats: Record<string, FileStat | null> = { [BUNDLE]: file(), [MAP]: file() };
    let swapDuringRead = true;
    const reader = createAdjacentMapReader({
      runningBundlePath: BUNDLE,
      stat: path => stats[path] ?? null,
      readFile: path => {
        if (path === MAP) return new TextEncoder().encode(JSON.stringify(stampedPayload()));
        if (swapDuringRead) stats[BUNDLE] = file({ ino: 99n, ctimeNs: 6_000n });
        return BYTES;
      },
    });
    expect(reader(BUNDLE)).toBeNull();
    swapDuringRead = false;
    stats[BUNDLE] = file();
    expect(reader(BUNDLE)).not.toBeNull();
  });

  it('re-checks the stat when the cached loader reloads after idle eviction', () => {
    const { reader, stats } = fakeFiles({ [BUNDLE]: file(), [MAP]: file() });
    let time = 0;
    const timers: Array<() => void> = [];
    const loader = createCachedMapLoader({
      readPayload: reader,
      idleMs: 60_000,
      now: () => time,
      schedule: callback => {
        timers.push(callback);
        return { unref: () => {} };
      },
    });
    expect(loader(BUNDLE)).not.toBeNull();
    stats[BUNDLE] = file({ ino: 99n });
    expect(loader(BUNDLE)).not.toBeNull();
    time = 200_000;
    timers.shift()?.();
    expect(loader(BUNDLE)).toBeNull();
  });
});

describe('stampSourceMapIdentity (the build step) feeding createAdjacentMapReader', () => {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'claude-mem-stamp-')));
  afterAll(() => rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 }));

  function buildPair(name: string, text: string): string {
    const path = join(directory, name);
    writeFileSync(path, text);
    writeFileSync(`${path}.map`, JSON.stringify({ version: 3, sources: ['a.ts'], names: [], mappings: 'AAAA' }));
    return path;
  }

  it('writes { size, sha256 } of the bundle under the key the runtime reads, and the default-shaped reader then accepts the map', () => {
    const path = buildPair('stamped.cjs', '// the bundle bytes');
    const reader = createAdjacentMapReader({ runningBundlePath: path, processStartedAtMs: Date.now() + 60_000 });
    expect(reader(path)).toBeNull();
    stampSourceMapIdentity(path);
    const stamped = JSON.parse(readFileSync(`${path}.map`, 'utf8')) as Record<string, { size: number; sha256: string }>;
    const bytes = readFileSync(path);
    expect(stamped[SOURCE_MAP_IDENTITY_KEY]).toEqual({ size: bytes.length, sha256: bundleDigest(bytes) });
    expect((createAdjacentMapReader({ runningBundlePath: path, processStartedAtMs: Date.now() + 60_000 })(path) as { sources: string[] }).sources).toEqual(['a.ts']);
  });

  it('stamps against the bytes on disk now: a map stamped for another build is refused', () => {
    const path = buildPair('other.cjs', '// build one');
    stampSourceMapIdentity(path);
    const stampedForOne = readFileSync(`${path}.map`);
    writeFileSync(path, '// build two!');
    writeFileSync(`${path}.map`, stampedForOne);
    expect(createAdjacentMapReader({ runningBundlePath: path, processStartedAtMs: Date.now() + 60_000 })(path)).toBeNull();
  });

  it('leaves a bundle with no map alone', () => {
    const path = join(directory, 'nomap.cjs');
    writeFileSync(path, '// no map');
    expect(() => stampSourceMapIdentity(path)).not.toThrow();
    expect(existsSync(`${path}.map`)).toBe(false);
  });
});

describe('createAdjacentMapReader on real files', () => {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'claude-mem-map-identity-')));
  afterAll(() => rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 }));
  const OLD_TIME = new Date('2020-01-01T00:00:00Z');
  let counter = 0;

  function writeBuild(path: string, text: string): void {
    const bytes = Buffer.from(text);
    writeFileSync(path, bytes);
    writeFileSync(`${path}.map`, JSON.stringify({
      version: 3, sources: [text], names: [], mappings: 'AAAA',
      [SOURCE_MAP_IDENTITY_KEY]: { size: bytes.length, sha256: bundleDigest(bytes) },
    }));
  }

  /** A stamped bundle that is "running", and the reader created at module-load time. */
  function runningBuild(text: string): { path: string; reader: (bundlePath: string) => object | null } {
    const dir = join(directory, `run-${counter++}`);
    mkdirSync(dir);
    const path = join(dir, 'worker.cjs');
    writeBuild(path, text);
    return { path, reader: createAdjacentMapReader({ runningBundlePath: path, processStartedAtMs: Date.now() + 60_000 }) };
  }

  it('accepts the bundle and map it was created for', () => {
    const { path, reader } = runningBuild('// build A, 1234');
    expect((reader(path) as { sources: string[] }).sources).toEqual(['// build A, 1234']);
  });

  it('rejects a newer build synced over both files with the OLD mtime preserved, after the process started', () => {
    const { path, reader } = runningBuild('// build A, 1234');
    expect(reader(path)).not.toBeNull();
    writeBuild(path, '// build B, 12345');
    utimesSync(path, OLD_TIME, OLD_TIME);
    utimesSync(`${path}.map`, OLD_TIME, OLD_TIME);
    expect(reader(path)).toBeNull();
  });

  it('rejects a same-size, different-content bundle replaced in place with mtime restored, even with a map stamped to match it', () => {
    const { path, reader } = runningBuild('// build A, 1234');
    const before = statSync(path, { bigint: true });
    writeBuild(path, '// build B, 1234');
    utimesSync(path, before.atime, before.mtime);
    utimesSync(`${path}.map`, OLD_TIME, OLD_TIME);
    expect(statSync(path, { bigint: true }).size).toBe(before.size);
    expect(Math.floor(statSync(path).mtimeMs)).toBe(Math.floor(Number(before.mtimeNs / 1_000_000n)));
    expect(reader(path)).toBeNull();
  });

  it('rejects a bundle swapped BEFORE the first use, because the snapshot predates it', () => {
    const { path, reader } = runningBuild('// build A, 1234');
    writeBuild(path, '// build B, 12345');
    utimesSync(path, OLD_TIME, OLD_TIME);
    expect(reader(path)).toBeNull();
  });

  it('rejects a newer map for the unchanged running bundle, including one stamped for another build', () => {
    const { path, reader } = runningBuild('// build A, 1234');
    const otherBytes = Buffer.from('// build B, 12345');
    writeFileSync(`${path}.map`, JSON.stringify({
      version: 3, sources: ['b'], names: [], mappings: 'AAAA',
      [SOURCE_MAP_IDENTITY_KEY]: { size: otherBytes.length, sha256: bundleDigest(otherBytes) },
    }));
    utimesSync(`${path}.map`, OLD_TIME, OLD_TIME);
    expect(reader(path)).toBeNull();
    const sameSizeOther = Buffer.from('// build C, 1234');
    writeFileSync(`${path}.map`, JSON.stringify({
      version: 3, sources: ['c'], names: [], mappings: 'AAAA',
      [SOURCE_MAP_IDENTITY_KEY]: { size: sameSizeOther.length, sha256: bundleDigest(sameSizeOther) },
    }));
    expect(reader(path)).toBeNull();
  });

  it('rejects a bundle and stamped map swapped in after the first stat and before the map is read, through the read seam', () => {
    const dir = join(directory, `run-${counter++}`);
    mkdirSync(dir);
    const path = join(dir, 'worker.cjs');
    writeBuild(path, '// build A, 1234');
    let swapped = 0;
    const reader = createAdjacentMapReader({
      runningBundlePath: path,
      processStartedAtMs: Date.now() + 60_000,
      readFile: target => {
        if (target.endsWith('.map') && swapped === 0) {
          swapped++;
          writeBuild(path, '// build B, 1234');
          utimesSync(path, OLD_TIME, OLD_TIME);
        }
        return readFileSync(target);
      },
    });
    expect(reader(path)).toBeNull();
    expect(swapped).toBe(1);
    expect(JSON.parse(readFileSync(`${path}.map`, 'utf8'))[SOURCE_MAP_IDENTITY_KEY].sha256).toBe(bundleDigest(readFileSync(path)));
  });

  it('rejects a bundle and stamped map swapped between the map read and the digest read', () => {
    const dir = join(directory, `run-${counter++}`);
    mkdirSync(dir);
    const path = join(dir, 'worker.cjs');
    writeBuild(path, '// build A, 1234');
    let bundleReads = 0;
    const reader = createAdjacentMapReader({
      runningBundlePath: path,
      processStartedAtMs: Date.now() + 60_000,
      readFile: target => {
        if (target === path && bundleReads++ === 0) {
          writeBuild(path, '// build B, 1234');
          utimesSync(path, OLD_TIME, OLD_TIME);
        }
        return readFileSync(target);
      },
    });
    expect(reader(path)).toBeNull();
    expect(bundleReads).toBe(1);
  });

  it('returns null for a bundle with an unstamped map', () => {
    const dir = join(directory, `run-${counter++}`);
    mkdirSync(dir);
    const path = join(dir, 'worker.cjs');
    writeFileSync(path, '// build A');
    writeFileSync(`${path}.map`, JSON.stringify({ version: 3, sources: ['a'], names: [], mappings: 'AAAA' }));
    expect(createAdjacentMapReader({ runningBundlePath: path, processStartedAtMs: Date.now() + 60_000 })(path)).toBeNull();
  });
});

describe('captureSite and callersOfSite', () => {
  /** Real functions with minifier-style names: the entry (Zq) calls captureSite directly, as the contract says. */
  let entries = 0;
  /** The capture result is used after the call, which is what keeps the entry's frame off the tail-call path. */
  function Zq(): Error {
    const site = captureSite();
    entries++;
    return site;
  }
  let applicationCalls = 0;
  function appFrame(): Error {
    const site = Zq();
    applicationCalls++;
    return site;
  }

  const rawFrames = (site: Error): string[] => (site.stack ?? '').split('\n').filter(line => /^\s*at /.test(line));

  it('pins SITE_OWN_FRAMES on the raw, unfiltered stack: the capture and the entry come first, the caller after them', () => {
    const lines = rawFrames(appFrame());
    expect(SITE_OWN_FRAMES).toBe(2);
    expect(lines[0]).toContain('captureSite');
    expect(lines[1]).toContain('Zq');
    expect(lines[SITE_OWN_FRAMES]).toContain('appFrame');
    expect(entries).toBeGreaterThan(0);
  });

  it('drops the capture frame and the entry by position, so a minified chain leaves the application frame first', () => {
    const site = appFrame();
    const { caller, callers } = callersOfSite(site, { limit: 1, loadMap: () => null });
    expect(caller).toStartWith('appFrame (');
    expect(caller).toContain('stack-source-map.test.ts');
    expect(callers).toHaveLength(1);
    expect(callersOfSite(site, { loadMap: () => null }).callers[0]).toBe(caller);
    for (const own of ['captureSite', 'Zq (']) expect(caller).not.toContain(own);
  });

  it('takes a handed site once, and clears it after the call', () => {
    const site = new Error('handed');
    expect(withHandedSite(site, () => takeHandedSite())).toBe(site);
    expect(takeHandedSite()).toBeUndefined();
    withHandedSite(site, () => undefined);
    expect(takeHandedSite()).toBeUndefined();
    expect(() => withHandedSite(site, () => { throw new Error('boom'); })).toThrow('boom');
    expect(takeHandedSite()).toBeUndefined();
  });

  it('counts stack lines, so an unparsable line cannot shift the application frame', () => {
    const site = new Error('x');
    site.stack = [
      'Error: x',
      '    at captureSite (/r/src/services/sqlite/stack-source-map.ts:1:1)',
      '    at <anonymous>',
      '    at app (/r/src/services/worker/Thing.ts:9:9)',
    ].join('\n');
    expect(callersOfSite(site, { limit: 1, loadMap: () => null }).caller).toBe('app (/r/src/services/worker/Thing.ts:9:9)');
  });

  it('reports unknown, not another frame, when there is no stack', () => {
    const site = new Error('x');
    site.stack = '';
    expect(callersOfSite(site, { loadMap: () => null })).toEqual({ caller: 'unknown', callers: [] });
  });

  it('restores Error.stackTraceLimit', () => {
    const previous = Error.stackTraceLimit;
    captureSite();
    expect(Error.stackTraceLimit).toBe(previous);
  });
});

describe('SLOW_QUERY through the real capture chain', () => {
  function slowDatabase(): { db: Database; logged: SlowQueryContext[] } {
    const logged: SlowQueryContext[] = [];
    const db = instrumentSlowQueries(new Database(':memory:'), { thresholdMs: -1, warn: (_m, context) => { logged.push(context); } });
    return { db, logged };
  }

  function issueFromApp(db: Database): void {
    db.query('SELECT 1 AS one').all();
  }

  it('names the calling test frame and none of the instrumentation, for every statement entry point', () => {
    const { db, logged } = slowDatabase();
    issueFromApp(db);
    db.run('SELECT 2');
    db.exec('SELECT 3');
    const statement = db.prepare('SELECT 4 AS four');
    statement.get();
    for (const row of statement.iterate()) void row;
    expect(logged.map(entry => entry.op)).toEqual(['query', 'all', 'db.run', 'db.exec', 'prepare', 'get', 'iterate']);
    for (const entry of logged) {
      expect(entry.caller).toContain('stack-source-map.test.ts');
      expect(entry.callers?.join('\n')).not.toMatch(/slow-query-log|stack-source-map\.ts|sql-scope|slowQuery/);
    }
    const all = logged.find(entry => entry.op === 'all');
    expect(all?.caller).toStartWith('issueFromApp (');
    db.close();
  });
});

describe('the minified worker bundle shape', () => {
  const ROOT = join(import.meta.dir, '..', '..');
  const SQLITE = join(ROOT, 'src', 'services', 'sqlite');
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'claude-mem-minified-callers-')));
  afterAll(() => rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 }));

  /**
   * Each `run(label, fn)` records the statements' SlowQueryContexts and a probe stack that the app
   * function took itself, so the caller can be compared with a frame the application really owns.
   * `// @site:NAME` marks the line a caller must resolve to.
   */
  const ENTRY = `
import { Database } from 'bun:sqlite';
import { instrumentSlowQueries } from '${SQLITE}/slow-query-log.ts';
import { runWithSqlScope } from '${SQLITE}/sql-scope.ts';
import { pageMatchingRows, streamRows } from '${SQLITE}/stream-rows.ts';
let sink = [];
const db = instrumentSlowQueries(new Database(':memory:'), { thresholdMs: -1, warn: (_message, context) => sink.push(context) });
const out = {};
function run(label, fn) {
  sink = [];
  const probe = fn();
  out[label] = { probe, contexts: sink };
}
function appQuery() {
  const probe = new Error('probe').stack;
  db.query('SELECT 1 AS x').all(); // @site:query
  return probe;
}
function appStream() {
  const probe = new Error('probe').stack;
  for (const row of streamRows(db.prepare('SELECT 2 AS x'))) void row; // @site:stream
  return probe;
}
function appPage() {
  const probe = new Error('probe').stack;
  pageMatchingRows(db.prepare('SELECT 3 AS x'), [], () => true, { limit: 5 }); // @site:page
  return probe;
}
function appIterate() {
  const probe = new Error('probe').stack;
  for (const row of db.prepare('SELECT 4 AS x').iterate()) void row; // @site:iterate
  return probe;
}
class AppRepo {
  constructor(handle) { this.handle = handle; this.reads = 0; }
  tail() {
    return this.handle.query('SELECT 5 AS x').all(); // @site:tail-method
  }
  nonTail() {
    const rows = this.handle.query('SELECT 6 AS x').all(); // @site:non-tail-method
    this.reads += rows.length;
    return rows;
  }
}
const repo = new AppRepo(db);
function callsTail() {
  const probe = new Error('probe').stack;
  const rows = repo.tail(); // @site:tail-caller
  return rows.length ? probe : probe;
}
function callsNonTail() {
  const probe = new Error('probe').stack;
  const rows = repo.nonTail();
  return rows.length ? probe : probe;
}
run('query', appQuery);
run('stream', appStream);
run('page', appPage);
run('iterate', appIterate);
run('tail', callsTail);
run('nonTail', callsNonTail);
const scoped = [];
runWithSqlScope('scope', () => {
  db.query('SELECT 7 AS y').all(); // @site:scoped
}, { thresholdMs: -1, warn: (_message, context) => scoped.push(context) });
out.scoped = scoped;
console.log(JSON.stringify(out));
`;
  const siteLine = (name: string): number => ENTRY.split('\n').findIndex(line => line.includes(`// @site:${name}`)) + 1;

  interface RunOutput {
    [label: string]: { probe: string; contexts: SlowQueryContext[] } | Array<{ top: Array<{ caller?: string }> }>;
  }
  interface Built { raw: RunOutput; mapped: RunOutput; map: object; bundle: string }

  async function runBundle(bundle: string): Promise<RunOutput> {
    const run = Bun.spawnSync([process.execPath, bundle], { env: { ...process.env } });
    expect(run.stderr.toString()).not.toContain('error:');
    expect(run.exitCode).toBe(0);
    return JSON.parse(run.stdout.toString().trim().split('\n').pop() ?? '{}');
  }

  let built: Promise<Built> | undefined;
  /** Bundled once; run first with the build's unstamped map (no usable map), then stamped as build-hooks does (the default loader maps). */
  function bundleAndRun(): Promise<Built> {
    built ??= (async () => {
      const { build } = await import('esbuild');
      writeFileSync(join(directory, 'entry.js'), ENTRY);
      const bundle = join(directory, 'bundle.cjs');
      await build({
        entryPoints: [join(directory, 'entry.js')], bundle: true, platform: 'node', format: 'cjs', outfile: bundle,
        minify: true, sourcemap: true, sourcesContent: false, external: ['bun:sqlite'], logLevel: 'error',
      });
      const raw = await runBundle(bundle);
      stampSourceMapIdentity(bundle);
      const mapped = await runBundle(bundle);
      return { raw, mapped, map: JSON.parse(readFileSync(`${bundle}.map`, 'utf8')), bundle };
    })();
    return built;
  }

  const contextsOf = (output: RunOutput, label: string) => (output[label] as { probe: string; contexts: SlowQueryContext[] });
  const firstFrame = (stack: string) => stack.split('\n').map(parseStackFrame).filter(frame => frame !== null)[0]!;
  const originalLine = (text: string | undefined): number => Number(/entry\.js:(\d+):\d+/.exec(text ?? '')?.[1]);

  it('names the application function from raw bundle frames with no map, and resolves to the app source through the map', async () => {
    const { raw, map, bundle } = await bundleAndRun();
    const { probe, contexts } = contextsOf(raw, 'query');
    const probeFrame = firstFrame(probe);
    expect(probeFrame.file).toBe(bundle);
    expect(contexts.map(entry => entry.op)).toEqual(['query', 'all']);
    const loadMap: MapLoader = path => (path === bundle ? map : null);
    for (const entry of contexts) {
      const frame = parseStackFrame(`    at ${entry.caller}`)!;
      expect(frame.file).toBe(bundle);
      expect(frame.line).toBe(probeFrame.line);
      expect(Math.abs(frame.column - probeFrame.column)).toBeLessThan(200);
      expect(resolveFrame(frame, loadMap).source).toMatch(/entry\.js$/);
      expect(entry.callers?.join('\n')).not.toMatch(/slow-query-log|sql-scope/);
    }
  }, 60_000);

  it('names the application function for iterate through streamRows and pageMatchingRows, not the helper, with no map', async () => {
    const { raw, map, bundle } = await bundleAndRun();
    const loadMap: MapLoader = path => (path === bundle ? map : null);
    for (const label of ['stream', 'page', 'iterate']) {
      const { probe, contexts } = contextsOf(raw, label);
      const probeFrame = firstFrame(probe);
      const iterate = contexts.find(entry => entry.op === 'iterate');
      expect(iterate).toBeDefined();
      const frame = parseStackFrame(`    at ${iterate!.caller}`)!;
      expect(frame.file).toBe(bundle);
      expect(frame.line).toBe(probeFrame.line);
      expect(Math.abs(frame.column - probeFrame.column)).toBeLessThan(200);
      const resolved = resolveFrame(frame, loadMap);
      expect(resolved.source).toMatch(/entry\.js$/);
      expect(resolved.source).not.toMatch(/stream-rows/);
    }
  }, 60_000);

  it('maps callers through the default loader once the build has stamped the map, never to an instrumentation module', async () => {
    const { mapped } = await bundleAndRun();
    const expectedLine: Record<string, number> = { query: siteLine('query'), stream: siteLine('stream'), page: siteLine('page'), iterate: siteLine('iterate') };
    for (const label of Object.keys(expectedLine)) {
      const { contexts } = contextsOf(mapped, label);
      expect(contexts.length).toBeGreaterThan(0);
      for (const entry of contexts.filter(context => context.op !== 'prepare')) {
        expect(entry.caller).toContain('entry.js');
        expect(entry.caller).toMatch(/\[bundle\.cjs:\d+:\d+\]/);
        expect(entry.callers?.join('\n')).not.toMatch(/slow-query-log|sql-scope|stream-rows|stack-source-map/);
        expect(originalLine(entry.caller)).toBe(expectedLine[label]);
      }
    }
  }, 60_000);

  it('names the application function for a hot key in a SQL scope, raw with no map and mapped with the stamped one', async () => {
    const { raw, mapped, map, bundle } = await bundleAndRun();
    const scopedOf = (output: RunOutput) => output.scoped as Array<{ top: Array<{ caller?: string }> }>;
    expect(scopedOf(raw)).toHaveLength(1);
    const rawCaller = parseStackFrame(`    at ${scopedOf(raw)[0].top[0].caller}`);
    expect(rawCaller?.file).toBe(bundle);
    expect(resolveFrame(rawCaller!, path => (path === bundle ? map : null)).source).toMatch(/entry\.js$/);
    expect(originalLine(scopedOf(mapped)[0].top[0].caller)).toBe(siteLine('scoped'));
  }, 60_000);

  it('pins a strict class method that ends in a tail call: the logged caller is the method\'s caller; using the result afterwards keeps the method', async () => {
    const { mapped } = await bundleAndRun();
    const tail = contextsOf(mapped, 'tail').contexts.find(entry => entry.op === 'all')!;
    const nonTail = contextsOf(mapped, 'nonTail').contexts.find(entry => entry.op === 'all')!;
    expect(originalLine(nonTail.caller)).toBe(siteLine('non-tail-method'));
    expect(originalLine(tail.caller)).toBe(siteLine('tail-caller'));
    expect(originalLine(tail.caller)).not.toBe(siteLine('tail-method'));
  }, 60_000);
});

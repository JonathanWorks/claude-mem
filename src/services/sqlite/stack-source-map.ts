import { readFileSync, statSync } from 'node:fs';
import { SourceMap } from 'node:module';
import { createHash } from 'node:crypto';
import { basename, resolve } from 'node:path';
import { logger } from '../../utils/logger.js';
import type { Unrefable } from './timer-handle.js';

/**
 * Names the application frame behind a slow statement. The worker ships as one
 * minified bundle, so a raw frame is `a.b (worker-service.cjs:15:704)`: no
 * function name and no file worth filtering on. Bun 1.3.8 implements
 * node:module SourceMap, so each frame is resolved through the bundle's adjacent
 * `.map` file at log time, and the own-frame filter then runs on the MAPPED
 * source path. The instrumentation's own leading frames are dropped by position
 * (see `captureSite`), so they never reach the filter. When no map is available
 * the first raw frames are logged with their bundle name, line and column.
 *
 * Offline, the same resolution for a logged `[worker-service.cjs:L:C]` is:
 *   bun -e 'const {SourceMap}=require("node:module");
 *     const m=new SourceMap(JSON.parse(require("fs").readFileSync("plugin/scripts/worker-service.cjs.map","utf8")));
 *     process.stdout.write(JSON.stringify(m.findEntry(L-1,C-1)))'
 */

export interface StackFrame {
  fn?: string;
  file: string;
  line: number;
  column: number;
}

export type MapLoader = (bundlePath: string) => object | null;

export interface ResolvedFrame {
  display: string;
  /** The mapped source path when mapped, else the raw file path; what the own-frame filter reads. */
  source: string;
  mapped: boolean;
  /** False when no usable source map was available for the frame's file (as opposed to a position the map does not cover). */
  mapAvailable: boolean;
}

const SITE_STACK_LIMIT = 16;
/** Frames above the caller in a call site: captureSite itself and the instrumentation entry that called it. */
export const SITE_OWN_FRAMES = 2;
const DEFAULT_CALLER_FRAMES = 3;
const CALLER_LOG_LIMIT = 240;
const MAP_IDLE_MS = 60_000;
const FRAME_PATTERN = /^\s*at (?:async )?(?:(.*?) \()?(.+?):(\d+):(\d+)\)?\s*$/;
const FRAME_LINE = /^\s*at /;
const BUNDLE_PATTERN = /\.(?:c|m)?js$/;

/** The key `scripts/build-hooks.js` stamps into every bundle's source map: `{ size, sha256 }` of the bundle it describes. */
export const SOURCE_MAP_IDENTITY_KEY = 'x_claudeMemBundle';

/** Runtime frames that are never the application: bun:, node:, node:internal and Bun's `native` pseudo-file. */
const INTERNAL_RUNTIME = /^(?:bun|node):|node:internal|^native(?::|$)|\(native\)/;

/**
 * The src/services/sqlite modules that sit between a statement and its caller.
 * A new helper in that chain goes here, or a mapped stack reports it as the caller.
 */
export const INSTRUMENTATION_MODULES = [
  'slow-query-log',
  'stream-rows',
  'sql-scope',
  'sql-text',
  'open-database',
  'stack-source-map',
  'event-loop-lag',
  'threshold-env',
] as const;

const OWN_SOURCE = new RegExp(
  `(?:^|/)src/services/sqlite/(?:${INSTRUMENTATION_MODULES.join('|')})\\.|${INTERNAL_RUNTIME.source}`,
);

/**
 * An Error whose stack names the application frame behind a statement, taken
 * where the statement enters the instrumentation. Call it directly from the
 * entry function, as a statement whose result is used afterwards: the stack is
 * then `captureSite`, the entry, the caller, in that order, whatever the
 * functions are called. The shipped worker bundle is minified, so no function
 * name can identify the instrumentation's own frames; their count, fixed by this
 * contract, does (`callersOfSite` drops exactly SITE_OWN_FRAMES). The entry's
 * frame is the executing frame, so tail-call elimination cannot remove it.
 *
 * Known limit, accepted: JavaScriptCore performs proper tail calls in strict
 * code, and a class body is always strict. A method that ends in
 * `return this.db.query(sql).all()` therefore leaves no frame of its own, and the
 * logged caller is the method's caller (the grandparent). Using the result after the
 * call (`const rows = ...all(); count += rows.length; return rows`) keeps the method's
 * frame; `const rows = ...all(); return rows` does not, because the minifier folds it back
 * into a tail call. The hot call sites are left as they are. The behavior is pinned in
 * tests/sqlite/stack-source-map.test.ts ("a strict class method ...").
 *
 * A helper that sits between the application and the instrumentation entry (today
 * only `streamRows` and `pageMatchingRows`) captures its own site and hands it to the
 * entry with `withHandedSite`, so the two dropped frames are still the capture and the
 * frame that called it. An entry reads the handed site with `takeHandedSite`.
 */
export function captureSite(): Error {
  const previous = Error.stackTraceLimit;
  Error.stackTraceLimit = SITE_STACK_LIMIT;
  try {
    return new Error('sql call site');
  } finally {
    Error.stackTraceLimit = previous;
  }
}

let handedSite: Error | undefined;

/** Run `call` with `site` available, for the instrumentation entry it calls synchronously, to `takeHandedSite`. */
export function withHandedSite<T>(site: Error, call: () => T): T {
  handedSite = site;
  try {
    return call();
  } finally {
    handedSite = undefined;
  }
}

/** The site handed by the helper that is calling this entry right now, if any; each hand-off is taken once. */
export function takeHandedSite(): Error | undefined {
  const site = handedSite;
  handedSite = undefined;
  return site;
}

export function parseStackFrame(line: string): StackFrame | null {
  const match = FRAME_PATTERN.exec(line);
  if (!match) return null;
  const [, fn, file, lineNumber, columnNumber] = match;
  return { fn: fn || undefined, file, line: Number(lineNumber), column: Number(columnNumber) };
}

export interface CachedMapLoaderOptions {
  readPayload?: (bundlePath: string) => object | null;
  idleMs?: number;
  now?: () => number;
  schedule?: (callback: () => void, delayMs: number) => Unrefable;
}

/** What identifies a file on disk. `utimes` can restore mtime but never ctime or inode, so those are compared too. */
export interface FileStat {
  size: number;
  /** Nanoseconds: Bun's millisecond fields are truncated, and a swap within one millisecond must still differ. */
  mtimeNs: bigint;
  ctimeNs: bigint;
  ino: bigint;
}

export type StatFile = (path: string) => FileStat | null;

export interface AdjacentMapReaderOptions {
  /** The bundle this process is running; default is this module's own file when that is a script. Its stat is taken NOW. */
  runningBundlePath?: string | null;
  stat?: StatFile;
  /** The one read seam: the bundle (hashed) and its map (parsed as UTF-8 JSON) both come through it. */
  readFile?: (path: string) => Uint8Array;
  /** When this process began. A bundle whose inode changed after that is not what the process loaded. */
  processStartedAtMs?: number;
}

function defaultStat(path: string): FileStat | null {
  try {
    const { mtimeNs, ctimeNs, size, ino } = statSync(path, { bigint: true });
    return { mtimeNs, ctimeNs, size: Number(size), ino };
  } catch {
    return null;
  }
}

function sameFile(a: FileStat, b: FileStat): boolean {
  return a.size === b.size && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs && a.ino === b.ino;
}

export function bundleDigest(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** The file this module was loaded from: frame 0 of a stack taken during module evaluation. */
function ownFilePath(): string | null {
  const first = (new Error().stack ?? '').split('\n').filter(line => FRAME_LINE.test(line))[0];
  return (first && parseStackFrame(first)?.file) || null;
}

interface MapIdentity {
  size?: unknown;
  sha256?: unknown;
}

/**
 * Reads `<bundle>.map` only while it provably describes the code this process
 * loaded. A rebuild-and-sync replaces both files under a running worker, and the
 * sync can preserve mtimes, so neither mtime nor "newer than process start" is an
 * identity. The binding is made of three parts:
 *  1. the running bundle's stat, taken when the reader is created (module load for
 *     the production reader), never at first use: a swap before the first slow
 *     statement is still a swap;
 *  2. a later stat that differs in size, mtime, ctime or inode means the file is
 *     no longer the one that was loaded (a `utimes` can restore mtime, not ctime),
 *     and a ctime after process start means the snapshot itself was taken from a
 *     file written after the code loaded (a lazily initialized module);
 *  3. the map must carry the build identity `{ size, sha256 }` that the build
 *     stamps into it (SOURCE_MAP_IDENTITY_KEY), and both must equal the loaded
 *     bundle's size and the digest of its bytes. The digest is taken lazily, so the
 *     bundle is stat'ed again after its bytes were read: a bundle (and a map stamped
 *     for it) swapped in during the read fails that stat and is never cached.
 * Anything else returns null and frames are logged raw.
 */
export function createAdjacentMapReader(options: AdjacentMapReaderOptions = {}): (bundlePath: string) => object | null {
  const stat = options.stat ?? defaultStat;
  const readFile = options.readFile ?? ((path: string) => readFileSync(path));
  const printedPath = options.runningBundlePath === undefined ? ownFilePath() : options.runningBundlePath;
  const runningPath = printedPath && BUNDLE_PATTERN.test(printedPath) ? resolve(printedPath) : null;
  const startedAtMs = options.processStartedAtMs ?? Date.now() - process.uptime() * 1000;
  const first = runningPath ? stat(runningPath) : null;
  const loaded = first && Number(first.ctimeNs / 1_000_000n) <= startedAtMs ? first : null;
  let digest: string | undefined;

  const unmapped = (reason: string, bundlePath: string): null => {
    logger.debug('DB', `Source map not used: ${reason}`, { bundlePath });
    return null;
  };

  const readMap = (path: string): Record<string, unknown> | null => {
    try {
      return JSON.parse(new TextDecoder().decode(readFile(path))) as Record<string, unknown>;
    } catch {
      return null;
    }
  };

  return (bundlePath: string): object | null => {
    if (!runningPath || !loaded || resolve(bundlePath) !== runningPath) {
      return unmapped('not the bundle this process loaded', bundlePath);
    }
    const current = stat(runningPath);
    if (!current || !sameFile(current, loaded)) return unmapped('bundle changed on disk since this process loaded it', bundlePath);
    const payload = readMap(`${runningPath}.map`);
    if (!payload) return unmapped('no readable map next to the bundle', bundlePath);
    const identity = payload[SOURCE_MAP_IDENTITY_KEY] as MapIdentity | undefined;
    if (!identity || identity.size !== loaded.size) return unmapped('map carries no build identity for this bundle', bundlePath);
    if (digest === undefined) {
      const measured = bundleDigest(readFile(runningPath));
      const after = stat(runningPath);
      if (!after || !sameFile(after, loaded)) return unmapped('bundle changed while its digest was taken', bundlePath);
      digest = measured;
    }
    if (identity.sha256 !== digest) return unmapped('map was built for a different bundle', bundlePath);
    return payload;
  };
}

const readAdjacentMap = createAdjacentMapReader();

/**
 * Per-bundle map cache. A missing or unreadable map is cached as null. The cache
 * is dropped after `idleMs` without use so a worker that rarely logs a slow
 * statement does not keep tens of MB of mappings resident; the timer is unref'd.
 */
export function createCachedMapLoader(options: CachedMapLoaderOptions = {}): MapLoader & { clear(): void } {
  const readPayload = options.readPayload ?? readAdjacentMap;
  const idleMs = options.idleMs ?? MAP_IDLE_MS;
  const now = options.now ?? (() => Date.now());
  const schedule = options.schedule ?? ((callback, delayMs) => setTimeout(callback, delayMs));
  const cache = new Map<string, object | null>();
  let lastUsedAt = 0;
  let timerArmed = false;

  const clear = (): void => {
    cache.clear();
  };

  const arm = (): void => {
    if (timerArmed) return;
    timerArmed = true;
    const timer = schedule(() => {
      timerArmed = false;
      if (cache.size === 0) return;
      if (now() - lastUsedAt >= idleMs) clear();
      else arm();
    }, idleMs);
    timer.unref?.();
  };

  const load = ((bundlePath: string): object | null => {
    lastUsedAt = now();
    if (cache.has(bundlePath)) return cache.get(bundlePath) ?? null;
    let payload: object | null = null;
    try {
      payload = readPayload(bundlePath);
    } catch (error) {
      logger.debug('DB', 'Source map unreadable; slow-query callers stay unmapped', { bundlePath }, error instanceof Error ? error : new Error(String(error)));
      payload = null;
    }
    cache.set(bundlePath, payload);
    arm();
    return payload;
  }) as MapLoader & { clear(): void };
  load.clear = clear;
  return load;
}

/** findEntry returns an empty object for a position the map does not cover. */
interface MappedEntry {
  originalSource?: string;
  originalLine?: number;
  originalColumn?: number;
  name?: string;
}

const defaultLoadMap = createCachedMapLoader();
const sourceMaps = new WeakMap<object, SourceMap | null>();

function sourceMapFor(payload: object): SourceMap | null {
  if (sourceMaps.has(payload)) return sourceMaps.get(payload) ?? null;
  let map: SourceMap | null = null;
  try {
    map = typeof SourceMap === 'function' ? new SourceMap(payload as ConstructorParameters<typeof SourceMap>[0]) : null;
  } catch {
    map = null;
  }
  sourceMaps.set(payload, map);
  return map;
}

function normalizeMappedSource(source: string): string {
  return source.replace(/^(?:\.\.\/)+/, '');
}

function rawDisplay(frame: StackFrame): string {
  const location = `${frame.file}:${frame.line}:${frame.column}`;
  return frame.fn ? `${frame.fn} (${location})` : location;
}

export function resolveFrame(frame: StackFrame, loadMap: MapLoader = defaultLoadMap): ResolvedFrame {
  const noMap: ResolvedFrame = { display: rawDisplay(frame), source: frame.file, mapped: false, mapAvailable: false };
  if (INTERNAL_RUNTIME.test(frame.file)) return noMap;
  let payload: object | null;
  try {
    payload = loadMap(frame.file);
  } catch {
    return noMap;
  }
  if (!payload) return noMap;
  const map = sourceMapFor(payload);
  if (!map) return noMap;
  const unmapped: ResolvedFrame = { ...noMap, mapAvailable: true };
  const entry = map.findEntry(frame.line - 1, frame.column - 1) as MappedEntry;
  if (typeof entry?.originalSource !== 'string' || typeof entry.originalLine !== 'number') return unmapped;
  const source = normalizeMappedSource(entry.originalSource);
  const name = entry.name || frame.fn;
  const original = `${source}:${entry.originalLine + 1}:${(entry.originalColumn ?? 0) + 1}`;
  const bundle = `[${basename(frame.file)}:${frame.line}:${frame.column}]`;
  return { display: `${name ? `${name} ` : ''}(${original}) ${bundle}`, source, mapped: true, mapAvailable: true };
}

export interface CallerFrameOptions {
  loadMap?: MapLoader;
  limit?: number;
}

function collectFrames(frames: StackFrame[], limit: number, display: (frame: StackFrame) => string | null): string[] {
  const kept: string[] = [];
  for (const frame of frames) {
    if (kept.length >= limit) break;
    const text = display(frame);
    if (text !== null) kept.push(text.slice(0, CALLER_LOG_LIMIT));
  }
  return kept;
}

/**
 * The application frames among `frames`, nearest first. A frame is dropped
 * when its source, after mapping, is one of the instrumentation modules or a
 * runtime internal. A bundle frame with no usable map keeps its raw name, line and
 * column (its path never names a source file, so nothing can be filtered on it).
 * If every frame was dropped the first non-runtime raw frames are returned instead.
 */
function selectFrom(frames: StackFrame[], options: CallerFrameOptions): { caller: string; callers: string[] } {
  const limit = options.limit ?? DEFAULT_CALLER_FRAMES;
  let kept = collectFrames(frames, limit, frame => {
    const resolved = resolveFrame(frame, options.loadMap);
    return OWN_SOURCE.test(resolved.source) ? null : resolved.display;
  });
  if (kept.length === 0) {
    kept = collectFrames(frames, limit, frame => (INTERNAL_RUNTIME.test(frame.file) ? null : rawDisplay(frame)));
  }
  return { caller: kept[0] ?? 'unknown', callers: kept };
}

function parseFrames(lines: string[]): StackFrame[] {
  return lines.map(parseStackFrame).filter((frame): frame is StackFrame => frame !== null);
}

/**
 * Callers from an Error made by `captureSite`: the two leading frames (captureSite
 * and the instrumentation entry) are dropped by position, then the rest is
 * filtered. Frames are counted as stack lines, so an unparsable line cannot shift
 * the count.
 */
export function callersOfSite(site: Error, options: CallerFrameOptions = {}): { caller: string; callers: string[] } {
  const lines = (site.stack ?? '').split('\n').filter(line => FRAME_LINE.test(line));
  return selectFrom(parseFrames(lines.slice(SITE_OWN_FRAMES)), options);
}

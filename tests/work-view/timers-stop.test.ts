import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AutoRefreshWorker } from '../../src/services/work-view/auto-refresh-worker.mjs';
import { HumanCopyWorker } from '../../src/services/work-view/human-copy-worker.mjs';

const NEEDS = { due: 0, ungrouped: 0, goalsStale: false, unplaced: 0, otherChanged: false, needed: false };
const settle = () => new Promise<void>(resolve => setTimeout(resolve, 20));

describe('HumanCopyWorker stop and start', () => {
  const workers: HumanCopyWorker[] = [];
  afterEach(() => workers.splice(0).forEach(worker => worker.close()));

  function pumpCounter(): { worker: HumanCopyWorker; pumps: () => number } {
    const worker = new HumanCopyWorker({ provider: null, cachePath: null, warn: () => {} });
    workers.push(worker);
    let pumped = 0;
    worker.pump = () => { pumped++; };
    return { worker, pumps: () => pumped };
  }

  it('stop() ends the pump without closing, and start() resumes it', async () => {
    const realSetInterval = globalThis.setInterval;
    const intervals: Array<() => void> = [];
    globalThis.setInterval = ((handler: () => void) => { intervals.push(handler); return realSetInterval(() => {}, 1_000_000); }) as never;
    try {
      const { worker } = pumpCounter();
      worker.start();
      worker.start();
      expect(intervals.length).toBe(1);
      worker.stop();
      worker.start();
      expect(intervals.length).toBe(2);
    } finally { globalThis.setInterval = realSetInterval; }
  });

  it('keeps its cache and queue across a stop, which close() clears', () => {
    const { worker } = pumpCounter();
    (worker as unknown as { cache: Map<string, unknown> }).cache.set('request-one', { fingerprint: 'x' });
    (worker as unknown as { pending: Map<string, unknown> }).pending.set('request-two', { id: 'request-two' });
    worker.start();
    worker.stop();
    expect((worker as unknown as { cache: Map<string, unknown> }).cache.size).toBe(1);
    expect((worker as unknown as { pending: Map<string, unknown> }).pending.size).toBe(1);
    expect((worker as unknown as { closed: boolean }).closed).toBe(false);
    worker.close();
    expect((worker as unknown as { pending: Map<string, unknown> }).pending.size).toBe(0);
    worker.start();
    expect((worker as unknown as { timer: unknown }).timer).toBeNull();
  });
});

describe('AutoRefreshWorker stop, start and readNeeds', () => {
  let dir: string;
  let now: number;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'auto-refresh-timers-')); now = Date.UTC(2026, 10, 17, 12); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  function worker(readNeeds: () => Promise<typeof NEEDS>): AutoRefreshWorker {
    return new AutoRefreshWorker({
      dir, openDatabase: () => { throw new Error('the scan must use readNeeds'); }, runJob: async () => ({ state: 'ok', agent: null, result: null, error: null }),
      localDeviceId: () => '', checkMs: 600_000, now: () => now, readNeeds,
    });
  }

  it('runs the first check at once when none is recorded, and only when due on a later start', async () => {
    let scans = 0;
    const refresh = worker(async () => { scans++; return NEEDS; });
    refresh.start();
    await settle();
    expect(scans).toBe(1);
    expect(JSON.parse(readFileSync(join(dir, 'refresh.json'), 'utf8')).checkedAt).toBe(new Date(now).toISOString());
    refresh.stop();
    now += 599_000;
    refresh.start();
    await settle();
    expect(scans).toBe(1);
    refresh.stop();
    now += 2000;
    refresh.start();
    await settle();
    expect(scans).toBe(2);
    refresh.close();
  });

  it('start() twice keeps one timer, and a closed worker does not start again', async () => {
    let scans = 0;
    const refresh = worker(async () => { scans++; return NEEDS; });
    refresh.start();
    const timer = (refresh as unknown as { timer: unknown }).timer;
    refresh.start();
    expect((refresh as unknown as { timer: unknown }).timer).toBe(timer);
    await settle();
    refresh.close();
    refresh.start();
    expect((refresh as unknown as { timer: unknown }).timer).toBeNull();
    expect(scans).toBe(1);
  });

  it('a run in progress counts as a recent check, so a reconnect does not scan again', async () => {
    writeFileSync(join(dir, 'refresh.json'), JSON.stringify({ state: 'ok', startedAt: new Date(now - 60_000).toISOString(), finishedAt: new Date(now - 30_000).toISOString() }));
    let scans = 0;
    const refresh = worker(async () => { scans++; return NEEDS; });
    refresh.start();
    await settle();
    expect(scans).toBe(0);
    refresh.close();
  });

  it('a needs scan that throws is recorded as a check, so the next first viewer does not scan again until due', async () => {
    let scans = 0;
    const refresh = worker(async () => { scans++; throw new Error('database is locked'); });
    const logged: string[] = [];
    (refresh as unknown as { log: (level: string, message: string) => void }).log = (_level, message) => { logged.push(message); };
    refresh.start();
    await settle();
    expect(scans).toBe(1);
    expect(logged).toContain('Work view refresh check failed');
    const status = JSON.parse(readFileSync(join(dir, 'refresh.json'), 'utf8'));
    expect(status).toMatchObject({ state: 'idle', checkFailedAt: new Date(now).toISOString(), checkError: 'database is locked' });
    refresh.stop();
    now += 599_000;
    refresh.start();
    await settle();
    expect(scans).toBe(1);
    refresh.stop();
    now += 2000;
    refresh.start();
    await settle();
    expect(scans).toBe(2);
    refresh.close();
  });

  it('a needs scan that works after a failed one clears the failure record', async () => {
    let fail = true;
    const refresh = worker(async () => { if (fail) throw new Error('database is locked'); return NEEDS; });
    (refresh as unknown as { log: () => void }).log = () => {};
    await refresh.check().catch(() => {});
    expect(JSON.parse(readFileSync(join(dir, 'refresh.json'), 'utf8')).checkFailedAt).toBeDefined();
    fail = false;
    expect(await refresh.check()).toBe('idle');
    const status = JSON.parse(readFileSync(join(dir, 'refresh.json'), 'utf8'));
    expect(status.checkFailedAt).toBeUndefined();
    expect(status.checkedAt).toBe(new Date(now).toISOString());
  });

  it('a second check does not start while the needs scan is still running', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>(resolve => { release = resolve; });
    let scans = 0;
    const refresh = worker(async () => { scans++; await gate; return NEEDS; });
    const first = refresh.check();
    await settle();
    expect(await refresh.check()).toBe('running');
    expect(await refresh.runNow({ reason: 'test' })).toBe('running');
    release();
    expect(await first).toBe('idle');
    expect(scans).toBe(1);
  });
});

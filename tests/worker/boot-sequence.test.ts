import { afterEach, describe, expect, it, spyOn } from 'bun:test';
import { Database } from 'bun:sqlite';
import { join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { CloudSync } from '../../src/services/sync/CloudSync.js';
import { SessionStore } from '../../src/services/sqlite/SessionStore.js';
import { instrumentSlowQueries } from '../../src/services/sqlite/slow-query-log.js';
import { watchMainThreadStatements } from '../helpers/main-thread-sql-witness.js';
import { runBootSequence } from '../../src/services/worker/boot-sequence.js';
import { WorkerService } from '../../src/services/worker-service.js';
import * as eventLoopLag from '../../src/services/sqlite/event-loop-lag.js';
import * as supervisorIndex from '../../src/supervisor/index.js';
import { logger } from '../../src/utils/logger.js';

describe('worker boot order', () => {
  it('starts the lag monitor, then detects the previous shutdown, then the supervisor, then binds', async () => {
    const order: string[] = [];
    await runBootSequence({
      startLagMonitor: () => { order.push('lag-monitor'); },
      detectPreviousShutdown: () => { order.push('previous-shutdown'); },
      startSupervisor: async () => { await Promise.resolve(); order.push('supervisor'); },
      listen: async () => { order.push('listen'); },
    });
    expect(order).toEqual(['lag-monitor', 'previous-shutdown', 'supervisor', 'listen']);
  });

  it('waits for the supervisor before it binds, and never binds after a failed step', async () => {
    const order: string[] = [];
    await expect(runBootSequence({
      startLagMonitor: () => { order.push('lag-monitor'); },
      detectPreviousShutdown: () => { order.push('previous-shutdown'); },
      startSupervisor: async () => { throw new Error('supervisor failed'); },
      listen: async () => { order.push('listen'); },
    })).rejects.toThrow('supervisor failed');
    expect(order).toEqual(['lag-monitor', 'previous-shutdown']);
  });
});

describe('the worker service wires the real lag monitor into its boot', () => {
  const monitors: eventLoopLag.EventLoopLagMonitor[] = [];
  afterEach(() => {
    monitors.splice(0).forEach(monitor => monitor.stop());
    logger.setErrorSink(null);
  });

  it('calls the real startEventLoopLagMonitor before the supervisor and before it binds', async () => {
    const order: string[] = [];
    const realStart = eventLoopLag.startEventLoopLagMonitor;
    const lagSpy = spyOn(eventLoopLag, 'startEventLoopLagMonitor').mockImplementation(options => {
      order.push('lag-monitor');
      const monitor = realStart(options);
      monitors.push(monitor);
      return monitor;
    });
    const supervisorSpy = spyOn(supervisorIndex, 'startSupervisor').mockImplementation(async () => { order.push('supervisor'); });
    const bound = new Error('bind reached');
    const worker = Object.create(WorkerService.prototype) as unknown as {
      start(): Promise<void>;
      bootWatchdog: ReturnType<typeof setTimeout> | null;
      detectPreviousShutdown(): void;
      server: { listen(): Promise<void> };
    };
    worker.detectPreviousShutdown = () => { order.push('previous-shutdown'); };
    // Stops start() at the bind, before it writes a PID file or opens anything else.
    worker.server = { listen: async () => { order.push('listen'); throw bound; } };
    try {
      await expect(worker.start()).rejects.toBe(bound);
    } finally {
      clearTimeout(worker.bootWatchdog ?? undefined);
      lagSpy.mockRestore();
      supervisorSpy.mockRestore();
    }
    expect(order).toEqual(['lag-monitor', 'previous-shutdown', 'supervisor', 'listen']);
    expect(monitors).toHaveLength(1);
  });
});

describe('the worker service wires its CloudSync into the work view routes', () => {
  const SYNTHETIC_DEVICE_ID = 'synthetic-worker-device';
  let worker: { dbManager: { cloudSync: CloudSync | null }; workViewRoutes: { localDeviceId(): string; close(): Promise<void> } } | null = null;
  let database: Database | null = null;
  const signalListeners = () => (['SIGINT', 'SIGTERM', 'SIGHUP'] as const).map(name => [name, process.listeners(name)] as const);
  let listenersBefore = signalListeners();

  afterEach(async () => {
    await worker?.workViewRoutes.close();
    worker = null;
    database?.close();
    database = null;
    for (const [name, before] of listenersBefore) {
      process.listeners(name).filter(listener => !before.includes(listener)).forEach(listener => process.off(name, listener));
    }
  });

  it('reads the device id of the dbManager\'s CloudSync from configuration: no statement on the main thread, never through status()', async () => {
    listenersBefore = signalListeners();
    // The real WorkerService builds its routes in its constructor (registerRoutes), with production's own getCloudSync wiring.
    worker = new WorkerService() as unknown as NonNullable<typeof worker>;
    database = instrumentSlowQueries(new Database(':memory:'));
    new SessionStore(database);
    const cloudSync = new CloudSync(database, {
      CLAUDE_MEM_CLOUD_SYNC_TOKEN: 'synthetic-token', CLAUDE_MEM_CLOUD_SYNC_USER_ID: 'synthetic-user',
      CLAUDE_MEM_CLOUD_SYNC_HUB_URL: 'https://hub.invalid', CLAUDE_MEM_CLOUD_SYNC_DEVICE_ID: SYNTHETIC_DEVICE_ID,
    }, { fetchImpl: (async () => { throw new Error('no network in this test'); }) as unknown as typeof fetch,
      settingsPath: join(mkdtempSync(join(tmpdir(), 'claude-mem-boot-sync-')), 'sync-settings.json') });
    const calls = { localDeviceId: 0, status: 0 };
    const localDeviceId = cloudSync.localDeviceId.bind(cloudSync);
    const status = cloudSync.status.bind(cloudSync);
    cloudSync.localDeviceId = () => { calls.localDeviceId++; return localDeviceId(); };
    cloudSync.status = () => { calls.status++; return status(); };
    worker.dbManager.cloudSync = cloudSync;

    const witness = watchMainThreadStatements({ maxSqlMs: 1000 });
    let deviceId: string;
    let main: ReturnType<typeof witness.finish>;
    try { deviceId = worker.workViewRoutes.localDeviceId(); } finally { main = witness.finish(); }

    expect(deviceId).toBe(SYNTHETIC_DEVICE_ID);
    // EXECUTION: the lookup went through the configured source's accessor, not status().
    expect(calls.localDeviceId).toBe(1);
    expect(calls.status).toBe(0);
    expect(main.seen).toEqual([]);
    expect(main.total).toBe(0);
    expect(main.problem).toBeNull();
  });
});

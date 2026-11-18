import { afterEach, describe, expect, it, spyOn } from 'bun:test';
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

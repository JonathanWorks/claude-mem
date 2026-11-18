import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorkViewRoutes } from '../../../../src/services/worker/http/routes/WorkViewRoutes.js';

type CloudSyncSource = NonNullable<ConstructorParameters<typeof WorkViewRoutes>[0]>['getCloudSync'];

describe('WorkViewRoutes device id', () => {
  let directory: string;
  let routes: WorkViewRoutes | null = null;

  beforeEach(() => { directory = mkdtempSync(join(tmpdir(), 'claude-mem-routes-device-')); });
  afterEach(async () => {
    await routes?.close();
    routes = null;
    rmSync(directory, { recursive: true, force: true });
  });

  function build(getCloudSync: CloudSyncSource): { read: () => string } {
    routes = new WorkViewRoutes({
      databasePath: join(directory, 'claude-mem.db'), reviewPath: join(directory, 'review.db'), ledgerDir: null, humanCopy: null,
      setupStatePath: join(directory, 'setup-state.json'), rulesFilePath: join(directory, 'MY-RULES.md'),
      claudeInstructionsPath: join(directory, 'CLAUDE.md'), homeProject: 'home', getCloudSync,
    });
    return { read: () => (routes as unknown as { localDeviceId: () => string }).localDeviceId() };
  }

  it('reads the id through the source on every lookup, so a later configuration applies', () => {
    let calls = 0;
    let current: { localDeviceId: () => string } | null = null;
    const { read } = build(() => { calls++; return current; });
    expect(read()).toBe('');
    current = { localDeviceId: () => 'device-a' };
    expect(read()).toBe('device-a');
    expect(calls).toBe(2);
  });

  it('is empty when the source answers null (a caller with no sync)', () => {
    expect(build(() => null).read()).toBe('');
  });
});

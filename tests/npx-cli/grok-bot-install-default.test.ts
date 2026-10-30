import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';
import { resolveInstallerProviderChoice } from '../../src/npx-cli/installer-provider-choice';

const repoRoot = join(__dirname, '..', '..');

describe('grok-bot install default provider', () => {
  // PWM fork: asserts a removed vendor path (hosted gateway, Pro, TeamBrain, sync upsell).
  it.skip('defaults --ide grok-bot with no --provider to CMEM Pro', () => {
    expect(resolveInstallerProviderChoice({ ide: 'grok-bot' })).toBe('cmem');
  });

  it('keeps --provider host as an explicit grok-bot opt-in', () => {
    expect(resolveInstallerProviderChoice({ ide: 'grok-bot', provider: 'host' })).toBe('host');
  });

  it('does not invent a non-interactive default for other IDEs', () => {
    expect(resolveInstallerProviderChoice({ ide: 'cursor' })).toBeUndefined();
    expect(resolveInstallerProviderChoice({ ide: 'claude-code' })).toBeUndefined();
    expect(resolveInstallerProviderChoice({})).toBeUndefined();
  });

  // PWM fork: the grok-bot docs carry no hosted default; host stays an explicit opt-in.
  it('documents an own-key OpenRouter default and host as opt-in, with no hosted endpoint', () => {
    const skill = readFileSync(join(repoRoot, 'claude-mem-grok-bot/skills/install/SKILL.md'), 'utf-8');
    const readme = readFileSync(join(repoRoot, 'claude-mem-grok-bot/README.md'), 'utf-8');
    const defaultSection = skill.split('## Optional')[0];

    expect(defaultSection).toContain('install --ide grok-bot --provider openrouter');
    expect(defaultSection).not.toContain('--provider host');
    expect(skill).toContain('install --ide grok-bot --provider host');
    expect(`${skill}\n${readme}`).not.toMatch(/cmem\.ai|cmem-observer|CMEM Pro/i);
  });
});

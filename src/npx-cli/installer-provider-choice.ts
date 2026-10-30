type InstallerProviderId = 'claude' | 'gemini' | 'openrouter' | 'host';
type InstallerProviderChoice = InstallerProviderId | 'cmem';

/**
 * Implicit provider when `--provider` is omitted.
 * Grok Bot's user-facing default is CMEM Pro (openrouter transport +
 * cmem-observer via installer OAuth). `--provider host` stays an explicit
 * loopback-shim opt-in. Other IDEs have no non-interactive implicit provider.
 *
 * Applied at the CLI boundary in `src/npx-cli/index.ts` for non-TTY
 * `install --ide grok-bot`. Interactive grok-bot still shows the CMEM/Claude
 * prompt (`initialValues: ['cmem']`). The 'cmem' sentinel must never be
 * written to settings.json.
 */
export function resolveInstallerProviderChoice(
  options: { ide?: string; provider?: InstallerProviderId },
): InstallerProviderChoice | undefined {
  if (options.provider) return options.provider;
  // PWM fork: no hosted default for grok-bot; it falls through to the normal provider choice.
  return undefined;
}

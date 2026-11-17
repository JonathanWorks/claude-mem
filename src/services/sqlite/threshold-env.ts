/**
 * A millisecond threshold from the environment variable `name`: a finite number above
 * zero, otherwise `fallbackMs`. Unset, empty, zero, negative and non-numeric values all
 * fall back, so a typo in the environment never silences a log. `env` is injectable.
 */
export function resolveThresholdMsFromEnv(
  name: string,
  fallbackMs: number,
  env: Record<string, string | undefined> = process.env,
): number {
  const raw = env[name];
  if (raw === undefined) return fallbackMs;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallbackMs;
}

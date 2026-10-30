/**
 * Telemetry is removed in the PWM fork (Jonathan 2026-10-30: "Remove all telemetry"). These keep
 * upstream's exported names and signatures so callers compile unchanged, and do nothing: no
 * client is created, nothing is queued, nothing leaves the machine.
 */

export function hasTelemetryConsent(): boolean {
  return false;
}

export function enableExceptionAutocaptureForWorker(): void {}

export function captureException(_err: unknown, _ctx?: Record<string, unknown>): void {}

export function captureEvent(
  _event: string,
  _props?: Record<string, unknown>,
  _opts?: { person?: boolean }
): void {}

export function __resetTelemetryForTests(): void {}

export async function shutdownTelemetry(): Promise<void> {}

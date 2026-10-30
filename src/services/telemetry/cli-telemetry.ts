/** Telemetry is removed in the PWM fork: CLI events are not recorded or sent. */
export async function captureCliEvent(
  _event: string,
  _props?: Record<string, unknown>,
  _opts?: { person?: boolean }
): Promise<void> {}

/**
 * `npx claude-mem telemetry`: telemetry is removed in the PWM fork, so every subcommand reports
 * that and changes nothing.
 */
export async function runTelemetryCommand(_argv: string[] = []): Promise<void> {
  console.log('Telemetry is removed from this build of claude-mem: nothing is collected or sent.');
}

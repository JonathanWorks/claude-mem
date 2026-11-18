export interface BootSteps {
  /** Starts the event-loop lag monitor, so a stall in any later step is named in the log. */
  startLagMonitor(): void;
  /** Reads the previous run's PID file; the supervisor start removes a stale one, so this runs first. */
  detectPreviousShutdown(): void;
  startSupervisor(): Promise<void>;
  /** Binds the HTTP server. */
  listen(): Promise<void>;
}

/** The worker's boot order. The lag monitor starts before anything that can stall; the bind is last. */
export async function runBootSequence(steps: BootSteps): Promise<void> {
  steps.startLagMonitor();
  steps.detectPreviousShutdown();
  await steps.startSupervisor();
  await steps.listen();
}

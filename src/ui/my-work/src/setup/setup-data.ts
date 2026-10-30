// What the funnel screens show. Every screen reads it through props; nothing here is made up.
// The live source fills it from the worker (prompt scan, extraction, usage, setup state); `?source=sample` loads
// setup-sample.ts instead, and only then.
import type { AgentTool } from '@/data'
import { toSetupUsage, type SetupScanUsage, type SetupUsage } from './setup-usage'
import { revealFromSnapshot, type SnapshotWithSetup } from './setup-reveal'
import { noteFor, searchUrl, toMemoryResults, type MemoryResult, type WorkerSearchResult } from './setup-search'

/** Mirrors the worker's SetupScanState (src/services/prompt-import/setup-scan.ts), trimmed to what the screen shows. */
export interface SetupScanAgent {
  id: string; label: string; detected: boolean; prompts: number
  /** Whether the agent can run setup's extraction here (the worker's agent detection); `null` when unknown or not a runner. */
  canRunSetup: boolean | null
  /** Why it cannot, e.g. "Gemini is installed, but this Google account can't use it: ...". */
  cannotRunReason: string | null
}

export type SetupScanPhase = 'idle' | 'reading' | 'checking' | 'saving' | 'uploading' | 'done' | 'failed'
export interface SetupScanView { agents: SetupScanAgent[]; percent: number; phase: SetupScanPhase; done: boolean; error: string | null; improveProduct: boolean }
/** The owner's newest typed prompts, quoted as typed (SetupScanState.recentPrompts). */
export interface SetupRecentPrompt { agent: string; at: string; text: string }
/** The worker's subsidized hosted setup extraction. */
/** On The Go checkout, mirrored from the installer that runs it (`null` until the page asks). */
export interface SetupCheckoutView { state: 'requested' | 'waiting' | 'paid' | 'failed'; error: string | null }
/** What the installer in the terminal did with the choice. A `failed` installer has exited: setup restarts from the terminal. */
export interface SetupInstallerView { stage: InstallerStage; error: string | null }
export interface SetupExtraction { state: 'idle' | 'running' | 'ok' | 'failed' | 'waiting-for-agent'; step: 'goals' | 'work' | 'rules' | null }

export type { RevealGoal, RevealRule, RevealSets, RevealWork } from './setup-reveal'
import type { RevealSets } from './setup-reveal'
import type { InstallerStage } from './setup-flow'

export type { Persona, SetupScanUsage, SetupUsage, UsageCoverage } from './setup-usage'

export interface SetupHistory { projects: number; sessions: number; observations: number }
/** The worker's history upload. `imported` counts observations the hosted service wrote; `error` is why a run stopped. */
export interface HistoryImportProgress { percent: number; done: boolean; imported: number; error: string | null }

export type { MemoryResult } from './setup-search'

export interface SetupData {
  scan: SetupScanView
  reveal: RevealSets
  /** `null` until the worker reports a run. Older workers may still report waiting-for-agent. */
  extraction: SetupExtraction | null
  recentPrompts: SetupRecentPrompt[]
  checkout: SetupCheckoutView | null
  /** `null` until an installer reports. */
  installer: SetupInstallerView | null
  usage: SetupUsage | null
  alreadyPro: boolean
  /** Finish Setup tool ids found on this machine; they come pre-ticked. */
  detectedTools: string[]
  /** claude-mem observation history that could be imported. `null` for new installs. */
  history: SetupHistory | null
  historyImport: HistoryImportProgress | null
  /** "What's next?" chips, from the person's own goals and open asks. */
  suggestions: string[]
}

/** What the page posts when it leaves Token Savings: where memory lives, and who generates it. */
export interface SetupChoice { branch: 'home' | 'go'; memoryBilling: 'hosted' | 'existing' }

export interface SetupSource {
  readonly kind: 'local' | 'sample'
  subscribe(onData: (data: SetupData) => void): () => void
  /** Starts another scan only after the user chooses to retry a failure. */
  retryScan(): Promise<void>
  /** Changes the hosted setup results preference without pausing the scan or upload. */
  setImproveProduct(improveProduct: boolean): Promise<void>
  /** Hands the storage choice to the installer waiting in the terminal (POST /api/setup/choice). */
  choose(choice: SetupChoice): Promise<void>
  /** Asks the installer holding the On The Go sign-in to open checkout (POST /api/setup/checkout). */
  checkout(): Promise<void>
  /** Finishes setup for this machine with the tools picked on Finish Setup; the terminal exits (POST /api/setup/complete). */
  complete(tools: string[]): Promise<void>
  /** Uploads this machine's observations to the CMEM account (POST /api/setup/import). */
  startHistoryImport(): Promise<void>
  search(query: string): Promise<MemoryResult[]>
  /** Keep as note: saves `text` as a new memory (POST /api/memory/save) and answers its observation id. */
  keepNote(record: MemoryResult, text: string): Promise<number>
  /** Removes a note this page saved, once its edited copy is saved (DELETE /api/observation/:id). */
  forgetNote(id: number): Promise<void>
}

export const EMPTY_SETUP_DATA: SetupData = {
  scan: { agents: [], percent: 0, phase: 'idle', done: false, error: null, improveProduct: true },
  reveal: { goals: null, work: null, rules: null },
  extraction: null,
  recentPrompts: [],
  checkout: null,
  installer: null,
  usage: null,
  alreadyPro: false,
  detectedTools: [],
  history: null,
  historyImport: null,
  suggestions: [],
}

/** The worker's answers, trimmed to what this file reads. */
interface WorkerScanState extends Omit<SetupScanView, 'agents' | 'improveProduct'> {
  /** Older workers do not send the hosted setup preference. */
  improveProduct?: boolean
  /** An older worker sends no canRunSetup / cannotRunReason. */
  agents: Array<Omit<SetupScanAgent, 'canRunSetup' | 'cannotRunReason'> & Partial<Pick<SetupScanAgent, 'canRunSetup' | 'cannotRunReason'>> & { fromMemory?: number; fromTranscripts?: number }>
  /** The 30-day token usage the same pass sums, once the scan is done. */
  usage?: SetupScanUsage | null
  recentPrompts?: SetupRecentPrompt[]
}
interface WorkerHistoryImport { state: 'idle' | 'running' | 'done' | 'failed'; percent: number; imported: number; error: string | null }
interface WorkerSetupState {
  status: 'pending' | 'complete'; alreadyPro: boolean; checkout?: SetupCheckoutView | null
  installer?: SetupInstallerView | null
  history?: SetupHistory | null; historyImport?: WorkerHistoryImport | null
}
const toHistoryImport = (run: WorkerHistoryImport | null | undefined): HistoryImportProgress | null =>
  !run || run.state === 'idle' ? null : { percent: run.percent, done: run.state === 'done', imported: run.imported, error: run.state === 'failed' ? run.error : null }

async function workerJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: 'no-store', ...init })
  let answer: unknown = null
  try { answer = await response.json() } catch { /* A body that isn't JSON leaves only the status to report. */ }
  if (!response.ok) {
    const reason = (answer as { error?: unknown } | null)?.error
    throw new Error(typeof reason === 'string' ? reason : `The worker answered ${response.status} for ${url}.`)
  }
  return answer as T
}
const postJson = <T>(url: string, body: unknown) => workerJson<T>(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

/** Whether this machine still has the funnel to go through. A worker without the endpoint (older) has nothing to show. */
export async function setupPending(): Promise<boolean> {
  const response = await fetch('/api/setup/state', { cache: 'no-store' })
  if (!response.ok) return false
  return ((await response.json()) as WorkerSetupState).status === 'pending'
}

const toScanView = (scan: WorkerScanState): SetupScanView => ({
  agents: scan.agents.map(({ id, label, detected, prompts }) => ({
    // Agent login is irrelevant to hosted setup; the transcript scan only reports which tools were found.
    id, label, detected, prompts, canRunSetup: null, cannotRunReason: null,
  })),
  percent: scan.percent, phase: scan.phase, done: scan.done, error: scan.error, improveProduct: scan.improveProduct ?? true,
})

// Keep rapid checkbox changes in click order; scan and upload never wait on this queue.
let preferenceWrite: Promise<unknown> = Promise.resolve()
let desiredImproveProduct: boolean | undefined
let appliedImproveProduct: boolean | undefined
let preferenceReady: Promise<void> = Promise.resolve()
let retryLocalScan: (() => Promise<void>) | null = null

/**
 * The local worker: the prompt scan (started here when it has not run, then followed on the work view's event
 * stream), the 30-day token usage that scan sums, the setup state, and the Reveal's sets from the work view snapshot. Search and import land in funnel
 * Phases 9-10; until then those parts stay empty.
 */
export const localSetupSource: SetupSource = {
  kind: 'local',
  subscribe(onData) {
    let data = EMPTY_SETUP_DATA
    let closed = false
    let scanRevision = 0
    let ready!: () => void
    preferenceReady = new Promise<void>((resolve) => { ready = resolve })
    const publish = (changes: Partial<SetupData>) => { if (closed) return; data = { ...data, ...changes }; onData(data) }
    const applyScan = (scan: WorkerScanState) => {
      scanRevision++
      appliedImproveProduct = scan.improveProduct ?? true
      publish({
        scan: toScanView(scan),
        usage: scan.usage ? toSetupUsage(scan.usage) : null,
        recentPrompts: scan.recentPrompts ?? [],
        // Finish Setup pre-ticks the tools the scan found on this machine.
        detectedTools: scan.agents.filter((agent) => agent.detected).map((agent) => agent.id).filter((id) => SETUP_TOOLS.some((tool) => tool.id === id)),
      })
    }
    const applyState = (state: WorkerSetupState) => publish({
      alreadyPro: state.alreadyPro,
      checkout: state.checkout ? { state: state.checkout.state, error: state.checkout.error } : null,
      installer: state.installer ? { stage: state.installer.stage, error: state.installer.error } : null,
      // Nothing to bring along on a new install: the import offer stays hidden.
      history: state.history && state.history.observations > 0 ? state.history : null,
      historyImport: toHistoryImport(state.historyImport),
    })
    // Goals, work and rules land in the work view snapshot as the extraction saves each one.
    const applySnapshot = (snapshot: SnapshotWithSetup) => {
      const extraction = snapshot.setup?.extraction ?? null
      const goals = snapshot.goals ? [...snapshot.goals.areas, ...snapshot.goals.asks].map((item) => item.title) : []
      publish({
        reveal: revealFromSnapshot(snapshot),
        extraction: extraction && { state: extraction.state, step: extraction.step },
        // "What's next?" chips: the person's own goals and open asks.
        suggestions: [...new Set(goals)].slice(0, 4),
      })
    }
    onData(data)
    const stream = new EventSource('/api/work-view/events')
    stream.addEventListener('setup-scan', (event) => applyScan(JSON.parse((event as MessageEvent<string>).data) as WorkerScanState))
    stream.addEventListener('setup-state', (event) => applyState(JSON.parse((event as MessageEvent<string>).data) as WorkerSetupState))
    stream.addEventListener('setup-import', (event) => publish({ historyImport: toHistoryImport(JSON.parse((event as MessageEvent<string>).data) as WorkerHistoryImport) }))
    stream.addEventListener('work-view', (event) => applySnapshot(JSON.parse((event as MessageEvent<string>).data) as SnapshotWithSetup))
    const startScan = async () => {
      const revision = scanRevision
      const started = await postJson<WorkerScanState>('/api/setup/scan', desiredImproveProduct === undefined ? {} : { improveProduct: desiredImproveProduct })
      if (!closed && scanRevision === revision) applyScan(started)
    }
    // Retrying may repeat hosted extraction, so only the page's explicit action invokes this.
    retryLocalScan = startScan
    let requestedAtRevision = scanRevision
    void (async () => {
      const [scan, state] = await Promise.all([workerJson<WorkerScanState>('/api/setup/scan'), workerJson<WorkerSetupState>('/api/setup/state')])
      if (closed) return
      applyState(state)
      // The event stream can advance while GET or POST is in flight. Never restore an older phase or preference.
      if (scanRevision === requestedAtRevision) applyScan(scan)
      if (data.scan.phase === 'idle') {
        requestedAtRevision = scanRevision
        // A click can precede the initial GET. Start with the latest choice, without
        // delaying the scan for the buffered preference request.
        await startScan()
      }
    })().catch((error: unknown) => {
      // A late startup error must not replace progress or results already received from the stream.
      if (!closed && (scanRevision === requestedAtRevision || data.scan.phase === 'idle')) {
        publish({ scan: { ...data.scan, phase: 'failed', error: error instanceof Error ? error.message : String(error) } })
      }
    }).finally(ready)
    return () => {
      closed = true
      if (retryLocalScan === startScan) retryLocalScan = null
      stream.close()
      ready()
    }
  },
  async retryScan() {
    if (!retryLocalScan) throw new Error('The setup page is not connected to the worker. Reload it to try again.')
    await retryLocalScan()
  },
  async setImproveProduct(improveProduct) {
    desiredImproveProduct = improveProduct
    const initialized = preferenceReady
    const write = preferenceWrite.then(async () => {
      // Buffer early clicks until GET/start establishes the scan. It starts with the latest choice
      // immediately; an older preference request must not arrive later and overwrite that choice.
      await initialized
      // Start may already have accepted this value; a redundant POST after upload would report a false failure.
      if (desiredImproveProduct === improveProduct && appliedImproveProduct !== improveProduct) {
        const scan = await postJson<WorkerScanState>('/api/setup/scan/preferences', { improveProduct })
        appliedImproveProduct = scan.improveProduct ?? improveProduct
      }
    })
    preferenceWrite = write.catch(() => {})
    await write
  },
  async choose(choice) { await postJson('/api/setup/choice', choice) },
  async checkout() { await postJson('/api/setup/checkout', {}) },
  async complete(tools) { await postJson('/api/setup/complete', { tools }) },
  async startHistoryImport() { await postJson('/api/setup/import', {}) },
  async search(query) { return toMemoryResults(await workerJson<WorkerSearchResult>(searchUrl(query))) },
  async keepNote(record, text) {
    const saved = await postJson<{ success?: boolean; id?: unknown; reason?: unknown }>('/api/memory/save', noteFor(record, text))
    if (saved.success !== true || typeof saved.id !== 'number') throw new Error(`The note was not saved${typeof saved.reason === 'string' ? `: ${saved.reason}` : '.'}`)
    return saved.id
  },
  async forgetNote(id) { await workerJson(`/api/observation/${id}`, { method: 'DELETE' }) },
}

/** D6 plan prices, in cents. Plan prices only, never per-run spend. */
export const PLAN = { name: '', monthlyCents: 0, cloudSyncCents: 0 } as const

export const CMEM_MCP_URL = ''

/** Finish Setup tools. Names, descriptions and steps come from the PROTO workspace tool list and CONNECTOR-EVIDENCE.md. */
export interface SetupTool {
  id: string
  name: string
  /** Local tools capture work on this machine; cloud readers only exist with On The Go. */
  kind: 'local' | 'cloud'
  mark: 'terminal' | 'codex' | 'chatgpt' | 'claude' | 'gemini'
  steps?: string[]
  commands?: string[]
  guide: { href: string; label: string }
}
// PWM fork: every listed tool connected to the vendor's hosted MCP endpoint; none are offered.
export const SETUP_TOOLS: SetupTool[] = []

/** The scan's agent ids drawn with the brand marks brand.tsx has; any other agent gets the neutral mark. */
export const agentToolFor = (agentId: string): AgentTool =>
  agentId === 'claude-code' ? 'claude' : agentId === 'codex' ? 'codex' : agentId === 'gemini-cli' ? 'gemini' : 'other'

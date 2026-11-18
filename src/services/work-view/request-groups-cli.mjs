// Entry point bundled into the request-progress skill's scripts folder.
//
// The worker's main thread is the only writer of the request ledger (ledger-writes.mjs), so `apply`, `record-progress`,
// `record-story` and `judge --apply` send each change to the running worker (POST /api/work-view/ledger) and never write the
// files themselves. With no worker they refuse. `--offline` (anywhere in the arguments) writes the files directly instead, for a
// computer where no worker runs; it is unsafe while a worker runs, because a change the worker makes at the same moment can be lost.
import { join } from 'node:path';
import { resolveHarnessWorkerUrl } from '../../integrations/harness-worker.js';
import { isConnectionRefusedError } from '../../shared/connection-errors.js';
import { resolveDataDir } from '../../shared/paths.js';
import { SettingsDefaultsManager } from '../../shared/SettingsDefaultsManager.js';
import { remoteLedgerWriter } from './ledger-writes.mjs';
import { LEDGER_DIR, runCli } from './request-groups.mjs';

const OFFLINE_FLAG = '--offline';
const LEDGER_ROUTE = '/api/work-view/ledger';
// The ledger folder (LEDGER_DIR) and the database runCli opens are both resolved by the worker's own resolveDataDir (environment, then
// settings.json, ~ expanded), the one function: nothing in this bundle works the data folder out another way. The worker refuses (409)
// a ledger folder that is not its own, and --offline writes the same folder directly.
const dataDir = resolveDataDir();

/** record-focus: the worker writes the my-focus rows (they sync); a 400 means it refused before writing anything. */
async function saveFocus(body) {
  const base = resolveHarnessWorkerUrl();
  let response;
  try {
    response = await fetch(`${base}/api/work-view/focus/router`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  } catch (error) {
    throw new Error(`claude-mem worker is not reachable at ${base} (${error.message}). Start it with: npx claude-mem start`);
  }
  const text = await response.text();
  if (response.status === 400) throw new TypeError(`worker refused the answer: ${text}`);
  if (!response.ok) throw new Error(`worker refused /api/work-view/focus/router: ${response.status} ${text}`);
  return JSON.parse(text);
}

/**
 * Sends one ledger change to the worker and answers its reply (`{ done }` or `{ needFacts }`). Every failure throws and nothing is
 * written by this process: a 400 is a TypeError (the answer does not validate), the rest are Errors that name what to do.
 */
async function postLedgerWrite(op) {
  const base = resolveHarnessWorkerUrl();
  const refusal = `Nothing was written. Start the worker with: npx claude-mem start. With no worker running, add ${OFFLINE_FLAG} to write ${LEDGER_DIR} directly (unsafe while a worker runs).`;
  let response;
  try {
    response = await fetch(`${base}${LEDGER_ROUTE}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ledgerDir: LEDGER_DIR, op }) });
  } catch (error) {
    if (isConnectionRefusedError(error)) throw new Error(`claude-mem worker is not reachable at ${base} (${error.message}). ${refusal}`);
    throw new Error(`claude-mem worker at ${base} did not answer the ${op.kind} change (${error.message}). It may or may not have applied it: read the ledger before running it again (apply and record-story are safe to repeat; record-progress adds another reading).`);
  }
  const text = await response.text();
  if (response.ok) return JSON.parse(text);
  if (response.status === 400) throw new TypeError(`worker refused the ${op.kind} change: ${text}`);
  if (response.status === 404) throw new Error(`This claude-mem worker (${base}) has no ${LEDGER_ROUTE} route: update claude-mem and restart the worker. ${refusal}`);
  throw new Error(`worker refused ${LEDGER_ROUTE}: ${response.status} ${text}. ${refusal}`);
}

// The worker's sync device id as CloudSync persisted it ('' before cloud sync first started, when every row is local).
const localDeviceId = SettingsDefaultsManager.loadFromFile(join(dataDir, 'settings.json'), true, { readOnly: true }).CLAUDE_MEM_CLOUD_SYNC_DEVICE_ID ?? '';

// Printed through process.stdout.write and awaited: the imports above load the logger, which reads
// process.stdout.isTTY, and after that Bun drops whatever console.log has not flushed to a pipe when the process
// exits (focus-input at 106 KB arrived cut at 65536 bytes). Agents read this output through a pipe.
let output = '';
const print = (value) => { output += `${JSON.stringify(value, null, 2)}\n`; };
const argv = process.argv.slice(2);
const offline = argv.includes(OFFLINE_FLAG);
// Removed before runCli: `apply`, `record-progress` and `record-story` read their input file from the first argument.
const args = argv.filter((arg) => arg !== OFFLINE_FLAG);
const writesLedger = ['apply', 'record-progress', 'record-story'].includes(args[0]) || (args[0] === 'judge' && args.includes('--apply'));
if (offline && writesLedger) console.error(`${OFFLINE_FLAG}: writing ${LEDGER_DIR} directly, without the worker. Unsafe while a worker runs: a change it makes at the same moment can be lost.`);
const ledger = offline ? null : remoteLedgerWriter({ dir: LEDGER_DIR, send: postLedgerWrite });
try { await runCli(args, { dir: LEDGER_DIR, saveFocus, localDeviceId, print, ledger }); }
catch (error) { console.error(error.message); process.exitCode = 1; }
if (output) await new Promise((resolve, reject) => process.stdout.write(output, (error) => error ? reject(error) : resolve()));

// A worker thread that tries to write a ledger file, as the refresh job's thread must never do (tests/work-view/ledger-single-writer.test.ts).
// It answers with whether it reached writeJsonAtomic and the code of the refusal, if any.
import { parentPort } from 'node:worker_threads';
import { writeJsonAtomic } from '../../src/services/work-view/request-groups.mjs';

parentPort.on('message', ({ path }) => {
  try {
    writeJsonAtomic(path, { narrative: 'written from a worker thread' });
    parentPort.postMessage({ attempted: true });
  } catch (error) {
    parentPort.postMessage({ attempted: true, code: error.code });
  }
});

import { createServer } from 'node:net';

/** A loopback port nothing listens on: a server bound to port 0 and closed again. A script pointed at it gets a refused connection. */
export async function deadPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No test port');
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return address.port;
}

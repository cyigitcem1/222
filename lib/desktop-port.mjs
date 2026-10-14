import { createServer } from 'node:net';
import { lstat } from 'node:fs/promises';
import { join } from 'node:path';

async function availablePort(port) {
  return new Promise((accept, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      const chosen = server.address().port;
      server.close(error => error ? reject(error) : accept(chosen));
    });
  });
}

export async function chooseDesktopPort(stateDir, preferred = 18799) {
  // An existing owner's configuration remains authoritative; never stop or
  // redirect a running service. Only a brand-new desktop profile gets a port.
  try { await lstat(join(stateDir, 'openclaw.json')); return preferred; }
  catch (e) { if (e.code !== 'ENOENT') throw e; }
  try { return await availablePort(preferred); }
  catch (e) {
    if (e.code !== 'EADDRINUSE' && e.code !== 'EACCES') throw e;
    return availablePort(0);
  }
}

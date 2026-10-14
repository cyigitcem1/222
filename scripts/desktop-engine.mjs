import { readFile } from 'node:fs/promises';
import { readFileSync, unlinkSync, lstatSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, statePath, openclawEnv, assertProfileState } from '../lib/profile.mjs';
import { acquireRuntime } from '../lib/runtime.mjs';
import '../lib/windows-runtime-preload.cjs';

// Run the official Gateway in this process. Its documented host lifeline makes
// closing the private stdin pipe request graceful shutdown on Windows as well.
const state = statePath();
await assertProfileState(state);
Object.assign(process.env, openclawEnv(state));
// The GUI owns this exact process. OpenClaw supports this opt-out from a
// compile-cache launcher respawn, including when Node inherited a cache.
process.env.NODE_DISABLE_COMPILE_CACHE = '1';
delete process.env.NODE_COMPILE_CACHE;
process.env.OPENCLAW_NO_RESPAWN = '1';
process.env.OPENCLAW_GATEWAY_HOST_LIFELINE = 'stdin';
const c = JSON.parse(await readFile(join(state, 'openclaw.json'), 'utf8'));
const release = await acquireRuntime(state);
const cli = join(ROOT, 'node_modules', 'openclaw', 'openclaw.mjs');
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  input += chunk;
  if (input.length > 1024) input = '';
  if (input.includes('GIDEON_STOP\n')) {
    input = '';
    // OpenClaw listens for stdin close/end/error, including a pipe that closed
    // before startup finished. Use the documented host lifeline instead of
    // synthesizing process signals.
    process.stdin.destroy();
  }
});
process.on('exit', () => {
  try {
    const marker = join(state, 'launcher-runtime.json');
    const stat = lstatSync(marker);
    if (stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1 && JSON.parse(readFileSync(marker, 'utf8')).pid === process.pid) unlinkSync(marker);
  } catch { /* A crashed/missing marker is safely checked by the next launcher. */ }
});
process.argv = [process.execPath, cli, 'gateway', 'run', '--bind', 'loopback', '--port', String(c.gateway.port)];
try { await import(pathToFileURL(cli).href); }
catch {
  console.error('GIDEON hizmeti başlatılamadı.');
  process.stdin.destroy();
  await release();
  // A partially imported Gateway may own other handles; terminate only this
  // failed, GUI-owned process after releasing its private lock.
  process.exit(1);
}

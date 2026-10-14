import { readFile } from 'node:fs/promises';
import { readFileSync, unlinkSync, lstatSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, statePath, openclawEnv, assertProfileState } from '../lib/profile.mjs';
import { acquireRuntime } from '../lib/runtime.mjs';
import '../lib/windows-runtime-preload.cjs';

// Run the official Gateway in this process. A private stdin pipe lets the GUI
// request the same graceful shutdown as SIGTERM on Windows, without a console.
const state = statePath();
await assertProfileState(state);
Object.assign(process.env, openclawEnv(state));
const c = JSON.parse(await readFile(join(state, 'openclaw.json'), 'utf8'));
const release = await acquireRuntime(state);
const cli = join(ROOT, 'node_modules', 'openclaw', 'openclaw.mjs');
let pendingStop = false;
let stopped = false;
let input = '';
let timer;
function stopWhenReady() {
  if (pendingStop && !stopped && process.listenerCount('SIGTERM') > 0) {
    stopped = true; clearInterval(timer); process.emit('SIGTERM');
  }
}
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  input += chunk;
  if (input.length > 1024) input = '';
  if (input.includes('GIDEON_STOP\n')) { pendingStop = true; input = ''; stopWhenReady(); }
});
process.stdin.on('end', () => { pendingStop = true; stopWhenReady(); });
timer = setInterval(stopWhenReady, 200); timer.unref();
process.on('exit', () => {
  try {
    const marker = join(state, 'launcher-runtime.json');
    const stat = lstatSync(marker);
    if (stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1 && JSON.parse(readFileSync(marker, 'utf8')).pid === process.pid) unlinkSync(marker);
  } catch { /* A crashed/missing marker is safely checked by the next launcher. */ }
});
process.argv = [process.execPath, cli, 'gateway', 'run', '--bind', 'loopback', '--port', String(c.gateway.port)];
try { await import(pathToFileURL(cli).href); }
catch { console.error('GIDEON hizmeti başlatılamadı.'); await release(); process.exitCode = 1; }

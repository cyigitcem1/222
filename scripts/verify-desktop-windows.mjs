#!/usr/bin/env node
// Runs on Windows against the bundled runtime, without a Gemini request.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

if (process.platform !== 'win32') throw new Error('This verification requires native Windows.');
const resources = resolve(process.argv[2] || 'dist/desktop/win-unpacked/resources');
const node = join(resources, 'node', 'node.exe');
const runtime = join(resources, 'runtime');
for (const file of [node, join(resources, 'node', 'vcruntime140.dll')]) {
  assert.ok((await stat(file)).isFile(), 'Bundled Windows runtime file is missing.');
}
const temporary = await mkdtemp(join(tmpdir(), 'gideon-packaged-windows-'));
const state = join(temporary, 'state');
const env = { ...process.env, GIDEON_STATE_DIR: state, GIDEON_PORT: '', GEMINI_API_KEY: '', GOOGLE_API_KEY: '' };

async function command(args) {
  const child = spawn(node, ['--require', join(runtime, 'lib', 'windows-runtime-preload.cjs'), ...args], { cwd: runtime, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', chunk => { if (output.length < 1_000_000) output += chunk; });
  child.stderr.on('data', () => {});
  const timer = setTimeout(() => child.kill(), 45_000);
  try {
    const [code, signal] = await once(child, 'close');
    assert.equal(signal, null, 'Bundled runtime command timed out.');
    assert.equal(code, 0, 'Bundled runtime command failed.');
    return output;
  } finally { clearTimeout(timer); }
}

let engine, closed;
try {
  await command(['-e', "require('koffi'); console.log('Windows FFI loaded');"]);
  await command(['-e', "require('@openclaw/fs-safe-win32-x64-msvc'); console.log('Windows native filesystem binding loaded');"]);
  await command([join(runtime, 'scripts', 'gideon.mjs'), 'setup-desktop']);
  const config = JSON.parse(await readFile(join(state, 'openclaw.json'), 'utf8'));
  const address = `http://127.0.0.1:${config.gateway.port}/healthz`;
  engine = spawn(node, [join(runtime, 'scripts', 'desktop-engine.mjs')], {
    cwd: runtime, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
  });
  engine.stdout.on('data', () => {}); engine.stderr.on('data', () => {});
  closed = once(engine, 'close');
  let ready = false;
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline && engine.exitCode === null && engine.signalCode === null) {
    try {
      if ((await fetch(address, { signal: AbortSignal.timeout(1500) })).ok) { ready = true; break; }
    } catch {}
    await new Promise(fulfill => setTimeout(fulfill, 200));
  }
  assert.ok(ready, 'Bundled Windows Gateway did not become ready.');
  const health = JSON.parse(await command([join(runtime, 'scripts', 'gideon.mjs'), 'openclaw', 'health', '--json']));
  assert.equal(health.ok, true, 'Authenticated Windows Gateway health failed.');
  engine.stdin.write('GIDEON_STOP\n');
  const timer = setTimeout(() => engine.kill(), 15_000);
  let result;
  try { result = await closed; } finally { clearTimeout(timer); }
  assert.deepEqual(result, [0, null], 'Windows Gateway did not shut down gracefully.');
  await assert.rejects(readFile(join(state, 'launcher-runtime.json')), { code: 'ENOENT' });
  await assert.rejects(fetch(address, { signal: AbortSignal.timeout(1500) }));
  console.log('Bundled Windows FFI, native filesystem binding, setup, authenticated Gateway and graceful shutdown verified. No Gemini request made.');
} finally {
  if (engine && engine.exitCode === null && engine.signalCode === null) { engine.kill(); await closed; }
  await rm(temporary, { recursive: true, force: true });
}

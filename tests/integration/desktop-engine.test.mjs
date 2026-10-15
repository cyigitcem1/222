import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { ROOT, setupProfile, bindDesktopRuntime, openclawEnv } from '../../lib/profile.mjs';
import { runOpenClaw } from '../../scripts/gideon.mjs';

test('masaüstü motoru gerçek Gateway’i açar ve özel kanaldan düzgün kapatır', { timeout: 75_000 }, async t => {
  const state = await mkdtemp(join(tmpdir(), 'gideon-desktop-engine-'));
  const probe = createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
  const port = probe.address().port; await new Promise(r => probe.close(r));
  await setupProfile(state, { port });
  const configFile = join(state, 'openclaw.json');
  const c = JSON.parse(await readFile(configFile, 'utf8'));
  const token = c.gateway.auth.token;
  c.plugins.load.paths = ['/old/portable/resources/runtime/extensions/gideon-guard'];
  c.agents.defaults.model.primary = 'google/gemini-2.5-flash';
  await writeFile(configFile, JSON.stringify(c));
  await bindDesktopRuntime(state);
  const updated = JSON.parse(await readFile(configFile, 'utf8'));
  assert.equal(updated.gateway.auth.token, token);
  assert.equal(updated.agents.defaults.model.primary, 'google/gemini-2.5-flash');
  assert.deepEqual(updated.plugins.load.paths, [
    join(ROOT, 'extensions', 'gideon-guard'),
    join(ROOT, 'node_modules', 'openclaw', 'dist', 'extensions', 'gideon-documents'),
    join(ROOT, 'node_modules', '@openclaw', 'whatsapp'),
  ]);
  assert.equal((await readdir(state)).filter(n => n.startsWith('openclaw.before-desktop-')).length, 1);
  const child = spawn(process.execPath, [join(ROOT, 'scripts', 'desktop-engine.mjs')], {
    cwd: ROOT, env: { ...openclawEnv(state), GIDEON_STATE_DIR: state, GEMINI_API_KEY: '', GOOGLE_API_KEY: '', NODE_COMPILE_CACHE: join(state, 'cache', 'inherited-node-compile') },
    stdio: ['pipe', 'pipe', 'pipe'], detached: process.platform !== 'win32',
  });
  let output = ''; child.stdout.on('data', d => { output += d; }); child.stderr.on('data', d => { output += d; });
  const closed = once(child, 'close');
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      try { process.platform === 'win32' ? child.kill() : process.kill(-child.pid, 'SIGKILL'); } catch {}
      await closed;
    }
    await rm(state, { recursive: true, force: true });
  });
  let ready = false;
  for (let i = 0; i < 400; i++) {
    if (child.exitCode !== null) throw new Error(`Masaüstü motoru hazır olmadan kapandı: ${output.slice(-1000)}`);
    try { if ((await fetch(`http://127.0.0.1:${port}/healthz`)).ok) { ready = true; break; } } catch {}
    await new Promise(r => setTimeout(r, 100));
  }
  assert.equal(ready, true, 'Gerçek masaüstü Gateway açılmadı');
  const health = await runOpenClaw(['health', '--json'], { stateDir: state, capture: true });
  assert.equal(health.code, 0); assert.equal(JSON.parse(health.stdout).ok, true);
  child.stdin.write('GIDEON_STOP\n');
  const timeout = setTimeout(() => {
    try { process.platform === 'win32' ? child.kill() : process.kill(-child.pid, 'SIGKILL'); } catch {}
  }, 15_000);
  const [exitCode, signal] = await closed; clearTimeout(timeout);
  assert.equal(signal, null, 'Motor zorla sonlandırılmamalı');
  assert.equal(exitCode, 0);
  await assert.rejects(readFile(join(state, 'launcher-runtime.json')), { code: 'ENOENT' });
  await assert.rejects(fetch(`http://127.0.0.1:${port}/healthz`));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { mkdtemp, mkdir, writeFile, readFile, lstat, symlink, link, rm, readdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';

const require = createRequire(import.meta.url);
const { createController } = require('../desktop/controller.cjs');
const KEY = 'synthetic-gemini-key-only-for-unit-tests';
const TOKEN = 'synthetic-private-gateway-token';
const statusFields = ['gatewayReady', 'hasKey', 'keyStorageAvailable', 'liveVerified', 'message', 'phase'];

function codec() {
  const secret = randomBytes(32);
  return {
    available: () => true,
    encrypt(value) {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', secret, iv);
      const content = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), content]);
    },
    decrypt(value) {
      const decipher = createDecipheriv('aes-256-gcm', secret, value.subarray(0, 12));
      decipher.setAuthTag(value.subarray(12, 28));
      return Buffer.concat([decipher.update(value.subarray(28)), decipher.final()]).toString('utf8');
    },
  };
}

class FakeChild extends EventEmitter {
  constructor() {
    super();
    this.stdin = new PassThrough();
    this.stdout = new PassThrough();
    this.stderr = new PassThrough();
    this.killCalls = 0;
    this.closed = false;
    this.stopped = false;
    this.stdin.on('data', data => {
      if (String(data) === 'GIDEON_STOP\n') { this.stopped = true; queueMicrotask(() => this.close()); }
    });
  }
  close(code = 0) {
    if (this.closed) return;
    this.closed = true;
    this.emit('close', code, null);
  }
  kill() { this.killCalls += 1; queueMicrotask(() => this.close(null)); return true; }
}

async function fixture(t, overrides = {}) {
  const base = await mkdtemp(join(tmpdir(), 'gideon-desktop-unit-'));
  t.after(async () => { await rm(base, { recursive: true, force: true }); });
  const stateDir = join(base, 'GIDEON', 'state');
  const credentialsPath = join(dirname(stateDir), 'credentials.bin');
  await mkdir(stateDir, { recursive: true, mode: 0o700 });
  await writeFile(join(stateDir, 'openclaw.json'), JSON.stringify({
    gateway: { mode: 'local', bind: 'loopback', port: 19901, auth: { mode: 'token', token: TOKEN } },
  }), { mode: 0o600 });
  const calls = [];
  const statuses = [];
  const secureStore = overrides.secureStore || codec();
  const spawnProcess = (command, args, options) => {
    const child = new FakeChild();
    const call = { command, args, options, child };
    calls.push(call);
    if (overrides.onSpawn) overrides.onSpawn(call);
    else if (args.includes('setup-desktop')) queueMicrotask(() => child.close());
    else if (args.includes('health')) queueMicrotask(() => { child.stdout.write('{"ok":true}'); child.close(); });
    return child;
  };
  const make = extra => createController({
    stateDir, nodePath: join(base, 'node.exe'), runtimeRoot: join(base, 'runtime'), secureStore,
    spawnProcess, fetchImpl: async () => ({ ok: true }), onStatus: state => statuses.push(state),
    startupTimeoutMs: 500, stopTimeoutMs: 25, ...overrides, ...extra,
  });
  return { base, stateDir, credentialsPath, calls, statuses, secureStore, make, controller: make() };
}

function expectPrivateStatus(status, ...forbidden) {
  assert.deepEqual(Object.keys(status).sort(), statusFields);
  assert.equal(status.liveVerified, false);
  for (const secret of [KEY, TOKEN, ...forbidden]) assert.equal(JSON.stringify(status).includes(secret), false);
}

test('desktop credentials round-trip through encrypted private storage without exposing secrets', async t => {
  const f = await fixture(t);
  assert.equal((await f.controller.initialize()).hasKey, false);
  const saved = await f.controller.saveKey(`  ${KEY}  `);
  assert.equal(saved.hasKey, true);
  expectPrivateStatus(saved, f.credentialsPath);
  const encrypted = await readFile(f.credentialsPath);
  assert.equal(encrypted.includes(Buffer.from(KEY)), false);
  assert.equal((await lstat(f.credentialsPath)).nlink, 1);
  if (process.platform !== 'win32') assert.equal((await lstat(f.credentialsPath)).mode & 0o777, 0o600);
  const reopened = f.make();
  assert.equal((await reopened.initialize()).hasKey, true);
  assert.deepEqual((await readdir(dirname(f.stateDir))).sort(), ['credentials.bin', 'state']);
});

test('unavailable secure storage never saves plaintext or claims a saved key', async t => {
  const f = await fixture(t, { secureStore: { available: () => false, encrypt() { throw new Error('must not encrypt'); } } });
  const status = await f.controller.saveKey(KEY);
  assert.equal(status.phase, 'error');
  assert.equal(status.keyStorageAvailable, false);
  assert.equal(status.hasKey, false);
  await assert.rejects(readFile(f.credentialsPath), { code: 'ENOENT' });
  assert.equal(f.calls.length, 0);
  expectPrivateStatus(status);
});

test('unavailable secure storage refuses to decrypt an existing credential', async t => {
  const f = await fixture(t);
  await f.controller.saveKey(KEY);
  const unavailable = f.make({ secureStore: { available: () => false, decrypt() { assert.fail('must not decrypt'); } } });
  const status = await unavailable.initialize();
  assert.equal(status.phase, 'error');
  assert.equal(status.hasKey, false);
  expectPrivateStatus(status);
});

test('invalid keys preserve the encrypted credential and never invoke the runtime', async t => {
  const f = await fixture(t);
  await f.controller.saveKey(KEY);
  const before = await readFile(f.credentialsPath);
  for (const invalid of ['', 'short', 'key with spaces', 'a'.repeat(513), `valid-but\u0000-corrupt-key`, null]) {
    const result = await f.controller.saveKey(invalid);
    assert.equal(result.phase, 'error');
    assert.equal(result.hasKey, true);
    assert.deepEqual(await readFile(f.credentialsPath), before);
    expectPrivateStatus(result);
  }
  assert.equal(f.calls.length, 0);
});

test('saving a key does not probe a paid API', async t => {
  const f = await fixture(t, { fetchImpl: () => { assert.fail('saving must not fetch'); } });
  await f.controller.saveKey(KEY);
  assert.equal(f.calls.length, 0);
});

test('missing keys stay on the welcome screen without starting a fake gateway', async t => {
  const f = await fixture(t);
  const status = await f.controller.start();
  assert.equal(status.phase, 'welcome');
  assert.equal(status.hasKey, false);
  assert.equal(status.gatewayReady, false);
  assert.equal(f.calls.length, 0);
  expectPrivateStatus(status);
});

test('simultaneous starts share one preparation and require authenticated real health', async t => {
  const f = await fixture(t);
  await f.controller.saveKey(KEY);
  const first = f.controller.start();
  const second = f.controller.start();
  assert.equal(first, second);
  const status = await first;
  assert.equal(status.phase, 'ready');
  assert.equal(status.gatewayReady, true);
  assert.equal(f.calls.length, 3);
  assert.deepEqual(f.calls[0].args.slice(1), ['setup-desktop']);
  assert.equal(f.calls[1].args[0], join(f.base, 'runtime', 'scripts', 'desktop-engine.mjs'));
  assert.deepEqual(f.calls[2].args.slice(1), ['openclaw', 'health', '--json']);
  for (const call of f.calls) {
    assert.equal(call.command, join(f.base, 'node.exe'));
    assert.equal(call.options.windowsHide, true);
    assert.deepEqual(call.options.stdio, ['pipe', 'pipe', 'pipe']);
    assert.equal(call.options.env.GEMINI_API_KEY, KEY);
    assert.equal(call.options.env.GOOGLE_API_KEY, '');
    assert.equal(call.options.env.GIDEON_NO_OPEN, '1');
    assert.equal(call.options.env.GIDEON_STATE_DIR, f.stateDir);
  }
  for (const update of f.statuses) expectPrivateStatus(update);
  await f.controller.stop();
});

test('loopback HTTP health alone cannot make the gateway ready', async t => {
  let clock = 0;
  const f = await fixture(t, {
    now: () => clock, startupTimeoutMs: 1_000, delay: async () => { clock += 300; },
    onSpawn({ args, child }) {
      if (args.includes('setup-desktop')) queueMicrotask(() => child.close());
      else if (args.includes('health')) queueMicrotask(() => { child.stdout.write('{"ok":false}'); child.close(); });
    },
  });
  await f.controller.saveKey(KEY);
  const status = await f.controller.start();
  assert.equal(status.phase, 'error');
  assert.equal(status.gatewayReady, false);
  assert.equal(f.statuses.some(update => update.phase === 'ready'), false);
  assert.equal(f.calls[1].child.stopped, true);
});

test('malformed authenticated health never reports ready', async t => {
  let clock = 0;
  const f = await fixture(t, {
    now: () => clock, startupTimeoutMs: 1_000, delay: async () => { clock += 600; },
    onSpawn({ args, child }) {
      if (args.includes('setup-desktop')) queueMicrotask(() => child.close());
      else if (args.includes('health')) queueMicrotask(() => { child.stdout.write('not-json'); child.close(); });
    },
  });
  await f.controller.saveKey(KEY);
  const status = await f.controller.start();
  assert.equal(status.phase, 'error');
  assert.equal(status.gatewayReady, false);
});

test('runtime failure maps to a safe message without raw stderr or a secret', async t => {
  const f = await fixture(t, {
    onSpawn({ args, child }) {
      if (args.includes('setup-desktop')) queueMicrotask(() => {
        child.stderr.write(`Private failure with ${KEY} and ${TOKEN} at /private/config`);
        child.close(1);
      });
    },
  });
  await f.controller.saveKey(KEY);
  const status = await f.controller.start();
  assert.equal(status.phase, 'error');
  assert.equal(status.gatewayReady, false);
  expectPrivateStatus(status, '/private/config', 'Private failure');
  assert.equal(f.calls.length, 1);
});

test('a missing bundled Node executable is reported without leaking its raw error', async t => {
  const f = await fixture(t, {
    onSpawn({ child }) { queueMicrotask(() => child.emit('error', Object.assign(new Error(KEY), { code: 'ENOENT' }))); },
  });
  await f.controller.saveKey(KEY);
  const status = await f.controller.start();
  assert.equal(status.phase, 'error');
  assert.match(status.message, /çalışma motoru bulunamadı/u);
  expectPrivateStatus(status);
});

test('stop requests the owned engine to shut down and never targets a PID', async t => {
  const f = await fixture(t);
  await f.controller.saveKey(KEY);
  await f.controller.start();
  const owned = f.calls[1].child;
  const status = await f.controller.stop();
  assert.equal(status.gatewayReady, false);
  assert.equal(owned.stopped, true);
  assert.equal(owned.killCalls, 0);
  assert.equal(f.calls.length, 3);
});

test('stop during preparation cancels startup and never launches an engine afterward', async t => {
  let prepared;
  const preparing = new Promise(accept => { prepared = accept; });
  const f = await fixture(t, { onSpawn(call) { prepared(call.child); } });
  await f.controller.saveKey(KEY);
  const opening = f.controller.start();
  const child = await preparing;
  const stopping = f.controller.stop();
  const [opened, stopped] = await Promise.all([opening, stopping]);
  assert.equal(opened.gatewayReady, false);
  assert.equal(stopped.gatewayReady, false);
  assert.equal(stopped.phase, 'welcome');
  assert.equal(child.killCalls, 1);
  assert.equal(f.calls.length, 1);
});

test('preparation exceeding the startup budget reports an error instead of a welcome screen', async t => {
  const f = await fixture(t, { startupTimeoutMs: 15, onSpawn() {} });
  await f.controller.saveKey(KEY);
  const status = await f.controller.start();
  assert.equal(status.phase, 'error');
  assert.equal(status.gatewayReady, false);
  assert.match(status.message, /zamanında açılamadı/u);
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].child.killCalls, 1);
});

test('a failing engine cannot become ready even if an existing HTTP service answers health', async t => {
  const f = await fixture(t, {
    onSpawn({ args, child }) {
      if (args.includes('setup-desktop')) queueMicrotask(() => child.close());
      else if (args[0].endsWith('desktop-engine.mjs')) queueMicrotask(() => child.close(1));
      else if (args.includes('health')) queueMicrotask(() => { child.stdout.write('{"ok":true}'); child.close(); });
    },
  });
  await f.controller.saveKey(KEY);
  const status = await f.controller.start();
  assert.equal(status.phase, 'error');
  assert.equal(status.gatewayReady, false);
  assert.equal(f.statuses.some(update => update.phase === 'ready'), false);
});

test('hung owned-engine shutdown uses only its own child handle as a bounded fallback', async t => {
  const f = await fixture(t, {
    stopTimeoutMs: 1,
    onSpawn({ args, child }) {
      if (args.includes('setup-desktop')) queueMicrotask(() => child.close());
      else if (args.includes('health')) queueMicrotask(() => { child.stdout.write('{"ok":true}'); child.close(); });
      else child.stdin.removeAllListeners('data');
    },
  });
  await f.controller.saveKey(KEY);
  await f.controller.start();
  const status = await f.controller.stop();
  assert.equal(status.phase, 'welcome');
  assert.equal(status.gatewayReady, false);
  assert.equal(f.calls[1].child.killCalls, 1);
  assert.equal(f.calls[0].child.killCalls, 0);
  assert.equal(f.calls[2].child.killCalls, 0);
});

test('excessive child output stays bounded and cannot pretend authenticated readiness', async t => {
  let clock = 0;
  const f = await fixture(t, {
    now: () => clock, startupTimeoutMs: 1_000, delay: async () => { clock += 600; },
    onSpawn({ args, child }) {
      if (args.includes('setup-desktop')) queueMicrotask(() => child.close());
      else if (args.includes('health')) queueMicrotask(() => {
        child.stdout.write(`{"ok":true,"details":"${'x'.repeat(100_000)}${KEY}"}`);
        child.stderr.write(TOKEN.repeat(10_000));
        child.close();
      });
    },
  });
  await f.controller.saveKey(KEY);
  const status = await f.controller.start();
  assert.equal(status.phase, 'error');
  assert.equal(status.gatewayReady, false);
  for (const update of f.statuses) expectPrivateStatus(update);
});

test('unexpected owned-engine exit clears ready without claiming a Gemini test', async t => {
  const f = await fixture(t);
  await f.controller.saveKey(KEY);
  await f.controller.start();
  f.calls[1].child.close(9);
  await Promise.resolve();
  const status = f.controller.getStatus();
  assert.equal(status.phase, 'error');
  assert.equal(status.gatewayReady, false);
  expectPrivateStatus(status);
});

test('forgetting the key gracefully stops the owned engine before deleting storage', async t => {
  const f = await fixture(t);
  await f.controller.saveKey(KEY);
  await f.controller.start();
  const status = await f.controller.forgetKey();
  assert.equal(f.calls[1].child.stopped, true);
  assert.equal(status.hasKey, false);
  assert.equal(status.gatewayReady, false);
  await assert.rejects(readFile(f.credentialsPath), { code: 'ENOENT' });
});

test('replacing the key shuts down the old engine and uses the new key on restart', async t => {
  const f = await fixture(t);
  await f.controller.saveKey(KEY);
  await f.controller.start();
  const replacement = 'second-synthetic-key-for-unit-tests';
  const status = await f.controller.saveKey(replacement);
  assert.equal(status.phase, 'welcome');
  assert.equal(status.gatewayReady, false);
  assert.equal(f.calls[1].child.stopped, true);
  await f.controller.start();
  assert.equal(f.calls[4].options.env.GEMINI_API_KEY, replacement);
  await f.controller.stop();
});

test('credential symlinks are refused without reading, following, replacing or deleting the target', async t => {
  const f = await fixture(t);
  const foreign = join(f.base, 'foreign-file');
  await writeFile(foreign, 'private sentinel', { mode: 0o600 });
  await symlink(foreign, f.credentialsPath);
  const initialized = await f.controller.initialize();
  assert.equal(initialized.phase, 'error');
  const saved = await f.controller.saveKey(KEY);
  assert.equal(saved.phase, 'error');
  assert.equal((await lstat(f.credentialsPath)).isSymbolicLink(), true);
  const forgotten = await f.controller.forgetKey();
  assert.equal(forgotten.phase, 'error');
  assert.equal(await readFile(foreign, 'utf8'), 'private sentinel');
});

test('credential hard links are refused and their foreign target stays unchanged', async t => {
  const f = await fixture(t);
  const foreign = join(f.base, 'foreign-file');
  await writeFile(foreign, 'hard-linked sentinel', { mode: 0o600 });
  await link(foreign, f.credentialsPath);
  assert.equal((await f.controller.initialize()).phase, 'error');
  assert.equal((await f.controller.saveKey(KEY)).phase, 'error');
  assert.equal((await f.controller.forgetKey()).phase, 'error');
  assert.equal(await readFile(foreign, 'utf8'), 'hard-linked sentinel');
  assert.equal((await lstat(foreign)).nlink, 2);
});

test('unsafe config paths are refused before the engine starts', async t => {
  const f = await fixture(t);
  await f.controller.saveKey(KEY);
  const path = join(f.stateDir, 'openclaw.json');
  await rm(path);
  const foreign = join(f.base, 'foreign-config.json');
  await writeFile(foreign, JSON.stringify({ secret: TOKEN }), { mode: 0o600 });
  await symlink(foreign, path);
  const status = await f.controller.start();
  assert.equal(status.phase, 'error');
  assert.equal(f.calls.length, 1);
  expectPrivateStatus(status);
});

test('a corrupt encrypted credential produces only a generic error', async t => {
  const f = await fixture(t, { secureStore: { available: () => true, decrypt() { throw new Error(`decrypt failed: ${KEY}`); } } });
  await writeFile(f.credentialsPath, 'corrupt-ciphertext', { mode: 0o600 });
  const status = await f.controller.initialize();
  assert.equal(status.phase, 'error');
  assert.equal(status.hasKey, false);
  expectPrivateStatus(status, 'decrypt failed', 'corrupt-ciphertext');
});

test('status snapshots cannot mutate controller state', async t => {
  const f = await fixture(t);
  const status = await f.controller.initialize();
  status.phase = 'ready';
  status.hasKey = true;
  status.gatewayReady = true;
  const actual = f.controller.getStatus();
  assert.equal(actual.phase, 'welcome');
  assert.equal(actual.hasKey, false);
  assert.equal(actual.gatewayReady, false);
});

test('injected authentication is reused without writing it to disk', async t => {
  const previousGemini = process.env.GEMINI_API_KEY;
  const previousGoogle = process.env.GOOGLE_API_KEY;
  t.after(() => {
    if (previousGemini === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = previousGemini;
    if (previousGoogle === undefined) delete process.env.GOOGLE_API_KEY; else process.env.GOOGLE_API_KEY = previousGoogle;
  });
  process.env.GEMINI_API_KEY = KEY;
  delete process.env.GOOGLE_API_KEY;
  const f = await fixture(t, { secureStore: { available: () => false } });
  const status = await f.controller.initialize();
  assert.equal(status.hasKey, true);
  await f.controller.start();
  assert.equal(f.calls[1].options.env.GEMINI_API_KEY, KEY);
  await assert.rejects(readFile(f.credentialsPath), { code: 'ENOENT' });
  await f.controller.stop();
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { setupProfile } from '../lib/profile.mjs';
import { acquireRuntime, assertStopped } from '../lib/runtime.mjs';

async function fixture(t) {
  const state = await mkdtemp(join(tmpdir(), 'gideon-runtime-'));
  await setupProfile(state); t.after(() => rm(state, { recursive: true, force: true })); return state;
}

test('başlatma sırasında bile ikinci başlatıcı ve yedek engellenir', async t => {
  const state = await fixture(t); const release = await acquireRuntime(state);
  await assert.rejects(acquireRuntime(state), /zaten çalışıyor/);
  await assert.rejects(assertStopped(state, 18799), /Ctrl\+C/);
  await release(); await assert.rejects(readFile(join(state, 'launcher-runtime.json')), { code: 'ENOENT' });
});

test('kimlik doğrulama gerektirmeyen port kontrolü canlı hizmeti fark eder', async t => {
  const state = await fixture(t); const server = createServer();
  server.listen(0, '127.0.0.1'); await once(server, 'listening'); const { port } = server.address();
  await assert.rejects(assertStopped(state, port), /hizmet çalışıyor/);
  await new Promise(r => server.close(r));
  await assertStopped(state, port);
});

test('bozuk hizmet kilidi sessizce atlanmaz', async t => {
  const state = await fixture(t); await writeFile(join(state, 'launcher-runtime.json'), '{"pid":"invalid"}');
  await assert.rejects(acquireRuntime(state), /doğrulanamadı/);
  await assert.rejects(assertStopped(state, 18799), /doğrulanamadı/);
});

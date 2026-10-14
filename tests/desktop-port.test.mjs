import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { chooseDesktopPort } from '../lib/desktop-port.mjs';

test('ilk açılış dolu porta müdahale etmeden boş port seçer', async t => {
  const state = await mkdtemp(join(tmpdir(), 'gideon-port-')); t.after(() => rm(state, { recursive: true, force: true }));
  const server = createServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(r => server.close(r)));
  const occupied = server.address().port;
  const selected = await chooseDesktopPort(state, occupied);
  assert.notEqual(selected, occupied); assert.ok(selected > 1023);
  assert.equal(server.listening, true);
});

test('mevcut yapılandırmada bağlantı adresini sessizce değiştirmez', async t => {
  const state = await mkdtemp(join(tmpdir(), 'gideon-port-existing-')); t.after(() => rm(state, { recursive: true, force: true }));
  await writeFile(join(state, 'openclaw.json'), '{"gateway":{"port":18799}}');
  assert.equal(await chooseDesktopPort(state, 18799), 18799);
});

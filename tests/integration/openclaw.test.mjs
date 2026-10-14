import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { setupProfile, ROOT, openclawEnv } from '../../lib/profile.mjs';
import { runOpenClaw } from '../../scripts/gideon.mjs';
import { createBackup, restoreBackup } from '../../lib/backup.mjs';

async function freePort() {
  const server = createServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const { port } = server.address(); await new Promise(r => server.close(r)); return port;
}

test('resmî OpenClaw üzerinde GIDEON çalışma akışı', { timeout: 180_000 }, async t => {
  const temp = await mkdtemp(join(tmpdir(), 'gideon-integration-'));
  const stateDir = join(temp, 'state'); const port = await freePort();
  await setupProfile(stateDir, { port });
  let server; let output = '';
  async function command(args) {
    const result = await runOpenClaw(args, { stateDir, capture: true });
    assert.equal(result.code, 0, `OpenClaw command failed: ${args.slice(0, 3).join(' ')}: ${result.stderr.slice(0, 800)}`);
    return result.stdout;
  }
  const rpc = async (method, params = {}) => JSON.parse(await command(['gateway', 'call', method, '--params', JSON.stringify(params), '--json']));
  async function stop() {
    if (!server || server.exitCode !== null) return;
    const closed = once(server, 'close');
    const kill = signal => {
      try { if (process.platform !== 'win32') process.kill(-server.pid, signal); else server.kill(signal); } catch (e) { if (e.code !== 'ESRCH') throw e; }
    };
    kill('SIGTERM');
    const timeout = setTimeout(() => kill('SIGKILL'), 15_000);
    await closed; clearTimeout(timeout);
  }
  async function start() {
    output = '';
    server = spawn(process.execPath, [join(ROOT, 'scripts', 'gideon.mjs'), 'start'], {
      cwd: ROOT, env: { ...openclawEnv(stateDir), GIDEON_STATE_DIR: stateDir, GEMINI_API_KEY: '', GOOGLE_API_KEY: '' },
      stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32',
    });
    server.stdout.on('data', d => { output += d; }); server.stderr.on('data', d => { output += d; });
    let ready = false;
    for (let attempt = 0; attempt < 450; attempt++) {
      if (server.exitCode !== null) throw new Error(`Gateway exited before readiness: ${output.slice(-1400)}`);
      try { const response = await fetch(`http://127.0.0.1:${port}/healthz`); if (response.ok) { ready = true; break; } } catch {}
      await new Promise(r => setTimeout(r, 100));
    }
    assert.equal(ready, true, `Gateway readiness timeout: ${output.slice(-1400)}`);
    const health = JSON.parse(await command(['health', '--json'])); assert.equal(health.ok, true);
  }
  t.after(async () => { await stop(); await rm(temp, { recursive: true, force: true }); });

  await t.test('şema ve koruma eklentisi gerçek sürümde yüklenir', async () => {
    await command(['config', 'validate']);
    const inspection = JSON.parse(await command(['plugins', 'inspect', 'gideon-guard', '--runtime', '--json']));
    assert.match(JSON.stringify(inspection), /before_tool_call/);
    assert.equal(inspection.plugin.status, 'loaded');
    assert.equal(inspection.plugin.enabled, true);
  });
  await start();
  await t.test('panel sunulur; yetkisiz araç çağrısı reddedilir', async () => {
    const panel = await fetch(`http://127.0.0.1:${port}/`); assert.equal(panel.status, 200);
    assert.match(await panel.text(), /openclaw/i);
    const forbidden = await fetch(`http://127.0.0.1:${port}/tools/invoke`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tool: 'cron', args: { action: 'status' } }) });
    assert.equal(forbidden.status, 401);
  });
  await t.test('üç gerçek oturumda sentetik transkriptler saklanır', async () => {
    for (let i = 1; i <= 3; i++) {
      const sessionKey = `agent:main:gideon-test-${i}`;
      await rpc('sessions.create', { key: sessionKey, agentId: 'main', label: `GIDEON integration ${i}` });
      await rpc('chat.inject', { sessionKey, message: `GideonArchiveSentinel${i}: Bu kayıt yalnızca arşiv altyapısı testidir. Tura projesi için sentetik bir konuşma; kullanıcı bilgisi değildir.`, label: 'TEST' });
      const history = await rpc('chat.history', { sessionKey, limit: 20 });
      assert.match(JSON.stringify(history), new RegExp(`GideonArchiveSentinel${i}`));
    }
  });
  await t.test('asıl not ve oturum kaynağı resmî FTS aramasından bulunur', async () => {
    await writeFile(join(stateDir, 'workspace', 'memory', '2026-10-14.md'), '# TEST\nGideonNoteSentinel: Kaynaklı hafıza testi, yalnızca sentetik içerik.\n');
    await command(['memory', 'index', '--agent', 'main', '--force']);
    const note = await command(['memory', 'search', 'GideonNoteSentinel', '--agent', 'main', '--min-score', '0', '--json']);
    assert.match(note, /GideonNoteSentinel/);
    const transcript = await command(['memory', 'search', 'GideonArchiveSentinel2', '--agent', 'main', '--min-score', '0', '--json']);
    assert.match(transcript, /GideonArchiveSentinel2/);
  });
  let jobId;
  await t.test('gerçek cron deposuna yerel, kapalı test görevi eklenir', async () => {
    const job = JSON.parse(await command(['cron', 'add', '--name', 'GIDEON-INTEGRATION', '--agent', 'main', '--at', '20m', '--session', 'main', '--system-event', 'Sentetik görev testi', '--disabled', '--keep-after-run', '--tz', 'Europe/Istanbul', '--json']));
    jobId = job.id; assert.ok(jobId);
    assert.equal(job.enabled, false); assert.equal(job.payload.kind, 'systemEvent');
  });
  await stop(); await start();
  await t.test('yeniden başlatınca not, üç transkript ve görev korunur', async () => {
    for (let i = 1; i <= 3; i++) assert.match(JSON.stringify(await rpc('chat.history', { sessionKey: `agent:main:gideon-test-${i}`, limit: 20 })), new RegExp(`GideonArchiveSentinel${i}`));
    assert.equal((await rpc('cron.get', { id: jobId })).id, jobId);
    const note = await command(['memory', 'search', 'GideonNoteSentinel', '--agent', 'main', '--min-score', '0', '--json']);
    assert.match(note, /GideonNoteSentinel/);
  });
  await stop();
  await t.test('gerçek OpenClaw SQLite dosyası şifreli yedekten birebir döner', async () => {
    const destination = join(temp, 'state.gideon'); const restored = join(temp, 'restored');
    const password = 'synthetic-integration-passphrase';
    const archive = await createBackup({ stateDir, destination, password }); assert.ok(archive.fileCount > 6);
    await restoreBackup({ archivePath: destination, destination: restored, password });
    assert.deepEqual(await readFile(join(stateDir, 'openclaw.json')), await readFile(join(restored, 'openclaw.json')));
    assert.deepEqual(await readFile(join(stateDir, 'workspace', 'memory', '2026-10-14.md')), await readFile(join(restored, 'workspace', 'memory', '2026-10-14.md')));
  });
});

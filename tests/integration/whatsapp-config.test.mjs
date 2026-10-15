import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ROOT, setupProfile, openclawEnv } from '../../lib/profile.mjs';
import { runOpenClaw } from '../../scripts/gideon.mjs';

async function availablePort() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  await new Promise(resolve => server.close(resolve));
  return port;
}

test('WhatsApp: eşleştirilmemiş hesap paneli engellemez ve gelen sohbetleri açmaz', { timeout: 180_000 }, async t => {
  const temporary = await mkdtemp(join(tmpdir(), 'gideon-whatsapp-integration-'));
  const stateDir = join(temporary, 'state');
  const port = await availablePort();
  let gateway;
  let output = '';
  t.after(async () => {
    if (gateway && gateway.exitCode === null && gateway.signalCode === null) {
      const closed = once(gateway, 'close');
      gateway.kill('SIGTERM');
      const timer = setTimeout(() => gateway.kill('SIGKILL'), 15_000);
      await closed;
      clearTimeout(timer);
    }
    await rm(temporary, { recursive: true, force: true });
  });

  await setupProfile(stateDir, { port });
  const config = JSON.parse(await readFile(join(stateDir, 'openclaw.json'), 'utf8'));
  const channel = config.channels?.whatsapp;
  assert.ok(channel, 'Yeni GIDEON profilinde WhatsApp kurulumu bulunmalıdır.');
  assert.equal(channel.enabled, true);
  assert.equal(channel.defaultAccount, 'gideon');
  assert.deepEqual(channel.actions, { reactions: false, polls: false, calls: false, sendMessage: true });
  assert.equal(channel.accounts.gideon.enabled, true);
  assert.equal(channel.accounts.gideon.authDir, join(stateDir, 'credentials', 'whatsapp', 'gideon'));
  for (const settings of [channel, channel.accounts.gideon]) {
    assert.equal(settings.dmPolicy, 'disabled');
    assert.equal(settings.groupPolicy, 'disabled');
    assert.equal(settings.configWrites, false);
    assert.equal(settings.sendReadReceipts, false);
    assert.equal(settings.selfChatMode, false);
    assert.equal(settings.reactionLevel, 'off');
  }
  assert.ok(config.plugins.allow.includes('whatsapp'));
  assert.equal(config.plugins.entries.whatsapp.enabled, true);
  assert.ok(config.plugins.load.paths.includes(join(ROOT, 'node_modules', '@openclaw', 'whatsapp')));
  assert.ok(config.tools.allow.includes('message'));
  assert.equal(config.tools.allow.includes('whatsapp_login'), false);
  assert.equal(config.tools.allow.includes('whatsapp_call'), false);

  // No account is linked and no QR/authentication or paid model request is made.
  const env = { ...openclawEnv(stateDir), GEMINI_API_KEY: '', GOOGLE_API_KEY: '' };
  async function command(args) {
    const result = await runOpenClaw(args, { stateDir, env, capture: true });
    assert.equal(result.code, 0, `${args.slice(0, 3).join(' ')}: ${result.stderr.slice(-1200)}`);
    return result.stdout;
  }
  await command(['config', 'validate']);

  const preload = process.platform === 'win32' ? ['--require', join(ROOT, 'lib', 'windows-runtime-preload.cjs')] : [];
  gateway = spawn(process.execPath, [...preload, join(ROOT, 'node_modules', 'openclaw', 'openclaw.mjs'), 'gateway', 'run', '--bind', 'loopback', '--port', String(port)], {
    cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  });
  gateway.stdout.on('data', data => { output += data; });
  gateway.stderr.on('data', data => { output += data; });
  let ready = false;
  for (let attempt = 0; attempt < 600; attempt++) {
    assert.equal(gateway.exitCode, null, `Gateway hazır olmadan durdu: ${output.slice(-2000)}`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/healthz`, { signal: AbortSignal.timeout(1000) });
      if (response.ok) { ready = true; break; }
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.equal(ready, true, `Gateway açılış süresi aşıldı: ${output.slice(-2000)}`);
  const health = JSON.parse(await command(['health', '--json']));
  assert.equal(health.ok, true);
  assert.ok(health.plugins.loaded.includes('whatsapp'));
  assert.deepEqual(health.plugins.errors, []);
  const account = health.channels.whatsapp.accounts.gideon;
  assert.equal(account.enabled, true);
  assert.equal(account.linked, false);
  assert.equal(account.running, false);
  assert.equal(account.dmPolicy, 'disabled');
  assert.equal(account.stateReason, 'not linked');
  assert.equal(account.lastError, null);
  const status = JSON.parse(await command(['gateway', 'call', 'channels.status', '--params', '{}', '--json']));
  assert.equal(status.channelDefaultAccountId.whatsapp, 'gideon');
  assert.equal(status.channels.whatsapp.statusState, 'not-linked');
  assert.equal(status.channels.whatsapp.connected, false);
  assert.equal(status.channels.whatsapp.lastError, null);
  await assert.rejects(stat(join(channel.accounts.gideon.authDir, 'creds.json')), { code: 'ENOENT' });
});

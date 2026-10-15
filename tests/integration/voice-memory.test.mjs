import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { zstdDecompressSync } from 'node:zlib';
import { GatewayClient } from 'openclaw/plugin-sdk/gateway-runtime';
import { ROOT, setupProfile, openclawEnv } from '../../lib/profile.mjs';
import { runOpenClaw } from '../../scripts/gideon.mjs';

// A synthetic voice provider creates only a local Talk ownership record. This
// tests the real finalized-transcript RPC/storage path, not Google audio/STT.
test('finalized Talk speech from both speakers survives duplicate retries and restart', { timeout: 180_000 }, async t => {
  const temporary = await mkdtemp(join(tmpdir(), 'gideon-voice-memory-'));
  const stateDir = join(temporary, 'state');
  const fixture = join(temporary, 'voice-memory-fixture');
  await mkdir(fixture);
  await writeFile(join(fixture, 'package.json'), JSON.stringify({ name: 'gideon-voice-memory-fixture', version: '1.0.0', type: 'module', openclaw: { extensions: ['./index.js'] } }));
  await writeFile(join(fixture, 'openclaw.plugin.json'), JSON.stringify({ id: 'voice-memory-fixture', name: 'Synthetic voice persistence fixture', activation: { onStartup: true }, configSchema: { type: 'object', additionalProperties: false, properties: {} } }));
  await writeFile(join(fixture, 'index.js'), `export default {
    id: 'voice-memory-fixture', name: 'Synthetic voice persistence fixture',
    register(api) {
      api.registerRealtimeVoiceProvider({
        id: 'voice-memory-fixture', label: 'Synthetic voice persistence fixture',
        defaultModel: 'synthetic-transcript-only',
        models: ['synthetic-transcript-only'],
        capabilities: {
          transports: ['provider-websocket'], supportsBrowserSession: true,
          inputAudioFormats: [{ encoding: 'pcm16', sampleRateHz: 16000, channels: 1 }],
          outputAudioFormats: [{ encoding: 'pcm16', sampleRateHz: 24000, channels: 1 }],
          supportsBargeIn: false, supportsToolCalls: false
        },
        isConfigured: () => true,
        createBridge: () => { throw new Error('No audio bridge exists in this test fixture'); },
        createBrowserSession: async () => ({
          provider: 'voice-memory-fixture', transport: 'provider-websocket',
          protocol: 'google-live-bidi', model: 'synthetic-transcript-only',
          clientSecret: 'synthetic-local-fixture-not-a-credential',
          websocketUrl: 'ws://127.0.0.1:1/no-audio-connection-is-opened',
          audio: { inputEncoding: 'pcm16', inputSampleRateHz: 16000, outputEncoding: 'pcm16', outputSampleRateHz: 24000 },
          initialMessage: {}, expiresAt: Date.now() + 300000
        })
      });
    }
  };`);
  const probe = createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
  const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
  await setupProfile(stateDir, { port });
  const configPath = join(stateDir, 'openclaw.json');
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  config.plugins.allow.push('voice-memory-fixture');
  config.plugins.load.paths.push(fixture);
  config.plugins.entries['voice-memory-fixture'] = { enabled: true };
  config.talk.realtime = { provider: 'voice-memory-fixture', providers: { 'voice-memory-fixture': {} }, mode: 'realtime', transport: 'provider-websocket', brain: 'agent-consult', model: 'synthetic-transcript-only' };
  await writeFile(configPath, JSON.stringify(config));
  const env = { ...openclawEnv(stateDir), GEMINI_API_KEY: '', GOOGLE_API_KEY: '', OPENAI_API_KEY: '' };
  let gateway, client;
  let output = '';
  async function stop() {
    if (client) { await client.stopAndWait({ timeoutMs: 5000 }); client = undefined; }
    if (!gateway || gateway.exitCode !== null || gateway.signalCode !== null) return;
    const closed = once(gateway, 'close'); gateway.kill('SIGTERM');
    const timer = setTimeout(() => gateway.kill('SIGKILL'), 15_000);
    await closed; clearTimeout(timer);
  }
  t.after(async () => { await stop(); await rm(temporary, { recursive: true, force: true }); });
  async function start() {
    output = '';
    const preload = process.platform === 'win32' ? ['--require', join(ROOT, 'lib', 'windows-runtime-preload.cjs')] : [];
    gateway = spawn(process.execPath, [...preload, join(ROOT, 'node_modules', 'openclaw', 'openclaw.mjs'), 'gateway', 'run', '--bind', 'loopback', '--port', String(port)], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    gateway.stdout.on('data', data => output += data); gateway.stderr.on('data', data => output += data);
    let ready = false;
    for (let attempt = 0; attempt < 600; attempt++) {
      assert.equal(gateway.exitCode, null, `Gateway exited: ${output.slice(-2500)}`);
      try { if ((await fetch(`http://127.0.0.1:${port}/healthz`, { signal: AbortSignal.timeout(1000) })).ok) { ready = true; break; } } catch {}
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.equal(ready, true, `Gateway readiness timed out: ${output.slice(-2500)}`);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Gateway client handshake timed out: ${output.slice(-2000)}`)), 15000);
      client = new GatewayClient({
        url: `ws://127.0.0.1:${port}`, token: config.gateway.auth.token,
        clientName: 'cli', clientVersion: 'synthetic-voice-memory-test', mode: 'cli',
        role: 'operator', scopes: ['operator.admin', 'operator.read', 'operator.write'],
        deviceIdentity: null, env,
        onHelloOk: () => { clearTimeout(timer); resolve(); },
        onConnectError: error => { clearTimeout(timer); reject(error); }
      });
      client.start();
    });
  }
  const validation = await runOpenClaw(['config', 'validate'], { stateDir, env, capture: true });
  assert.equal(validation.code, 0, validation.stderr);
  await start();
  const sessionKey = 'agent:main:synthetic-voice-memory';
  await client.request('sessions.create', { key: sessionKey, agentId: 'main', label: 'Synthetic finalized voice persistence test' });
  const voice = await client.request('talk.client.create', { sessionKey, capabilities: ['voice-transcript'], mode: 'realtime', transport: 'provider-websocket', brain: 'agent-consult' });
  assert.equal(voice.provider, 'voice-memory-fixture');
  assert.ok(voice.voiceSessionId);
  const utterances = Array.from({ length: 120 }, (_, index) => ({
    entryId: `synthetic-utterance-${index}`,
    role: index % 2 === 0 ? 'user' : 'assistant',
    text: `GideonVoiceMemorySentinel${index}: ${index % 2 === 0 ? 'İzmir yolculuğu için kullanıcı konuşması' : 'Kaydedilen Türkçe yardımcı yanıtı'} — yalnızca sentetik kayıt testi.`,
    timestamp: Date.UTC(2026, 9, 15, 5, 0) + index * 30000,
  }));
  for (const utterance of utterances) await client.request('talk.client.transcript', { sessionKey, voiceSessionId: voice.voiceSessionId, ...utterance });
  for (const index of [0, 59, 119]) await client.request('talk.client.transcript', { sessionKey, voiceSessionId: voice.voiceSessionId, ...utterances[index] });
  await client.request('talk.client.close', { sessionKey, voiceSessionId: voice.voiceSessionId });
  function verifyHistory(history) {
    const records = history.messages.filter(message => message.provenance?.kind === 'realtime_voice');
    assert.equal(records.length, utterances.length, 'Duplicate transcript retries must not create duplicate messages.');
    for (const [index, utterance] of utterances.entries()) {
      assert.equal(records[index].role, utterance.role);
      assert.equal(records[index].content.filter(block => block.type === 'text').map(block => block.text).join(''), utterance.text);
    }
  }
  verifyHistory(await client.request('chat.history', { sessionKey, limit: 200 }));
  await stop();
  const database = new DatabaseSync(join(stateDir, 'agents', 'main', 'agent', 'openclaw-agent.sqlite'), { readOnly: true });
  try {
    const rows = database.prepare('SELECT event_json, event_zstd FROM transcript_events WHERE session_id = (SELECT current_session_id FROM session_nodes WHERE session_key = ?) ORDER BY seq').all(sessionKey);
    const entries = rows.map(row => row.event_json ?? zstdDecompressSync(row.event_zstd).toString('utf8')).filter(text => text.includes('GideonVoiceMemorySentinel'));
    assert.equal(entries.length, utterances.length, 'Finalized speech must be present in the actual SQLite transcript store.');
    for (const [index, entry] of entries.entries()) assert.match(entry, new RegExp(`GideonVoiceMemorySentinel${index}:`));
  } finally { database.close(); }
  await setupProfile(stateDir, { port });
  await start();
  verifyHistory(await client.request('chat.history', { sessionKey, limit: 200 }));
});

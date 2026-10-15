import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, readFile, writeFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { ROOT, setupProfile, openclawEnv } from '../../lib/profile.mjs';
import { runOpenClaw } from '../../scripts/gideon.mjs';
import { installDocumentPlugin } from '../../scripts/install-document-plugin.mjs';

// This fixture exercises the real model/tool/WebChat delivery boundary. Its tiny
// local SSE model emits a deterministic tool call; no provider account is used.
test('real WebChat PDF downloads retain exact bytes after Gateway restart', { timeout: 180_000 }, async t => {
  const temp = await mkdtemp(join(tmpdir(), 'gideon-download-integration-'));
  const stateDir = join(temp, 'state');
  const bundledPlugin = await installDocumentPlugin();
  const title = 'Türkçe belge indirme testi — ÇĞİÖŞÜ';
  const content = 'İzmir yolculuğu için sentetik araştırma raporu. Özgürlük ve ölçülülük.';
  const sources = [{ title: 'Resmî karar arama', url: 'https://karararama.yargitay.gov.tr/', citation: 'Sentetik test referansı; gerçek bir karar alıntısı değildir.' }];
  const requests = [];
  const modelErrors = [];
  const model = createServer(async (request, response) => {
    try {
      assert.equal(request.url, '/v1/chat/completions');
      let raw = ''; for await (const chunk of request) raw += chunk;
      const body = JSON.parse(raw); requests.push(body);
      assert.equal(body.model, 'document-fixture');
      const completed = body.messages.some(message => message.role === 'tool');
      if (!completed) assert.ok(body.tools.some(tool => tool.function?.name === 'gideon_document'), 'Document tool must be available to the actual agent');
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      const chunk = (delta, finish_reason = null) => response.write(`data: ${JSON.stringify({ id: 'fixture-completion', object: 'chat.completion.chunk', created: 1, model: body.model, choices: [{ index: 0, delta, finish_reason }] })}\n\n`);
      chunk({ role: 'assistant' });
      if (completed) { chunk({ content: 'Kaynaklı PDF hazır; dosya ekini indirebilirsiniz.' }); chunk({}, 'stop'); }
      else { chunk({ tool_calls: [{ index: 0, id: 'document_fixture_call', type: 'function', function: { name: 'gideon_document', arguments: JSON.stringify({ format: 'pdf', title, content, sources }) } }] }); chunk({}, 'tool_calls'); }
      response.end('data: [DONE]\n\n');
    } catch (error) { modelErrors.push(error); response.writeHead(500); response.end('Synthetic model fixture failed'); }
  });
  model.listen(0, '127.0.0.1'); await once(model, 'listening');
  const probe = createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
  const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
  await setupProfile(stateDir, { port });
  const configPath = join(stateDir, 'openclaw.json');
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  const token = config.gateway.auth.token;
  config.agents.defaults.model = { primary: 'fixture/document-fixture' };
  config.models = { mode: 'merge', providers: { fixture: { baseUrl: `http://127.0.0.1:${model.address().port}/v1`, apiKey: 'synthetic-local-test-key', api: 'openai-completions', models: [{ id: 'document-fixture', name: 'Synthetic document tool fixture', reasoning: false, input: ['text'], contextWindow: 128000, maxTokens: 4096 }] } } };
  config.tools.allow = [...new Set([...config.tools.allow, 'gideon_document'])];
  config.tools.toolSearch = false;
  config.plugins.allow = [...new Set([...config.plugins.allow, 'gideon-documents'])];
  config.plugins.load.paths = [...new Set([...config.plugins.load.paths.filter(path => !path.replaceAll('\\', '/').endsWith('/extensions/gideon-documents')), bundledPlugin])];
  config.plugins.entries['gideon-documents'] = { enabled: true, config: { workspace: join(stateDir, 'workspace'), stateDir } };
  await writeFile(configPath, JSON.stringify(config));
  let server, output = '';
  async function command(args) {
    const result = await runOpenClaw(args, { stateDir, capture: true });
    assert.equal(result.code, 0, `${args.slice(0, 3).join(' ')} failed: ${result.stderr.slice(-1200)}`);
    return result.stdout;
  }
  const rpc = async (method, params = {}) => JSON.parse(await command(['gateway', 'call', method, '--params', JSON.stringify(params), '--json']));
  async function stop() {
    if (!server || server.exitCode !== null || server.signalCode !== null) return;
    const closed = once(server, 'close');
    const kill = signal => { try { process.platform === 'win32' ? server.kill(signal) : process.kill(-server.pid, signal); } catch (error) { if (error.code !== 'ESRCH') throw error; } };
    kill('SIGTERM'); const timer = setTimeout(() => kill('SIGKILL'), 15_000);
    await closed; clearTimeout(timer);
  }
  async function start() {
    output = '';
    server = spawn(process.execPath, [join(ROOT, 'scripts', 'gideon.mjs'), 'start'], { cwd: ROOT, env: { ...openclawEnv(stateDir), GIDEON_STATE_DIR: stateDir, GEMINI_API_KEY: '', GOOGLE_API_KEY: '', OPENAI_API_KEY: '' }, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32' });
    server.stdout.on('data', data => output += data); server.stderr.on('data', data => output += data);
    for (let attempt = 0; attempt < 450; attempt++) {
      if (server.exitCode !== null) throw new Error(`Gateway exited: ${output.slice(-2000)}`);
      try { if ((await fetch(`http://127.0.0.1:${port}/healthz`)).ok) return; } catch {}
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error(`Gateway readiness timed out: ${output.slice(-2000)}`);
  }
  t.after(async () => { await stop(); await new Promise(resolve => model.close(resolve)); await rm(temp, { recursive: true, force: true }); });
  await command(['config', 'validate']);
  await start();
  const sessionKey = 'agent:main:document-download-fixture';
  await rpc('sessions.create', { key: sessionKey, agentId: 'main', label: 'Synthetic PDF download test' });
  await rpc('chat.send', { sessionKey, message: 'Sentetik test: gideon_document ile belirtilen PDF oluştur.', idempotencyKey: randomUUID() });
  let history, attachment;
  const visit = value => {
    if (!value || typeof value !== 'object') return;
    if (value.type === 'attachment' && value.attachment?.url?.includes('/api/chat/media/outgoing/')) attachment = value.attachment;
    for (const child of Object.values(value)) if (child && typeof child === 'object') Array.isArray(child) ? child.forEach(visit) : visit(child);
  };
  for (let attempt = 0; attempt < 35; attempt++) {
    assert.deepEqual(modelErrors, []);
    history = await rpc('chat.history', { sessionKey, limit: 30 }); visit(history);
    if (attachment) break;
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  assert.ok(attachment, `No downloadable PDF reached real chat.history: ${JSON.stringify(history).slice(-4500)}; gateway: ${output.slice(-2500)}; model requests: ${requests.length}`);
  assert.equal(attachment.mimeType, 'application/pdf');
  assert.ok(requests.length >= 2, 'The agent must finish the tool-result continuation');
  const url = new URL(attachment.url, `http://127.0.0.1:${port}`);
  url.searchParams.delete('mediaTicket');
  const auth = { headers: { authorization: `Bearer ${token}` } };
  assert.equal((await fetch(url)).status, 401, 'An unauthenticated caller cannot retrieve the report');
  const download = await fetch(url, auth);
  assert.equal(download.status, 200);
  assert.match(download.headers.get('content-type'), /^application\/pdf/);
  assert.match(download.headers.get('content-disposition'), /attachment/);
  const bytes = Buffer.from(await download.arrayBuffer());
  assert.match(bytes.subarray(0, 8).toString(), /^%PDF-/);
  const reports = await readdir(join(stateDir, 'workspace', 'reports'));
  assert.equal(reports.filter(name => name.endsWith('.pdf')).length, 1);
  const original = await readFile(join(stateDir, 'workspace', 'reports', reports.find(name => name.endsWith('.pdf'))));
  assert.deepEqual(bytes, original, 'WebChat attachment must contain the actual generated document bytes');
  const forged = new URL(url); forged.pathname = forged.pathname.replace(/\/[^/]+\/full$/, `/${randomUUID()}/full`);
  assert.equal((await fetch(forged, auth)).status, 404);
  const wrongSession = new URL(url); wrongSession.pathname = wrongSession.pathname.replace(encodeURIComponent(sessionKey), encodeURIComponent('agent:main:other-fixture'));
  assert.equal((await fetch(wrongSession, auth)).status, 404);
  await stop(); await start();
  const afterRestart = await fetch(url, auth);
  assert.equal(afterRestart.status, 200, 'A generated report remains downloadable after Gateway restart');
  assert.equal(createHash('sha256').update(Buffer.from(await afterRestart.arrayBuffer())).digest('hex'), createHash('sha256').update(original).digest('hex'));
});

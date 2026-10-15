import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, symlink, link, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import { createGuard } from '../extensions/gideon-guard/policy.js';

async function fixture(t, options = {}) {
  const base = await mkdtemp(path.join(os.tmpdir(), 'gideon-guard-'));
  const workspace = path.join(base, 'workspace');
  await mkdir(workspace);
  await mkdir(path.join(base, 'media', 'inbound'), { recursive: true });
  await writeFile(path.join(workspace, 'SOUL.md'), 'protected policy');
  await writeFile(path.join(base, 'outside.txt'), 'private outside data');
  t.after(() => rm(base, { recursive: true, force: true }));
  const guard = createGuard({ workspace, stateDir: base, agentId: 'main' }, options);
  const call = (toolName, params, ctx = { agentId: 'main' }, extra = {}) =>
    guard({ toolName, params, ...extra }, ctx);
  return { base, workspace, call };
}

function assertBlocked(result) {
  assert.equal(result?.block, true);
  assert.equal(result.requireApproval, undefined);
}

function assertApproval(result) {
  assert.equal(result?.block, undefined);
  assert.deepEqual(result.requireApproval.allowedDecisions, ['allow-once', 'deny']);
  assert.equal(result.requireApproval.timeoutMs, 120_000);
  assert.ok(result.requireApproval.description.length <= 512);
}

const reminder = () => ({
  name: 'Local reminder',
  schedule: { kind: 'at', at: '2030-10-14T10:00:00Z' },
  sessionTarget: 'main',
  payload: { kind: 'systemEvent', text: 'Remember a private task' },
  delivery: { mode: 'none' },
  failureAlert: false,
});

test('workspace and agent identity are mandatory; unknown capabilities fail closed', async (t) => {
  assert.throws(() => createGuard({ workspace: 'relative' }));
  const { call } = await fixture(t);
  assertBlocked(await call('write', { path: 'memory/note.md', content: 'x' }, {}));
  assertBlocked(await call('memory_get', { path: 'MEMORY.md' }, { agentId: 'other' }));
  for (const tool of ['exec', 'process', 'browser', 'message', 'gateway', 'nodes', 'sessions_spawn', 'new_plugin_tool']) {
    assertBlocked(await call(tool, {}));
  }
});

test('local safe reads and memory recall remain available', async (t) => {
  const { call } = await fixture(t);
  assert.equal(await call('read', { path: 'SOUL.md' }), undefined);
  for (const tool of ['memory_search', 'memory_get', 'session_status', 'sessions_history', 'talk_voice']) {
    assert.equal(await call(tool, {}), undefined);
  }
  assertBlocked(await call('read', { path: '../outside.txt' }));
  assertBlocked(await call('read', { path: '.env' }));
});

test('file mutations request native single-use approval without exposing contents', async (t) => {
  const { call, workspace } = await fixture(t);
  for (const tool of ['write', 'edit']) {
    const result = await call(tool, { path: 'memory/new.md', content: 'SECRET_VALUE', newText: 'SECRET_VALUE' });
    assertApproval(result);
    assert.ok(result.requireApproval.description.includes(path.join('memory', 'new.md')));
    assert.ok(!JSON.stringify(result.requireApproval).includes('SECRET_VALUE'));
    assert.equal(result.params.path, 'memory/new.md');
  }
  // A pending or denied approval must not change anything: the hook only returns a decision.
  assert.equal(await readFile(path.join(workspace, 'SOUL.md'), 'utf8'), 'protected policy');
  await assert.rejects(readFile(path.join(workspace, 'memory', 'new.md')), { code: 'ENOENT' });
});

test('traversal, protected policy names, hidden paths and ambiguous aliases are blocked', async (t) => {
  const { call, base } = await fixture(t);
  for (const target of [
    '../outside.txt', path.join(base, 'outside.txt'), 'SOUL.md', 'nested/aGeNtS.mD',
    'IDENTITY.md', 'TOOLS.md', 'USER.md', 'HEARTBEAT.md', 'BOOTSTRAP.md',
    'openclaw.json', '.env', 'notes/.private/key', 'SOUL.md.', 'SOUL.md ',
    'notes:file', '~/note.md', '@note.md', 'C:\\outside.txt', 'a\0b',
  ]) assertBlocked(await call('write', { path: target, content: 'changed' }));
  assertBlocked(await call('write', { path: 'notes/a.md', file_path: '../outside.txt' }));
  assertBlocked(await call('write', { content: 'changed' }));
});

test('symlinks and hardlinks cannot escape path or persona protections', async (t) => {
  const { call, workspace, base } = await fixture(t);
  await symlink(path.join(base, 'outside.txt'), path.join(workspace, 'outside-link'));
  await symlink(path.join(workspace, 'SOUL.md'), path.join(workspace, 'policy-link'));
  await symlink(base, path.join(workspace, 'dir-link'));
  await link(path.join(workspace, 'SOUL.md'), path.join(workspace, 'policy-hardlink'));
  for (const target of ['outside-link', 'policy-link', 'dir-link/new.txt', 'policy-hardlink']) {
    assertBlocked(await call('write', { path: target, content: 'changed' }));
    assertBlocked(await call('read', { path: target }));
  }
  assert.equal(await readFile(path.join(workspace, 'SOUL.md'), 'utf8'), 'protected policy');
});

test('patch validates every add, update, delete and move target rather than derived hints', async (t) => {
  const { call } = await fixture(t);
  const valid = '*** Begin Patch\n*** Add File: notes/a.md\n+content\n*** Update File: notes/b.md\n*** Move to: notes/c.md\n@@\n-old\n+new\n*** End Patch';
  assertApproval(await call('apply_patch', { input: valid }));
  for (const input of [
    valid.replace('notes/c.md', '../outside.txt'),
    valid.replace('notes/b.md', 'SOUL.md'),
    '*** Begin Patch\n*** Delete File: IDENTITY.md\n*** End Patch',
    '*** Begin Patch\n*** Add File: notes/a.md\n+x\n*** Delete File: ../outside.txt\n*** End Patch',
    '*** Begin Patch\n*** Move to: notes/a.md\n*** End Patch',
    'garbage', '*** Begin Patch\n*** End Patch',
  ]) assertBlocked(await call('apply_patch', { input }, { agentId: 'main' }, { derivedPaths: ['notes/safe.md'] }));
});

test('cron reads need no approval; all unknown actions and endpoint overrides are blocked', async (t) => {
  const { call } = await fixture(t);
  for (const tool of ['cron', 'automations']) {
    for (const action of ['status', 'list', 'get', 'runs']) assert.equal(await call(tool, { action }), undefined);
    for (const action of ['wake', 'next_check', 'new-action', undefined]) assertBlocked(await call(tool, { action }));
    assertBlocked(await call(tool, { action: 'list', gatewayUrl: 'https://external.invalid' }));
    assertBlocked(await call(tool, { action: 'list', gatewayToken: 'SECRET_VALUE' }));
  }
});

test('only local systemEvent reminders can be created; scheduled scripts and outbound routes are blocked', async (t) => {
  const { call } = await fixture(t);
  const result = await call('automations', { action: 'add', job: reminder() });
  assertApproval(result);
  assert.ok(!JSON.stringify(result.requireApproval).includes('private task'));
  assert.equal(result.params.job.payload.kind, 'systemEvent');
  for (const change of [
    { payload: { kind: 'agentTurn', message: 'run tools' } },
    { payload: { kind: 'script', command: 'echo hello' } },
    { delivery: { mode: 'announce', channel: 'telegram', to: 'target' } },
    { delivery: { mode: 'webhook', to: 'https://external.invalid' } },
    { delivery: { mode: 'none', completionDestination: { to: 'https://external.invalid' } } },
    { failureAlert: { channel: 'telegram', to: 'target' } },
    { sessionTarget: 'isolated' }, { agentId: 'other' },
    { trigger: { kind: 'condition', command: 'echo hello' } },
    { schedule: { kind: 'stream' } }, { owner: { agentId: 'main' } },
  ]) assertBlocked(await call('cron', { action: 'add', job: { ...reminder(), ...change } }));
});

test('cron run/update inspect the existing definition and fail closed on missing or failed runtime', async (t) => {
  let reads = 0;
  const { call } = await fixture(t, { getJob: async (id) => { reads++; assert.equal(id, 'job-1'); return { ...reminder(), id }; } });
  assertApproval(await call('automations', { action: 'run', jobId: 'job-1' }));
  assertApproval(await call('automations', { action: 'update', jobId: 'job-1', job: { enabled: false } }));
  assert.equal(reads, 2);
  assertBlocked(await call('automations', { action: 'update', jobId: 'job-1', job: { agentId: 'other' } }));
  assertBlocked(await call('automations', { action: 'update', jobId: 'job-1', job: { delivery: { mode: 'webhook', to: 'https://external.invalid' } } }));
  assertApproval(await call('automations', { action: 'remove', jobId: 'job-1' }));
  assertBlocked(await call('automations', { action: 'remove', jobId: 'job-1', id: 'other-id' }));
  const noRuntime = createGuard({ workspace: (await fixture(t)).workspace });
  assertBlocked(await noRuntime({ toolName: 'cron', params: { action: 'run', jobId: 'job-1' } }, { agentId: 'main' }));
  const brokenRuntime = createGuard({ workspace: (await fixture(t)).workspace }, { getJob: async () => { throw new Error('offline'); } });
  assertBlocked(await brokenRuntime({ toolName: 'cron', params: { action: 'run', jobId: 'job-1' } }, { agentId: 'main' }));
});

test('public research works while local networks, credential URLs and secret queries are blocked', async (t) => {
  const { call } = await fixture(t);
  assert.equal(await call('web_search', { query: 'Yargıtay kira sözleşmesi emsal karar', count: 5 }), undefined);
  assert.equal(await call('web_fetch', { url: 'https://www.mevzuat.gov.tr/', extractMode: 'text', maxChars: 30_000 }), undefined);
  for (const url of ['http://localhost:18799', 'https://127.0.0.1/', 'https://[::1]/', 'http://2130706433/',
    'http://0x7f000001/', 'https://example.internal/', 'https://private/', 'file:///etc/passwd',
    'ftp://example.com/file', 'https://user:password@example.com/', 'https://example.com/?token=synthetic',
    'https://example.com/?api_key=synthetic', 'https://example.com:18799/', 'https://example.com\\@localhost/']) {
    assertBlocked(await call('web_fetch', { url }));
  }
  assertBlocked(await call('web_fetch', { url: 'https://example.com/', headers: { authorization: 'synthetic' } }));
  assertBlocked(await call('web_fetch', { url: 'https://example.com/', maxChars: 1_000_000 }));
  assertBlocked(await call('web_search', { query: `AIza${'x'.repeat(30)}` }));
  assertBlocked(await call('web_search', { query: 'http://localhost/private' }));
  assertBlocked(await call('web_search', { query: 'ordinary query', gatewayToken: 'synthetic' }));
  assertBlocked(await call('web_search', { query: 'ordinary query', language: `AIza${'x'.repeat(30)}` }));
});

test('PDF paths normalize within workspace or inbound media and reject credential/link escapes', async (t) => {
  const { call, workspace, base } = await fixture(t);
  const local = path.join(workspace, 'document.pdf');
  const inbound = path.join(base, 'media', 'inbound', 'upload.pdf');
  await writeFile(local, '%PDF-1.7\nsynthetic PDF fixture');
  await writeFile(inbound, '%PDF-1.7\nsynthetic inbound fixture');
  const localResult = await call('pdf', { pdf: 'document.pdf', prompt: 'Özetle.' });
  assert.deepEqual(localResult.params.pdfs, [local]);
  assert.deepEqual((await call('pdf', { pdf: pathToFileURL(local).href })).params.pdfs, [local]);
  const merged = await call('pdf', { pdf: 'document.pdf', pdfs: ['media://inbound/upload.pdf', 'https://example.com/decision.pdf'] });
  assert.deepEqual(merged.params.pdfs, [local, inbound, 'https://example.com/decision.pdf']);
  for (const pdf of ['../outside.pdf', path.join(base, 'credentials', 'auth.pdf'), 'http://example.com/a.pdf',
    'https://localhost/a.pdf', 'media://inbound/../auth.pdf', 'media://inbound/%2e%2e%2fauth.pdf',
    'media://credentials/key.pdf', '.hidden.pdf', 'document.txt']) assertBlocked(await call('pdf', { pdf }));
  assertBlocked(await call('pdf', { pdf: 'document.pdf', maxBytesMb: 500 }));
  assertBlocked(await call('pdf', { pdf: 'document.pdf', pages: '1-3' }));
  assertBlocked(await call('pdf', { pdf: 'document.pdf', password: 'synthetic-document-password' }));
  assertBlocked(await call('pdf', { pdfs: [null] }));
  assertBlocked(await call('pdf', { pdf: 'document.pdf', model: 'external/other' }));
  await symlink(local, path.join(workspace, 'link.pdf'));
  assertBlocked(await call('pdf', { pdf: 'link.pdf' }));
  await link(local, path.join(workspace, 'hardlink.pdf'));
  assertBlocked(await call('pdf', { pdf: 'hardlink.pdf' }));
  await rm(path.join(base, 'media', 'inbound'), { recursive: true });
  await symlink(workspace, path.join(base, 'media', 'inbound'), 'dir');
  assertBlocked(await call('pdf', { pdf: 'media://inbound/document.pdf' }));
});

test('browser research pins the managed profile and verifies every read target', async (t) => {
  let url = 'https://karararama.yargitay.gov.tr/';
  const { call } = await fixture(t, { getBrowserTab: async (id) => ({ targetId: 'raw_tab_1', suggestedTargetId: id, url }) });
  const opened = await call('browser', { action: 'open', targetUrl: 'https://www.mevzuat.gov.tr/' });
  assert.equal(opened.params.profile, 'openclaw'); assert.equal(opened.params.target, 'host');
  assert.equal((await call('browser', { action: 'status' })).params.profile, 'openclaw');
  assert.equal((await call('browser', { action: 'tabs' })).params.target, 'host');
  const snapshot = await call('browser', { action: 'snapshot', targetId: 'suggested_1', maxChars: 20_000 });
  assert.equal(snapshot.params.targetId, 'raw_tab_1');
  assert.equal((await call('browser', { action: 'read', targetId: 'suggested_1' })).params.action, 'text');
  for (const params of [
    { action: 'open', targetUrl: 'https://example.com', profile: 'user' },
    { action: 'open', targetUrl: 'https://example.com', target: 'node' },
    { action: 'open', targetUrl: 'https://example.com', node: 'other' },
    { action: 'open', targetUrl: 'http://127.0.0.1:18799' },
    { action: 'open', targetUrl: 'https://example.com', url: 'http://localhost/' },
    { action: 'snapshot' }, { action: 'snapshot', targetId: 'suggested_1', path: '/private' },
    { action: 'evaluate', targetId: 'suggested_1' }, { action: 'upload', paths: ['/private'] },
    { action: 'download', targetId: 'suggested_1' }, { action: 'dialog', accept: true },
  ]) assertBlocked(await call('browser', params));
  url = 'http://localhost/private';
  assertBlocked(await call('browser', { action: 'snapshot', targetId: 'suggested_1' }));
  const { call: offline } = await fixture(t);
  assertBlocked(await offline('browser', { action: 'snapshot', targetId: 'tab' }));
});

test('official portal form actions require approval and freeze normalized target/fields', async (t) => {
  let url = 'https://karararama.yargitay.gov.tr/';
  const { call } = await fixture(t, { getBrowserTab: async () => ({ targetId: 'raw_tab_1', suggestedTargetId: 'short', url }) });
  for (const request of [
    { kind: 'click', ref: 'e12' }, { kind: 'type', ref: 'e12', text: 'kira', submit: false },
    { kind: 'fill', fields: [{ ref: 'e12', type: 'text', value: 'kira' }] },
  ]) {
    const params = { action: 'act', targetId: 'short', request };
    const result = await call('browser', params);
    assertApproval(result);
    assert.equal(result.params.request.targetId, 'raw_tab_1');
    assert.equal(result.params.target, 'host');
    if (request.fields) { request.fields[0].value = 'tampered'; assert.equal(result.params.request.fields[0].value, 'kira'); }
  }
  assertApproval(await call('browser', { action: 'act', targetId: 'short', kind: 'type', ref: 'e12', text: 'kira' }));
  for (const request of [
    { kind: 'type', ref: 'e12', text: 'kira', submit: true },
    { kind: 'type', ref: 'e12', text: 'kira', submit: 'false' },
    { kind: 'click', ref: 'e12', fn: 'send()' }, { kind: 'clickCoords', x: 0, y: 0 },
    { kind: 'evaluate', fn: 'send()' }, { kind: 'batch', actions: [] },
    { kind: 'fill', fields: [{ ref: 'e12', type: 'password', value: 'secret' }] },
    { kind: 'type', ref: 'e12', text: `AIza${'x'.repeat(30)}` },
  ]) assertBlocked(await call('browser', { action: 'act', targetId: 'short', request }));
  assertBlocked(await call('browser', { action: 'act', targetId: 'short', text: 'hidden', request: { kind: 'type', ref: 'e12', text: 'shown' } }));
  url = 'https://yargitay.gov.tr.attacker.example/';
  assertBlocked(await call('browser', { action: 'act', targetId: 'short', request: { kind: 'click', ref: 'e12' } }));
  url = 'http://karararama.yargitay.gov.tr/';
  assertBlocked(await call('browser', { action: 'act', targetId: 'short', request: { kind: 'click', ref: 'e12' } }));
});

test('WhatsApp sends require exact recipient/full-text one-use approval and cannot broaden routes', async (t) => {
  const { call } = await fixture(t);
  const params = { action: 'send', channel: 'whatsapp', accountId: 'gideon', target: '+15551234567', message: 'Bu yalnızca sentetik bir mesaj testidir.' };
  const result = await call('message', params);
  assertApproval(result);
  assert.ok(result.requireApproval.description.includes(params.target));
  assert.ok(result.requireApproval.description.endsWith(params.message));
  assert.equal(result.requireApproval.scope.recipientCount, 1);
  params.target = '+15557654321';
  assert.equal(result.params.target, '+15551234567');
  for (const change of [
    { action: 'broadcast', targets: ['+15551234567'] }, { action: 'react' },
    { channel: 'telegram' }, { accountId: 'personal' }, { target: 'group@g.us' },
    { target: 'newsletter@newsletter' }, { target: '../private' }, { message: 'x'.repeat(1200) },
    { message: `AIza${'x'.repeat(30)}` }, { media: '/private/file' }, { replyTo: 'other' },
    { gatewayUrl: 'https://other.example' }, { presentation: { text: 'hidden' } },
  ]) assertBlocked(await call('message', { ...result.params, ...change }));
  assert.equal(await call('gideon_document', { title: 'İstenen yerel belge', body: 'Sentetik içerik' }), undefined);
});

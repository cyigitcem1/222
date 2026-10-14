import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, symlink, link, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createGuard } from '../extensions/gideon-guard/policy.js';

async function fixture(t, options = {}) {
  const base = await mkdtemp(path.join(os.tmpdir(), 'gideon-guard-'));
  const workspace = path.join(base, 'workspace');
  await mkdir(workspace);
  await writeFile(path.join(workspace, 'SOUL.md'), 'protected policy');
  await writeFile(path.join(base, 'outside.txt'), 'private outside data');
  t.after(() => rm(base, { recursive: true, force: true }));
  const guard = createGuard({ workspace, agentId: 'main' }, options);
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

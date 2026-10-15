import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir, symlink, link, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildConfig, setupProfile, openclawEnv, assertProfileState } from '../lib/profile.mjs';

async function temporary(t) {
  const dir = await mkdtemp(join(tmpdir(), 'gideon-profile-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

test('profili tekrar kurmak kullanıcı hafızasını ve tokenı değiştirmez', async t => {
  const dir = await temporary(t);
  const first = await setupProfile(dir);
  const before = await readFile(join(dir, 'openclaw.json'), 'utf8');
  await writeFile(join(dir, 'workspace', 'MEMORY.md'), 'Kullanıcının onaylı notu');
  const second = await setupProfile(dir, { port: 19500 });
  assert.equal(first.created, true); assert.equal(second.created, false);
  assert.equal(await readFile(join(dir, 'openclaw.json'), 'utf8'), before);
  assert.equal(await readFile(join(dir, 'workspace', 'MEMORY.md'), 'utf8'), 'Kullanıcının onaylı notu');
  assert.equal(second.port, 18799);
});

test('başka OpenClaw kurulumunun dosyalarına dokunmaz', async t => {
  const dir = await temporary(t);
  await writeFile(join(dir, 'openclaw.json'), '{"original":true}');
  await assert.rejects(setupProfile(dir), /Mevcut OpenClaw/);
  assert.equal(await readFile(join(dir, 'openclaw.json'), 'utf8'), '{"original":true}');
});

test('sembolik bağlantılı veri ve persona yollarını reddeder', async t => {
  const dir = await temporary(t);
  const other = join(dir, 'other'); await mkdir(other);
  const linked = join(dir, 'linked'); await symlink(other, linked, 'dir');
  await assert.rejects(setupProfile(linked), /sembolik/);
  const profile = join(dir, 'state'); await setupProfile(profile);
  await rm(join(profile, 'workspace', 'SOUL.md'));
  const outside = join(other, 'SOUL.md'); await writeFile(outside, 'Korunmuş içerik');
  await symlink(outside, join(profile, 'workspace', 'SOUL.md'));
  await assert.rejects(setupProfile(profile), /sembolik/);
  assert.equal(await readFile(outside, 'utf8'), 'Korunmuş içerik');
});

test('yeni token, yerel ağ sınırı ve kaynaklar doğrulanır', () => {
  const a = buildConfig('/tmp/gideon'); const b = buildConfig('/tmp/gideon');
  assert.notEqual(a.gateway.auth.token, b.gateway.auth.token);
  assert.equal(a.gateway.bind, 'loopback'); assert.equal(a.gateway.auth.mode, 'token');
  assert.equal(a.tools.fs.workspaceOnly, true);
  assert.equal(a.tools.sessions.visibility, 'agent');
  assert.ok(a.tools.deny.includes('exec')); assert.ok(a.tools.allow.includes('message'));
  assert.ok(a.tools.allow.includes('gideon_document')); assert.ok(a.tools.allow.includes('web_search'));
  assert.equal(a.browser.evaluateEnabled, false);
  assert.equal(a.browser.ssrfPolicy.dangerouslyAllowPrivateNetwork, false);
  assert.equal(a.agents.defaults.heartbeat.every, '0m');
  assert.equal(a.plugins.entries['memory-core'].config.dreaming.enabled, false);
  assert.equal(a.skills.workshop.autonomous.mode, 'off');
  assert.equal(a.memory.search.provider, 'none');
  assert.deepEqual(a.memory.search.sources, ['memory', 'sessions']);
  assert.equal(a.session.maintenance.resetArchiveRetention, false);
  assert.throws(() => buildConfig('/tmp/gideon', { port: 0 }), /port/);
  assert.throws(() => buildConfig('/tmp/gideon', { model: 'invented/model' }), /GIDEON_MODEL/);
});

test('yapılandırması olmayan yabancı kurulum ve dolu klasörleri korur', async t => {
  const dir = await temporary(t);
  const foreign = join(dir, 'foreign'); await mkdir(foreign);
  await writeFile(join(foreign, 'gideon-install.json'), '{"product":"OTHER"}');
  await assert.rejects(setupProfile(foreign), /başka bir/);
  await assert.rejects(readFile(join(foreign, 'openclaw.json')), { code: 'ENOENT' });
  const notes = join(dir, 'notes'); await mkdir(notes); await writeFile(join(notes, 'not.txt'), 'Kişisel dosya');
  await assert.rejects(setupProfile(notes), /Boş bir/);
  assert.equal(await readFile(join(notes, 'not.txt'), 'utf8'), 'Kişisel dosya');
});

test('başlatıcı ambient Gateway yetkilerini farklı profile taşımaz', () => {
  const env = openclawEnv('/tmp/gideon', { OPENCLAW_STATE_DIR: '/other', OPENCLAW_PROFILE: 'other', OPENCLAW_GATEWAY_PORT: '18789', OPENCLAW_GATEWAY_URL: 'wss://other.invalid', OPENCLAW_AGENT_DIR: '/other/agent', PI_CODING_AGENT_DIR: '/other/pi', OPENCLAW_GATEWAY_TOKEN: 'synthetic', GEMINI_API_KEY: 'synthetic' });
  assert.equal(env.OPENCLAW_STATE_DIR, '/tmp/gideon');
  assert.equal(env.OPENCLAW_PROFILE, ''); assert.equal(env.OPENCLAW_GATEWAY_TOKEN, '');
  assert.equal(env.GEMINI_API_KEY, 'synthetic');
  assert.equal(openclawEnv('/tmp/gideon', { GOOGLE_API_KEY: 'synthetic-google' }).GEMINI_API_KEY, 'synthetic-google');
  assert.equal(env.OPENCLAW_GATEWAY_URL, '');
  assert.equal(env.OPENCLAW_AGENT_DIR, '/tmp/gideon/agents/main/agent');
  assert.equal(env.PI_CODING_AGENT_DIR, env.OPENCLAW_AGENT_DIR);
});

test('cache, log, yapılandırma ve kurulum işareti bağlantılarına dokunmaz', async t => {
  const dir = await temporary(t); const outside = join(dir, 'outside'); await mkdir(outside);
  for (const name of ['cache', 'logs']) {
    const profile = join(dir, `profile-${name}`); await setupProfile(profile);
    await rm(join(profile, name), { recursive: true }); await symlink(outside, join(profile, name), 'dir');
    await assert.rejects(setupProfile(profile), /sembolik/);
    await assert.rejects(assertProfileState(profile), /sembolik/);
  }
  const profile = join(dir, 'profile-config'); await setupProfile(profile);
  const original = join(outside, 'original.json'); await writeFile(original, '{"original":true}');
  await rm(join(profile, 'openclaw.json')); await symlink(original, join(profile, 'openclaw.json'));
  await assert.rejects(assertProfileState(profile), /sembolik/);
  assert.equal(await readFile(original, 'utf8'), '{"original":true}');
  await rm(join(profile, 'openclaw.json')); await link(original, join(profile, 'openclaw.json'));
  await assert.rejects(assertProfileState(profile), /bağımsız/);
});

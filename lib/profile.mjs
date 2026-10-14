import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile, lstat, realpath, readdir } from 'node:fs/promises';
import { rename, copyFile, unlink } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const VERSION = '2026.10.3';
export const statePath = (env = process.env) => resolve(env.GIDEON_STATE_DIR || join(ROOT, '.gideon'));
export const openclawEnv = (stateDir, env = process.env) => ({
  ...env, OPENCLAW_STATE_DIR: stateDir,
  OPENCLAW_CONFIG_PATH: join(stateDir, 'openclaw.json'),
  XDG_CACHE_HOME: join(stateDir, 'cache'),
  OPENCLAW_AGENT_DIR: join(stateDir, 'agents', 'main', 'agent'),
  PI_CODING_AGENT_DIR: join(stateDir, 'agents', 'main', 'agent'),
  OPENCLAW_GATEWAY_URL: '', OPENCLAW_REMOTE_URL: '', OPENCLAW_CONTAINER: '',
  OPENCLAW_GATEWAY_PORT: '', OPENCLAW_GATEWAY_TOKEN: '',
  OPENCLAW_GATEWAY_PASSWORD: '', OPENCLAW_PROFILE: '',
});

export function buildConfig(stateDir, { port = 18799, model = 'google/gemini-3.1-pro-preview', token = randomBytes(32).toString('hex') } = {}) {
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Geçerli bir port seçin (1024–65535).');
  if (!/^google\/[a-zA-Z0-9._-]+$/.test(model)) throw new Error('GIDEON_MODEL google/model biçiminde olmalı.');
  return {
    agents: {
      defaults: {
        workspace: join(stateDir, 'workspace'), userTimezone: 'Europe/Istanbul',
        model: { primary: model }, heartbeat: { every: '0m' },
      },
      entries: { main: { name: 'GIDEON', identity: { name: 'GIDEON', emoji: '✦' } } },
    },
    gateway: {
      mode: 'local', port, bind: 'loopback', auth: { mode: 'token', token },
      controlUi: { enabled: true, environment: { label: 'GIDEON', color: 'teal' } },
      terminal: { enabled: false }, tailscale: { mode: 'off' },
      cliAgents: { enabled: false },
    },
    ui: { prefs: { theme: 'phosphor', themeMode: 'dark', locale: 'tr', chatShowToolCalls: true } },
    memory: {
      citations: 'on', search: {
        enabled: true, provider: 'none', fallback: 'none', sources: ['memory', 'sessions'],
        rememberAcrossConversations: true, experimental: { sessionMemory: true },
      },
    },
    session: {
      dmScope: 'main', reset: { mode: 'none' },
      maintenance: { mode: 'warn', resetArchiveRetention: false, maxDiskBytes: false, archiveDashboardAfter: false },
    },
    talk: {
      agentId: 'main', speechLocale: 'tr-TR',
      realtime: {
        provider: 'google', mode: 'realtime', transport: 'provider-websocket', brain: 'agent-consult',
        model: 'gemini-3.1-flash-live-preview', speakerVoice: 'Kore',
        instructions: 'Adın GIDEON. Doğal Türkçe konuş. Kişisel geçmiş ve görevler için openclaw_agent_consult kullan; anı, tarih veya sonuç uydurma. Önemli işlemler için açık kullanıcı onayı gerekir. Kamera veya ekran paylaşımı isteme.',
      },
    },
    tools: {
      allow: ['read', 'write', 'edit', 'memory_search', 'memory_get', 'sessions_list', 'sessions_history', 'sessions_search', 'session_status', 'cron', 'automations', 'talk_voice'],
      deny: ['exec', 'process', 'browser', 'message', 'sessions_send', 'sessions_spawn', 'subagents', 'gateway', 'nodes', 'apply_patch'],
      fs: { workspaceOnly: true }, sessions: { visibility: 'agent' },
      agentToAgent: { enabled: false }, elevated: { enabled: false },
      exec: { mode: 'deny' },
    },
    plugins: {
      allow: ['google', 'memory-core', 'gideon-guard'],
      load: { paths: [join(ROOT, 'extensions', 'gideon-guard')] },
      entries: { google: { enabled: true }, 'memory-core': { enabled: true, config: { dreaming: { enabled: false } } }, 'gideon-guard': { enabled: true, config: { workspace: join(stateDir, 'workspace'), stateDir, agentId: 'main' } } },
    },
    logging: { level: 'info', file: join(stateDir, 'logs', 'openclaw.log'), maxFileBytes: 5000000, audit: { enabled: true, messages: 'off' } },
    update: { checkOnStart: false, auto: { enabled: false } },
    skills: { allowBundled: [], workshop: { autonomous: { mode: 'off' }, approvalPolicy: 'pending' } },
  };
}

async function rejectSymlinkParents(target) {
  for (let p = target; ; p = dirname(p)) {
    try { if ((await lstat(p)).isSymbolicLink()) throw new Error('Veri klasörü yolu sembolik bağlantı içeremez.'); }
    catch (e) { if (e.code !== 'ENOENT') throw e; }
    if (dirname(p) === p) break;
  }
}

export async function assertProfileState(stateDir, { requireOwned = true } = {}) {
  const directories = ['', 'workspace', 'workspace/memory', 'logs', 'cache', 'state', 'agents', 'agents/main', 'agents/main/agent'];
  const files = ['openclaw.json', 'gideon-install.json', 'launcher-runtime.json', ...['AGENTS.md', 'SOUL.md', 'IDENTITY.md', 'USER.md', 'MEMORY.md', 'HEARTBEAT.md'].map(n => `workspace/${n}`)];
  for (const [names, directory] of [[directories, true], [files, false]]) {
    for (const name of names) {
      const target = join(stateDir, name);
      await rejectSymlinkParents(target);
      try {
        const stat = await lstat(target);
        if (directory ? !stat.isDirectory() : !stat.isFile() || stat.nlink !== 1) throw new Error('GIDEON veri yolları normal, bağımsız dosya ve klasörler olmalıdır.');
      } catch (e) { if (e.code !== 'ENOENT') throw e; }
    }
  }
  if (requireOwned) {
    try {
      const marker = JSON.parse(await readFile(join(stateDir, 'gideon-install.json'), 'utf8'));
      if (marker.product !== 'GIDEON') throw new Error('Bu veri klasörü GIDEON kurulumuna ait değil.');
    } catch (e) { if (e.code === 'ENOENT') throw new Error('Önce npm run setup çalıştırın.'); throw e; }
  }
}

async function createOnly(path, body) {
  try { await writeFile(path, body, { flag: 'wx', mode: 0o600 }); return true; }
  catch (e) { if (e.code === 'EEXIST') return false; throw e; }
}

export async function setupProfile(stateDir = statePath(), options = {}) {
  await assertProfileState(stateDir, { requireOwned: false });
  const marker = join(stateDir, 'gideon-install.json');
  const configPath = join(stateDir, 'openclaw.json');
  let owned = false;
  try {
    const m = JSON.parse(await readFile(marker, 'utf8'));
    if (m.product !== 'GIDEON') throw new Error('Bu klasör başka bir kuruluma ait; değiştirilmedi.');
    owned = true;
  } catch (e) { if (e.code !== 'ENOENT') throw e; }
  if (!owned) {
    let contents = [];
    try { contents = await readdir(stateDir); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    if (contents.length) throw new Error('Mevcut OpenClaw veya kullanıcı dosyalarına dokunulmadı. Boş bir GIDEON_STATE_DIR seçin.');
  }
  await mkdir(stateDir, { recursive: true, mode: 0o700 });
  const workspace = join(stateDir, 'workspace');
  for (const d of ['workspace', 'workspace/memory', 'logs', 'cache']) await mkdir(join(stateDir, d), { recursive: true, mode: 0o700 });
  await createOnly(marker, JSON.stringify({ product: 'GIDEON', openclawVersion: VERSION }, null, 2) + '\n');
  const config = buildConfig(stateDir, options);
  const created = await createOnly(configPath, JSON.stringify(config, null, 2) + '\n');
  for (const name of ['AGENTS.md', 'SOUL.md', 'IDENTITY.md', 'USER.md', 'MEMORY.md', 'HEARTBEAT.md']) {
    const path = join(workspace, name);
    await rejectSymlinkParents(path);
    await createOnly(path, await readFile(join(ROOT, 'templates', 'workspace', name), 'utf8'));
  }
  const actual = JSON.parse(await readFile(configPath, 'utf8'));
  return { created, stateDir: await realpath(stateDir), workspace, port: actual.gateway.port };
}

export async function bindDesktopRuntime(stateDir) {
  await assertProfileState(stateDir);
  const configPath = join(stateDir, 'openclaw.json');
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  const guard = config.plugins?.entries?.['gideon-guard'];
  if (!guard || resolve(guard.config?.workspace || '') !== join(stateDir, 'workspace')) {
    throw new Error('GIDEON çalışma alanı doğrulanamadı; mevcut yapılandırma değiştirilmedi.');
  }
  const target = join(ROOT, 'extensions', 'gideon-guard');
  const oldPaths = config.plugins.load?.paths || [];
  const owned = p => typeof p === 'string' && p.replaceAll('\\', '/').endsWith('/extensions/gideon-guard');
  const paths = [...oldPaths.filter(p => !owned(p)), target];
  if (JSON.stringify(paths) === JSON.stringify(oldPaths)) return;
  const suffix = randomBytes(8).toString('hex');
  const backup = join(stateDir, `openclaw.before-desktop-${suffix}.json`);
  await copyFile(configPath, backup, 1);
  config.plugins.load = { ...config.plugins.load, paths };
  const temporary = join(stateDir, `openclaw.desktop-${suffix}.tmp`);
  try {
    await writeFile(temporary, JSON.stringify(config, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    await rename(temporary, configPath);
  } finally { try { await unlink(temporary); } catch (e) { if (e.code !== 'ENOENT') throw e; } }
}

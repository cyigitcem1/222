import { randomBytes, createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, lstat, realpath, readdir } from 'node:fs/promises';
import { rename, copyFile, unlink } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const VERSION = '2026.10.3';
export const CAPABILITIES_REVISION = 2;
const WORKSPACE_FILES = ['AGENTS.md', 'SOUL.md', 'IDENTITY.md', 'USER.md', 'MEMORY.md', 'HEARTBEAT.md', 'TOOLS.md'];
const pluginPaths = () => [join(ROOT, 'extensions', 'gideon-guard'), join(ROOT, 'node_modules', 'openclaw', 'dist', 'extensions', 'gideon-documents'), join(ROOT, 'node_modules', '@openclaw', 'whatsapp')];
const rebasedPluginPaths = (paths = []) => [
  ...paths.filter(p => !(typeof p === 'string' && ['/extensions/gideon-guard', '/extensions/gideon-documents', '/node_modules/@openclaw/whatsapp'].some(suffix => p.replaceAll('\\', '/').endsWith(suffix)))),
  ...pluginPaths(),
];
export const statePath = (env = process.env) => resolve(env.GIDEON_STATE_DIR || join(ROOT, '.gideon'));
export const openclawEnv = (stateDir, env = process.env) => ({
  ...env, OPENCLAW_STATE_DIR: stateDir,
  GEMINI_API_KEY: env.GEMINI_API_KEY || env.GOOGLE_API_KEY || '',
  OPENCLAW_CONFIG_PATH: join(stateDir, 'openclaw.json'),
  XDG_CACHE_HOME: join(stateDir, 'cache'),
  OPENCLAW_AGENT_DIR: join(stateDir, 'agents', 'main', 'agent'),
  PI_CODING_AGENT_DIR: join(stateDir, 'agents', 'main', 'agent'),
  OPENCLAW_GATEWAY_URL: '', OPENCLAW_REMOTE_URL: '', OPENCLAW_CONTAINER: '',
  OPENCLAW_GATEWAY_PORT: '', OPENCLAW_GATEWAY_TOKEN: '',
  OPENCLAW_GATEWAY_PASSWORD: '', OPENCLAW_PROFILE: '',
});

export function buildConfig(stateDir, { port = 18799, model = 'google/gemini-3.5-flash', token = randomBytes(32).toString('hex') } = {}) {
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Geçerli bir port seçin (1024–65535).');
  if (!/^google\/[a-zA-Z0-9._-]+$/.test(model)) throw new Error('GIDEON_MODEL google/model biçiminde olmalı.');
  return {
    agents: {
      defaults: {
        workspace: join(stateDir, 'workspace'), userTimezone: 'Europe/Istanbul',
        model: { primary: model }, pdfModel: { primary: 'google/gemini-3.5-flash' }, heartbeat: { every: '0m' },
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
      allow: ['read', 'write', 'edit', 'memory_search', 'memory_get', 'sessions_list', 'sessions_history', 'sessions_search', 'session_status', 'cron', 'automations', 'talk_voice', 'web_search', 'web_fetch', 'pdf', 'browser', 'gideon_document', 'message'],
      deny: ['exec', 'process', 'sessions_send', 'sessions_spawn', 'subagents', 'gateway', 'nodes', 'apply_patch'],
      fs: { workspaceOnly: true }, sessions: { visibility: 'agent' },
      agentToAgent: { enabled: false }, elevated: { enabled: false },
      exec: { mode: 'deny' },
      web: {
        search: { enabled: true, provider: 'gemini' },
        fetch: { enabled: true, maxChars: 20000, maxCharsCap: 50000, maxResponseBytes: 10000000, timeoutSeconds: 30, ssrfPolicy: { dangerouslyAllowPrivateNetwork: false } },
      },
    },
    browser: { enabled: true, defaultProfile: 'openclaw', evaluateEnabled: false, noSandbox: false, ssrfPolicy: { dangerouslyAllowPrivateNetwork: false } },
    channels: {
      whatsapp: {
        enabled: true, dmPolicy: 'disabled', groupPolicy: 'disabled', mediaMaxMb: 16,
        configWrites: false, sendReadReceipts: false, selfChatMode: false, reactionLevel: 'off',
        actions: { reactions: false, polls: false, calls: false, sendMessage: true }, defaultAccount: 'gideon',
        accounts: { gideon: {
          enabled: true, name: 'GIDEON', authDir: join(stateDir, 'credentials', 'whatsapp', 'gideon'),
          dmPolicy: 'disabled', groupPolicy: 'disabled', configWrites: false,
          sendReadReceipts: false, selfChatMode: false, reactionLevel: 'off',
        } },
      },
    },
    plugins: {
      allow: ['google', 'memory-core', 'gideon-guard', 'gideon-documents', 'browser', 'whatsapp'],
      load: { paths: pluginPaths() },
      entries: {
        google: { enabled: true, config: { webSearch: { model: 'gemini-3.5-flash' } } },
        browser: { enabled: true }, whatsapp: { enabled: true },
        'memory-core': { enabled: true, config: { dreaming: { enabled: false } } },
        'gideon-guard': { enabled: true, config: { workspace: join(stateDir, 'workspace'), stateDir, agentId: 'main' } },
        'gideon-documents': { enabled: true, config: { workspace: join(stateDir, 'workspace') } },
      },
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
  const files = ['openclaw.json', 'gideon-install.json', 'launcher-runtime.json', ...WORKSPACE_FILES.map(n => `workspace/${n}`)];
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

async function replaceOwnedFile(stateDir, path, body) {
  await rejectSymlinkParents(path);
  const stat = await lstat(path);
  if (!stat.isFile() || stat.nlink !== 1) throw new Error('Güncellenecek dosya bağımsız olmalıdır.');
  const original = await readFile(path);
  if (original.equals(Buffer.from(body))) return;
  const id = randomBytes(12).toString('hex');
  // Backups stay with the private profile, never in the application directory.
  await writeFile(join(stateDir, `before-capabilities-${id}.bak`), original, { flag: 'wx', mode: 0o600 });
  const temporary = join(stateDir, `capabilities-${id}.tmp`);
  try {
    await writeFile(temporary, body, { flag: 'wx', mode: 0o600 });
    await rename(temporary, path);
  } finally { await unlink(temporary).catch(e => { if (e.code !== 'ENOENT') throw e; }); }
}

function addCapabilities(config, stateDir) {
  const defaults = buildConfig(stateDir);
  config.agents ??= {}; config.agents.defaults ??= {};
  config.agents.defaults.pdfModel ??= defaults.agents.defaults.pdfModel;
  config.tools ??= {};
  config.tools.allow = [...new Set([...(config.tools.allow || []), ...defaults.tools.allow])];
  config.tools.deny = (config.tools.deny || []).filter(name => !['browser', 'message'].includes(name));
  config.tools.web ??= {};
  config.tools.web.search ??= defaults.tools.web.search;
  config.tools.web.fetch ??= defaults.tools.web.fetch;
  config.browser ??= defaults.browser;
  config.channels ??= {};
  const oldWhatsApp = config.channels.whatsapp || {};
  const accountDefaults = defaults.channels.whatsapp.accounts.gideon;
  const accounts = Object.fromEntries(Object.entries(oldWhatsApp.accounts || {}).map(([id, account]) => [id, { ...account, enabled: false }]));
  accounts.gideon = { ...(oldWhatsApp.accounts?.gideon || {}), ...accountDefaults };
  config.channels.whatsapp = { ...oldWhatsApp, ...defaults.channels.whatsapp, accounts };
  config.plugins ??= {}; config.plugins.entries ??= {};
  config.plugins.allow = [...new Set([...(config.plugins.allow || []), ...defaults.plugins.allow])];
  for (const id of ['browser', 'whatsapp', 'gideon-documents']) config.plugins.entries[id] ??= defaults.plugins.entries[id];
  config.plugins.entries.google ??= defaults.plugins.entries.google;
  config.plugins.entries.google.config ??= {};
  config.plugins.entries.google.config.webSearch ??= defaults.plugins.entries.google.config.webSearch;
  config.plugins.load ??= {};
  config.plugins.load.paths = rebasedPluginPaths(config.plugins.load.paths);
  return config;
}

const LEGACY_FACTORY_HASHES = {
  // Immutable v0.2.3 source (LF) and published Windows template (CRLF).
  'AGENTS.md': ['caf3bb72f69a85db52ea2f8abce38968a2a3cbd17137c240235c76f033630e19', '53676c1e62bf3ff2c57d21bc6d392f7057997316894ce842691c15d478c2b5ea'],
  'SOUL.md': ['0114d074847f4f5c0bebd9f8c2f87608d6d081e1e35aceb9a728b70105876af3', 'cd9539f427d6c5b30f22a983e341b8102b5ebdc745abb10facbbb4d097736318'],
};

export async function setupProfile(stateDir = statePath(), options = {}) {
  await assertProfileState(stateDir, { requireOwned: false });
  let release;
  try {
    let marker;
    try { marker = JSON.parse(await readFile(join(stateDir, 'gideon-install.json'), 'utf8')); }
    catch (e) { if (e.code !== 'ENOENT') throw e; }
    if (marker?.product === 'GIDEON' && (marker.capabilitiesRevision || 0) < CAPABILITIES_REVISION) {
      let existing;
      try { existing = JSON.parse(await readFile(join(stateDir, 'openclaw.json'), 'utf8')); }
      catch (e) { if (e.code !== 'ENOENT') throw e; }
      if (existing) {
        if (resolve(existing.agents?.defaults?.workspace || '') !== join(stateDir, 'workspace')
          || resolve(existing.plugins?.entries?.['gideon-guard']?.config?.workspace || '') !== join(stateDir, 'workspace')) {
          throw new Error('Özel çalışma alanı doğrulanamadı; güncelleme kişisel dosyaları değiştirmedi.');
        }
        const { assertStopped, acquireRuntime } = await import('./runtime.mjs');
        await assertStopped(stateDir, existing.gateway?.port);
        release = await acquireRuntime(stateDir);
      }
    }
    return await setupProfileUnlocked(stateDir, options);
  } finally { if (release) await release(); }
}

async function setupProfileUnlocked(stateDir, options) {
  await assertProfileState(stateDir, { requireOwned: false });
  const marker = join(stateDir, 'gideon-install.json');
  const configPath = join(stateDir, 'openclaw.json');
  let owned = false;
  let previousMarker;
  try {
    const m = JSON.parse(await readFile(marker, 'utf8'));
    if (m.product !== 'GIDEON') throw new Error('Bu klasör başka bir kuruluma ait; değiştirilmedi.');
    previousMarker = m;
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
  for (const name of WORKSPACE_FILES) {
    const path = join(workspace, name);
    await rejectSymlinkParents(path);
    await createOnly(path, await readFile(join(ROOT, 'templates', 'workspace', name), 'utf8'));
  }
  if ((previousMarker?.capabilitiesRevision || 0) < CAPABILITIES_REVISION) {
    if (owned && !created) {
      const existing = JSON.parse(await readFile(configPath, 'utf8'));
      await replaceOwnedFile(stateDir, configPath, JSON.stringify(addCapabilities(existing, stateDir), null, 2) + '\n');
      for (const [name, digests] of Object.entries(LEGACY_FACTORY_HASHES)) {
        const path = join(workspace, name);
        if (digests.includes(createHash('sha256').update(await readFile(path)).digest('hex'))) {
          await replaceOwnedFile(stateDir, path, await readFile(join(ROOT, 'templates', 'workspace', name)));
        }
      }
    }
    const actualMarker = JSON.parse(await readFile(marker, 'utf8'));
    await replaceOwnedFile(stateDir, marker, JSON.stringify({ ...actualMarker, capabilitiesRevision: CAPABILITIES_REVISION }, null, 2) + '\n');
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
  const oldPaths = config.plugins.load?.paths || [];
  const paths = rebasedPluginPaths(oldPaths);
  if (JSON.stringify(paths) === JSON.stringify(oldPaths)) return;
  const { assertStopped } = await import('./runtime.mjs');
  await assertStopped(stateDir, config.gateway?.port);
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

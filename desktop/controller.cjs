'use strict';

const fs = require('node:fs/promises');
const { constants } = require('node:fs');
const { dirname, join, resolve, isAbsolute } = require('node:path');
const { randomUUID } = require('node:crypto');
const { spawn } = require('node:child_process');

const MAX_CAPTURE = 64 * 1024;
const MESSAGES = Object.freeze({
  welcome: 'Başlamak için Gemini API anahtarınızı bir kez ekleyin.',
  saved: 'Anahtar güvenli olarak kaydedildi. GIDEON açılabilir.',
  available: 'GIDEON açılabilir.',
  unavailable: 'Bu bilgisayarda güvenli anahtar saklama kullanılamıyor. GIDEON’u yeniden açın.',
  invalid: 'Anahtarı kontrol edin. Boşluk içermeyen, 10–512 karakterlik bir anahtar gerekli.',
  credentials: 'Kaydedilen anahtar güvenli olarak okunamadı. Anahtarı kaldırıp yeniden ekleyin.',
  save: 'Anahtar güvenli olarak kaydedilemedi. Anahtarınız değiştirilmedi.',
  forget: 'Anahtar güvenli olarak kaldırılamadı. Dosyalarınız değiştirilmedi.',
  files: 'GIDEON’un veri klasörü güvenli değil. Uygulamayı yeniden kurun.',
  setup: 'GIDEON hazırlanamadı. Uygulamayı yeniden açıp tekrar deneyin.',
  missingRuntime: 'GIDEON’un çalışma motoru bulunamadı. Uygulamayı yeniden kurun.',
  permissions: 'GIDEON’un çalışma motoruna erişilemiyor. Uygulamayı yeniden kurun.',
  engine: 'GIDEON hizmeti durdu. Tekrar başlatabilirsiniz.',
  timeout: 'GIDEON zamanında açılamadı. Uygulamayı yeniden açıp tekrar deneyin.',
  stop: 'GIDEON hizmeti kapatılamadı. Uygulamayı kapatıp yeniden açın.',
});

function problem(kind) {
  const error = new Error('GIDEON operation failed');
  error.kind = kind;
  return error;
}

function normalizeKey(value) {
  if (typeof value !== 'string') throw problem('invalid');
  const key = value.trim();
  if (key.length < 10 || key.length > 512 || /[\s\x00-\x1f\x7f-\x9f]/u.test(key)) throw problem('invalid');
  return key;
}

async function safeParents(target, create = false) {
  const directories = [];
  for (let current = resolve(target); ; current = dirname(current)) {
    directories.push(current);
    if (dirname(current) === current) break;
  }
  for (const directory of directories.reverse()) {
    let stat;
    try { stat = await fs.lstat(directory); }
    catch (error) {
      if (error.code !== 'ENOENT' || !create) throw error;
      try { await fs.mkdir(directory, { mode: 0o700 }); }
      catch (mkdirError) { if (mkdirError.code !== 'EEXIST') throw mkdirError; }
      stat = await fs.lstat(directory);
    }
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw problem('files');
  }
}

async function normalFile(target, missingOkay = false, privateFile = false) {
  try {
    const stat = await fs.lstat(target);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw problem('files');
    if (typeof process.getuid === 'function' && stat.uid !== process.getuid()) throw problem('files');
    if (privateFile && process.platform !== 'win32' && (stat.mode & 0o077)) throw problem('files');
    return stat;
  } catch (error) {
    if (missingOkay && error.code === 'ENOENT') return null;
    throw error;
  }
}

function sameFile(a, b) { return Boolean(a && b && a.dev === b.dev && a.ino === b.ino); }

async function safeRead(target, { missingOkay = false, privateFile = false, maximum = MAX_CAPTURE } = {}) {
  await safeParents(dirname(target));
  const before = await normalFile(target, missingOkay, privateFile);
  if (!before) return null;
  if (before.size > maximum) throw problem('files');
  const handle = await fs.open(target, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  try {
    const opened = await handle.stat();
    if (!sameFile(before, opened) || !opened.isFile() || opened.nlink !== 1 || opened.size > maximum) throw problem('files');
    const body = await handle.readFile();
    const after = await normalFile(target, false, privateFile);
    if (!sameFile(opened, after) || body.length > maximum) throw problem('files');
    return body;
  } finally { await handle.close(); }
}

/**
 * Owns only the engine launched by this application. The optional timing/fetch
 * adapters make tests independent of a real gateway or a paid Gemini request.
 * Credentials never cross this controller's status boundary.
 */
function createController({
  stateDir, nodePath, runtimeRoot, secureStore, onStatus = () => {}, spawnProcess = spawn,
  fetchImpl = globalThis.fetch, delay = ms => new Promise(accept => setTimeout(accept, ms)),
  // OpenClaw foreground/Windows stop policy reserves 330 seconds for draining.
  now = Date.now, startupTimeoutMs = 90_000, stopTimeoutMs = 330_000,
} = {}) {
  if (![stateDir, nodePath, runtimeRoot].every(value => typeof value === 'string' && isAbsolute(value))) {
    throw new Error('GIDEON requires absolute application paths');
  }
  stateDir = resolve(stateDir);
  runtimeRoot = resolve(runtimeRoot);
  const credentialsPath = join(dirname(stateDir), 'credentials.bin');
  const cliPath = join(runtimeRoot, 'scripts', 'gideon.mjs');
  const enginePath = join(runtimeRoot, 'scripts', 'desktop-engine.mjs');
  let selectedKey = '';
  let gatewayToken = '';
  let initialized = false;
  let initializing = null;
  let starting = null;
  let session = null;
  let engine = null;
  let operationEpoch = 0;
  let queue = Promise.resolve();

  function storageAvailable() {
    try { return Boolean(secureStore && secureStore.available()); }
    catch { return false; }
  }

  let status = {
    phase: 'welcome', message: MESSAGES.welcome, hasKey: false,
    keyStorageAvailable: storageAvailable(), gatewayReady: false, liveVerified: false,
  };

  function getStatus() { return { ...status }; }
  function publish(phase, message, gatewayReady = status.gatewayReady) {
    status = {
      phase, message, hasKey: Boolean(selectedKey), keyStorageAvailable: storageAvailable(),
      gatewayReady: Boolean(gatewayReady), liveVerified: false,
    };
    try { onStatus(getStatus()); } catch { /* UI callbacks must not break cleanup. */ }
    return getStatus();
  }

  function enqueue(work) {
    const pending = queue.then(work, work);
    queue = pending.catch(() => {});
    return pending;
  }

  function environmentKey() {
    try { return normalizeKey(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || ''); }
    catch { return ''; }
  }

  function redact(text) {
    let safe = text;
    for (const secret of [selectedKey, gatewayToken, process.env.GEMINI_API_KEY, process.env.GOOGLE_API_KEY]) {
      if (secret) safe = safe.split(secret).join('[REDACTED]');
    }
    return safe.replace(/((?:api[_ -]?key|token|authorization)\s*[=:]\s*)[^\s,;]+/gi, '$1[REDACTED]');
  }

  function spawnOwned(args) {
    const child = spawnProcess(nodePath, args, {
      cwd: runtimeRoot, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env, GIDEON_STATE_DIR: stateDir, GIDEON_NO_OPEN: '1',
        GEMINI_API_KEY: selectedKey, GOOGLE_API_KEY: '',
      },
    });
    let resolveDone;
    const record = { child, closed: false, stdout: '', stderr: '', overflow: false, result: null,
      done: new Promise(accept => { resolveDone = accept; }), intentionallyStopping: false };
    function settle(result) {
      if (record.closed) return;
      record.closed = true;
      record.result = result;
      resolveDone(result);
    }
    for (const [streamName, output] of [['stdout', child.stdout], ['stderr', child.stderr]]) {
      output?.on('data', data => {
        const combined = record[streamName] + String(data);
        if (combined.length > MAX_CAPTURE) record.overflow = true;
        record[streamName] = redact(combined.slice(-MAX_CAPTURE));
      });
    }
    child.stdin?.on('error', () => {});
    child.once('error', error => settle({ code: null, errorCode: error.code || 'UNKNOWN' }));
    child.once('close', (code, signal) => settle({ code, signal }));
    return record;
  }

  function spawnProblem(error) {
    if (error?.code === 'ENOENT' || error?.errorCode === 'ENOENT') return problem('missingRuntime');
    if (error?.code === 'EACCES' || error?.code === 'EPERM' || error?.errorCode === 'EACCES' || error?.errorCode === 'EPERM') return problem('permissions');
    return problem('engine');
  }

  async function waitClosed(record, timeout) {
    if (record.closed) return true;
    let timer;
    try {
      return await Promise.race([
        record.done.then(() => true),
        new Promise(accept => { timer = setTimeout(() => accept(false), Math.max(1, timeout)); }),
      ]);
    } finally { clearTimeout(timer); }
  }

  async function stopEngine() {
    const owned = engine;
    if (!owned) return true;
    owned.intentionallyStopping = true;
    if (!owned.closed) {
      try { owned.child.stdin?.write('GIDEON_STOP\n'); } catch {}
      if (!await waitClosed(owned, stopTimeoutMs)) {
        try { owned.child.kill(); } catch {}
        if (!await waitClosed(owned, 2_000)) return false;
      }
    }
    if (engine === owned) engine = null;
    return true;
  }

  function cancelStartup() {
    operationEpoch += 1;
    session?.controller.abort();
  }

  async function runCommand(args, current, timeout) {
    let record;
    try { record = spawnOwned([cliPath, ...args]); }
    catch (error) { throw spawnProblem(error); }
    let timer;
    let abort;
    const interrupted = new Promise(accept => {
      abort = () => accept({ aborted: true });
      current.controller.signal.addEventListener('abort', abort, { once: true });
      if (current.controller.signal.aborted) abort();
    });
    try {
      const result = await Promise.race([
        record.done, interrupted,
        new Promise(accept => { timer = setTimeout(() => accept({ timedOut: true }), Math.max(1, timeout)); }),
      ]);
      if (result.aborted || result.timedOut) {
        try { record.child.kill(); } catch {}
        await waitClosed(record, 2_000);
        throw problem(result.timedOut || current.controller.signal.reason?.kind === 'timeout' ? 'timeout' : 'cancelled');
      }
      if (result.errorCode) throw spawnProblem(result);
      return { code: result.code, stdout: record.stdout, overflow: record.overflow };
    } finally {
      clearTimeout(timer);
      current.controller.signal.removeEventListener('abort', abort);
    }
  }

  async function initializeInternal() {
    if (initialized) return getStatus();
    selectedKey = '';
    try {
      await safeParents(dirname(stateDir), true);
      await fs.chmod(dirname(stateDir), 0o700);
      const encrypted = await safeRead(credentialsPath, { missingOkay: true, privateFile: true });
      if (encrypted) {
        if (!storageAvailable()) throw problem('unavailable');
        try { selectedKey = normalizeKey(secureStore.decrypt(encrypted)); }
        finally { encrypted.fill(0); }
      } else selectedKey = environmentKey();
      initialized = true;
      return publish('welcome', selectedKey ? MESSAGES.available : storageAvailable() ? MESSAGES.welcome : MESSAGES.unavailable, false);
    } catch (error) {
      initialized = true;
      return publish('error', MESSAGES[error.kind] || MESSAGES.credentials, false);
    }
  }

  function initialize() {
    if (initializing) return initializing;
    initializing = enqueue(initializeInternal);
    initializing.finally(() => { initializing = null; });
    return initializing;
  }

  async function saveEncrypted(key) {
    await safeParents(dirname(credentialsPath), true);
    await fs.chmod(dirname(credentialsPath), 0o700);
    const previous = await normalFile(credentialsPath, true, true);
    const encrypted = secureStore.encrypt(key);
    if (!Buffer.isBuffer(encrypted) || !encrypted.length || encrypted.length > MAX_CAPTURE) throw problem('save');
    const temporary = join(dirname(credentialsPath), `.credentials-${randomUUID()}.tmp`);
    let handle;
    try {
      handle = await fs.open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW || 0), 0o600);
      await handle.writeFile(encrypted);
      await handle.sync();
      await handle.close(); handle = null;
      await fs.chmod(temporary, 0o600);
      const current = await normalFile(credentialsPath, true, true);
      if (Boolean(previous) !== Boolean(current) || (previous && !sameFile(previous, current))) throw problem('files');
      await fs.rename(temporary, credentialsPath);
    } finally {
      encrypted.fill(0);
      if (handle) await handle.close();
      try { await fs.unlink(temporary); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
  }

  function saveKey(value) {
    let key;
    try { key = normalizeKey(value); }
    catch { return Promise.resolve(publish('error', MESSAGES.invalid)); }
    cancelStartup();
    return enqueue(async () => {
      await initializeInternal();
      if (!await stopEngine()) return publish('error', MESSAGES.stop, false);
      if (!storageAvailable()) return publish('error', MESSAGES.unavailable, false);
      try {
        await saveEncrypted(key);
        selectedKey = key;
        return publish('welcome', MESSAGES.saved, false);
      } catch (error) { return publish('error', MESSAGES[error.kind] || MESSAGES.save, false); }
    });
  }

  function forgetKey() {
    cancelStartup();
    return enqueue(async () => {
      await initializeInternal();
      if (!await stopEngine()) return publish('error', MESSAGES.stop, false);
      try {
        await safeParents(dirname(credentialsPath));
        const existing = await normalFile(credentialsPath, true, true);
        if (existing) await fs.unlink(credentialsPath);
        selectedKey = environmentKey();
        return publish('welcome', selectedKey ? 'Kaydedilen anahtar kaldırıldı. Bu bilgisayarda sağlanan anahtar kullanılabilir.' : MESSAGES.welcome, false);
      } catch (error) { return publish('error', MESSAGES[error.kind] || MESSAGES.forget, false); }
    });
  }

  function start() {
    if (starting) return starting;
    const epoch = operationEpoch;
    const pending = enqueue(async () => {
      await initializeInternal();
      if (epoch !== operationEpoch) return getStatus();
      if (engine && !engine.closed && status.gatewayReady) return getStatus();
      if (!selectedKey) return publish('welcome', storageAvailable() ? MESSAGES.welcome : MESSAGES.unavailable, false);
      if (!await stopEngine()) return publish('error', MESSAGES.stop, false);
      const current = { controller: new AbortController(), deadline: now() + startupTimeoutMs };
      session = current;
      const timer = setTimeout(() => current.controller.abort(problem('timeout')), startupTimeoutMs);
      function check() {
        if (current.controller.signal.aborted) throw problem(current.controller.signal.reason?.kind === 'timeout' ? 'timeout' : 'cancelled');
        if (now() >= current.deadline) throw problem('timeout');
        if (engine?.closed) throw spawnProblem(engine.result);
      }
      try {
        publish('starting', 'GIDEON hazırlanıyor…', false);
        const prepared = await runCommand(['setup-desktop'], current, Math.max(1, current.deadline - now()));
        check();
        if (prepared.code !== 0) throw problem('setup');
        const raw = await safeRead(join(stateDir, 'openclaw.json'), { maximum: 1024 * 1024 });
        const config = JSON.parse(raw.toString('utf8'));
        const gateway = config.gateway;
        if (!gateway || gateway.mode !== 'local' || gateway.bind !== 'loopback' || !Number.isInteger(gateway.port) || gateway.port < 1024 || gateway.port > 65535 || gateway.auth?.mode !== 'token' || typeof gateway.auth.token !== 'string' || !gateway.auth.token || gateway.auth.token.length > 1024 || /[\x00-\x1f\x7f]/.test(gateway.auth.token)) throw problem('files');
        gatewayToken = gateway.auth.token;
        check();
        publish('starting', 'Yerel hizmet başlatılıyor…', false);
        try { engine = spawnOwned([enginePath]); }
        catch (error) { throw spawnProblem(error); }
        const owned = engine;
        owned.done.then(() => {
          if (engine === owned && !owned.intentionallyStopping && status.phase === 'ready') {
            engine = null;
            publish('error', MESSAGES.engine, false);
          }
        });
        publish('starting', 'Güvenli bağlantı denetleniyor…', false);
        while (true) {
          check();
          let accessible = false;
          try {
            const response = await fetchImpl(`http://127.0.0.1:${gateway.port}/healthz`, {
              redirect: 'error', signal: AbortSignal.any([
                current.controller.signal, AbortSignal.timeout(Math.max(1, Math.min(1000, current.deadline - now()))),
              ]),
            });
            accessible = Boolean(response.ok);
            try { await response.body?.cancel(); } catch {}
          } catch {}
          check();
          if (accessible) {
            const health = await runCommand(['openclaw', 'health', '--json'], current, Math.max(1, Math.min(30_000, current.deadline - now())));
            check();
            let verified = false;
            if (health.code === 0 && !health.overflow) {
              try { verified = JSON.parse(health.stdout).ok === true; } catch {}
            }
            if (verified) return publish('ready', 'GIDEON açıldı. Gemini bağlantısı ilk konuşmanızda doğrulanacak.', true);
          }
          await delay(Math.max(1, Math.min(500, current.deadline - now())));
        }
      } catch (error) {
        const stopped = await stopEngine();
        if (!stopped) return publish('error', MESSAGES.stop, false);
        if (error.kind === 'cancelled') return publish('welcome', selectedKey ? MESSAGES.available : MESSAGES.welcome, false);
        return publish('error', MESSAGES[error.kind] || MESSAGES.setup, false);
      } finally {
        clearTimeout(timer);
        if (session === current) session = null;
      }
    });
    starting = pending;
    pending.then(() => { if (starting === pending) starting = null; }, () => { if (starting === pending) starting = null; });
    return pending;
  }

  function stop() {
    cancelStartup();
    return enqueue(async () => {
      const stopped = await stopEngine();
      return publish(stopped ? 'welcome' : 'error', stopped ? selectedKey ? MESSAGES.available : MESSAGES.welcome : MESSAGES.stop, false);
    });
  }

  return { initialize, getStatus, saveKey, start, stop, forgetKey };
}

module.exports = { createController };

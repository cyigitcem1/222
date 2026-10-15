#!/usr/bin/env node
// CI-only: upgrade the pinned published installer in an owned directory,
// preserve real local session/credential fixtures, then exercise and uninstall
// the current installed app. No engine or Gemini request is started.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createReadStream } from 'node:fs';
import { lstat, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argument = process.argv[2];
const budget = 600_000;
const previousVersion = '0.2.3';
const previousInstallerSha256 = 'b4209d9e235f71b60a542051d85667cdb8c8d69dd512711fd32dab8c91cd6c05';
const previousInstallerUrl = `https://github.com/cyigitcem1/222/releases/download/v${previousVersion}/GIDEON-${previousVersion}-Kurulum.exe`;
let stage = 'preflight', temporary, installDirectory, installedExecutable, ownedInstall = false;
let installerAttempted = false, uninstallAttempted = false, uninstalled = false, cleanupBlocked = false;
let dataMarker, dataDirectory, ownedDataDirectory = false, failed = false;
let fakeKey = '';
const sleep = ms => new Promise(fulfill => setTimeout(fulfill, ms));
function redact(value) {
  let text = String(value);
  for (const key of [fakeKey, process.env.GEMINI_API_KEY, process.env.GOOGLE_API_KEY]) if (key) text = text.split(key).join('[REDACTED]');
  return text.replace(/gideon-native-smoke-[a-f0-9]+/gi, '[REDACTED]')
    .replace(/([#?&]token=)[^\s"'<>]+/gi, '$1[REDACTED]')
    .replace(/((?:api[_ -]?key|authorization|token)\s*[=:]\s*)[^\s,;]+/gi, '$1[REDACTED]')
    .replace(/AIza[\w-]{20,}/g, '[REDACTED]');
}
function annotation(kind, message) {
  const safe = redact(message).replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');
  console.log(`::${kind} title=Windows installer smoke::${safe.slice(0, 6000)}`);
}
async function missing(path) {
  try { await lstat(path); return false; } catch (error) { if (error.code === 'ENOENT') return true; throw error; }
}
async function regular(path) {
  const entry = await lstat(path);
  assert.ok(entry.isFile() && !entry.isSymbolicLink(), 'Expected an installed regular file.');
}
async function hash(path) {
  await regular(path);
  const digest = createHash('sha256');
  for await (const data of createReadStream(path)) digest.update(data);
  return digest.digest('hex');
}
function samePath(a, b) { return typeof a === 'string' && resolve(a).toLowerCase() === resolve(b).toLowerCase(); }

async function run(command, args, { timeout = budget, output = false, label = stage, env = {} } = {}) {
  const child = spawn(command, args, { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...env, GEMINI_API_KEY: '', GOOGLE_API_KEY: '' } });
  let tail = '', timer;
  const capture = data => { const safe = redact(data); tail = (tail + safe).slice(-4000); if (output) process.stdout.write(safe); };
  child.stdout.on('data', capture); child.stderr.on('data', capture);
  const started = Date.now();
  const progress = setInterval(() => annotation('notice', `${label} still running; elapsed ${Math.round((Date.now() - started) / 1000)}s.`), 30_000);
  try {
    const result = await Promise.race([
      once(child, 'close'),
      new Promise((_, reject) => { timer = setTimeout(() => {
        try { child.kill(); } catch {}
        child.stdout.destroy(); child.stderr.destroy();
        reject(new Error(`${label} reached its ${timeout / 1000}s deadline.`));
      }, timeout); }),
    ]);
    assert.deepEqual(result, [0, null], `${label} did not exit naturally and successfully.`);
    return tail;
  } catch (error) {
    if (tail) annotation('notice', `${label} redacted output tail: ${tail}`);
    throw new Error(redact(error.message).slice(0, 1500));
  } finally { clearTimeout(timer); clearInterval(progress); }
}

async function availablePort() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  await new Promise(fulfill => server.close(fulfill));
  return port;
}

// Use each actual installed Electron version's Windows safeStorage and the same
// persistent user-data/Local State. Temporarily sequester the owned synthetic
// credential during the decrypt launch so it cannot auto-start the engine.
// Only its own inspector is reachable, on an ephemeral loopback port.
async function credentialProbe(mode, label) {
  const port = await availablePort();
  const credentials = join(dataDirectory, 'credentials.bin');
  const sequestered = join(temporary, 'synthetic-upgrade-credential.bin');
  let credentialMoved = false;
  if (mode === 'decrypt') { await rename(credentials, sequestered); credentialMoved = true; }
  const child = spawn(installedExecutable, [`--inspect=127.0.0.1:${port}`], {
    cwd: installDirectory, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, GEMINI_API_KEY: '', GOOGLE_API_KEY: '', GIDEON_DESKTOP_DATA_DIR: dataDirectory, ELECTRON_RUN_AS_NODE: '' },
  });
  const closed = once(child, 'close');
  // The app may fail before its inspector exists. Mark the close promise as
  // observed immediately; its original rejection is still awaited below.
  closed.catch(() => {});
  let tail = '', socket, timer;
  let spawnFailed = false;
  child.once('error', () => { spawnFailed = true; });
  const capture = data => { tail = redact(tail + String(data)).slice(-4000); };
  child.stdout.on('data', capture); child.stderr.on('data', capture);
  const pending = new Map(); let sequence = 0;
  const command = (method, params) => new Promise((fulfill, reject) => {
    const id = ++sequence;
    const deadline = setTimeout(() => { pending.delete(id); reject(new Error(`${label}: inspector request timed out.`)); }, 20_000);
    pending.set(id, { fulfill, reject, deadline });
    socket.send(JSON.stringify({ id, method, params }));
  });
  try {
    const deadline = Date.now() + 60_000; let target;
    while (Date.now() < deadline) {
      assert.equal(spawnFailed, false, `${label}: installed app could not be started.`);
      assert.equal(child.exitCode, null, `${label}: installed app exited before its inspector appeared.`);
      try {
        const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(1000) });
        target = (await response.json()).find(target => typeof target.webSocketDebuggerUrl === 'string');
        if (target) break;
      } catch {}
      await sleep(100);
    }
    assert.ok(target, `${label}: installed app inspector did not appear.`);
    const endpoint = new URL(target.webSocketDebuggerUrl);
    assert.equal(endpoint.protocol, 'ws:'); assert.equal(endpoint.hostname, '127.0.0.1');
    assert.equal(Number(endpoint.port), port);
    socket = new WebSocket(endpoint);
    await Promise.race([
      new Promise((fulfill, reject) => {
        socket.addEventListener('open', fulfill, { once: true });
        socket.addEventListener('error', () => reject(new Error(`${label}: own inspector connection failed.`)), { once: true });
      }),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label}: own inspector connection timed out.`)), 10_000); }),
    ]);
    clearTimeout(timer);
    socket.addEventListener('message', event => {
      let response; try { response = JSON.parse(String(event.data)); } catch { return; }
      const request = pending.get(response.id); if (!request) return;
      pending.delete(response.id); clearTimeout(request.deadline);
      if (response.error) request.reject(new Error(`${label}: own inspector rejected an operation.`));
      else request.fulfill(response.result);
    });
    const operation = mode === 'encrypt'
      ? `let window;for(let attempt=0;attempt<150;attempt++){window=e.BrowserWindow.getAllWindows()[0];try{if(window&&await window.webContents.executeJavaScript("typeof window.gideon?.saveKey==='function'"))break;}catch{}await new Promise(resolve=>setTimeout(resolve,100));}if(!window)throw new Error('Owned setup window unavailable');const saved=await window.webContents.executeJavaScript(${JSON.stringify(`window.gideon.saveKey(${JSON.stringify(fakeKey)})`)});return saved?.hasKey===true&&saved?.gatewayReady===false&&fs.existsSync(${JSON.stringify(credentials)});`
      : `return e.safeStorage.decryptString(fs.readFileSync(${JSON.stringify(sequestered)}))===${JSON.stringify(fakeKey)};`;
    const result = await command('Runtime.evaluate', {
      expression: `(async()=>{const r=process.mainModule.require.bind(process.mainModule);const e=r('electron');const fs=r('node:fs');await e.app.whenReady();if(!e.safeStorage.isEncryptionAvailable())throw new Error('Windows secure storage unavailable');${operation}})()`,
      awaitPromise: true, returnByValue: true,
    });
    assert.ok(!result.exceptionDetails && result.result?.value === true, `${label}: Windows encrypted credential did not round-trip.`);
    await command('Runtime.evaluate', { expression: "(()=>{const e=process.mainModule.require('electron');setTimeout(()=>e.app.quit(),100);return true;})()", returnByValue: true });
    socket.close(); socket = undefined;
    const result_ = await Promise.race([
      closed,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label}: installed app did not exit naturally.`)), 30_000); }),
    ]);
    assert.deepEqual(result_, [0, null], `${label}: installed app did not exit naturally.`);
    assert.ok(await missing(join(dataDirectory, 'state', 'launcher-runtime.json')), `${label}: credential probe unexpectedly started an engine.`);
  } catch (error) {
    if (tail) annotation('notice', `${label} output tail: ${tail}`);
    throw error;
  } finally {
    clearTimeout(timer);
    for (const request of pending.values()) { clearTimeout(request.deadline); request.reject(new Error('Own inspector closed.')); }
    socket?.close();
    if (child.pid && child.exitCode === null && child.signalCode === null) {
      // The exact still-running child PID owns this tree; never terminate
      // processes by shared application name or touch an unrelated app instance.
      await run('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { timeout: 30_000, label: `${label}: owned process cleanup` }).catch(() => {});
      await Promise.race([closed.catch(() => {}), sleep(5000)]);
    }
    if (credentialMoved) {
      assert.ok(await missing(credentials), 'Credential probe unexpectedly recreated the retained credential path.');
      await rename(sequestered, credentials);
    }
  }
}

// This worker resolves only the shipped public SDK. It writes genuine SQLite
// session rows and transcript events, rather than creating a lookalike database.
const sessionFixtureScript = String.raw`
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const [runtime,stateDir,mode,sessionId] = process.argv.slice(2);
const {openclawEnv}=await import(pathToFileURL(join(runtime,'lib','profile.mjs')).href);
const env=openclawEnv(stateDir,{...process.env,GEMINI_API_KEY:'',GOOGLE_API_KEY:''});
Object.assign(process.env,env);
const store=await import(pathToFileURL(join(runtime,'node_modules','openclaw','dist','plugin-sdk','session-store-runtime.js')).href);
const transcript=await import(pathToFileURL(join(runtime,'node_modules','openclaw','dist','plugin-sdk','session-transcript-runtime.js')).href);
const config=JSON.parse(await readFile(join(stateDir,'openclaw.json'),'utf8'));
const scope={agentId:'main',sessionKey:'agent:main:main',sessionId,storePath:join(stateDir,'agents','main','agent','openclaw-agent.sqlite'),env};
const startedAt=Date.parse('2026-10-14T17:00:00.000Z');
const messages=Array.from({length:61},(_,minute)=>({
  message:{role:'user',content:[{type:'text',text:'SENTETİK TEST '+minute+'. dakika: Yarın İzmir yolculuğum var; konuşmanın bu bölümünü koru.'}],timestamp:startedAt+minute*60000},
  now:startedAt+minute*60000
}));
if(mode==='seed'){
  await store.upsertSessionEntry({...scope,entry:{sessionId,updatedAt:startedAt+3600000,sessionStartedAt:startedAt,lastInteractionAt:startedAt+3600000,chatType:'direct',label:'Sentetik bir saatlik konuşma',providerOverride:'google',modelOverride:'gemini-3.1-pro-preview'}});
  const results=await transcript.appendSessionTranscriptMessagesByIdentity({...scope,config,cwd:join(stateDir,'workspace'),messages});
  assert.equal(results.length,61);assert.ok(results.every(result=>result.appended));
}
const entry=store.getSessionEntry(scope);assert.equal(entry?.sessionId,sessionId);assert.equal(entry?.modelOverride,'gemini-3.1-pro-preview');
const events=store.loadTranscriptEventsSync(scope).filter(event=>event.type==='message');
assert.equal(events.length,61);assert.deepEqual(events.map(event=>event.message),messages.map(append=>append.message));
console.log('PASS: shipped SDK '+mode+' verified 61 persisted message events spanning one hour in the active SQLite store.');
`;

async function runProfileSetup(label) {
  const resources = join(installDirectory, 'resources');
  const runtime = join(resources, 'runtime');
  await run(join(resources, 'node', 'node.exe'), ['--require', join(runtime, 'lib', 'windows-runtime-preload.cjs'), join(runtime, 'scripts', 'gideon.mjs'), 'setup-desktop'], {
    timeout: 120_000, output: true, label, env: { GIDEON_STATE_DIR: join(dataDirectory, 'state'), GIDEON_NO_OPEN: '1' },
  });
}

async function runSessionFixture(mode, sessionId) {
  const resources = join(installDirectory, 'resources');
  const runtime = join(resources, 'runtime');
  await run(join(resources, 'node', 'node.exe'), ['--require', join(runtime, 'lib', 'windows-runtime-preload.cjs'), join(temporary, 'session-fixture.mjs'), runtime, join(dataDirectory, 'state'), mode, sessionId], {
    timeout: 90_000, output: true, label: `Installed SDK ${mode} of synthetic one-hour conversation`,
  });
}

// GUID is the pinned electron-builder v5 UUID for appId tr.gideon.desktop.
// Read exact application keys only; never dump unrelated registry values.
const probeScript = String.raw`$ErrorActionPreference='Stop'
$guid='8452dfed-fdb4-5196-a0bb-2398eb591f6b'
$records=[System.Collections.Generic.List[object]]::new()
foreach($scope in @('CurrentUser','LocalMachine')){
  foreach($view in @('Registry64','Registry32')){
    $hive=[Enum]::Parse([Microsoft.Win32.RegistryHive],$scope)
    $registryView=[Enum]::Parse([Microsoft.Win32.RegistryView],$view)
    $base=[Microsoft.Win32.RegistryKey]::OpenBaseKey($hive,$registryView)
    $install=$null;$arp=$null
    try{
      $install=$base.OpenSubKey('Software\'+$guid)
      $arp=$base.OpenSubKey('Software\Microsoft\Windows\CurrentVersion\Uninstall\'+$guid)
      $location=$null;$uninstallTarget=$null
      if($null -ne $install){$location=$install.GetValue('InstallLocation')}
      if($null -ne $arp){
        $command=[string]$arp.GetValue('UninstallString')
        if($command -match '^"([^"]+)"'){$uninstallTarget=$Matches[1]}
      }
      $records.Add([pscustomobject]@{Scope=$scope;View=$view;InstallPresent=($null -ne $install);UninstallPresent=($null -ne $arp);Location=$location;UninstallTarget=$uninstallTarget})
    }finally{if($null -ne $install){$install.Dispose()};if($null -ne $arp){$arp.Dispose()};$base.Dispose()}
  }
}
$links=[System.Collections.Generic.List[object]]::new()
$shell=New-Object -ComObject WScript.Shell
foreach($item in @(@('Desktop','DesktopDirectory'),@('StartMenu','Programs'),@('SharedDesktop','CommonDesktopDirectory'),@('SharedStartMenu','CommonPrograms'))){
  $specialFolder=[Enum]::Parse([Environment+SpecialFolder],[string]$item[1])
  $folder=[Environment]::GetFolderPath($specialFolder)
  $path=Join-Path $folder 'GIDEON.lnk'
  $exists=Test-Path -LiteralPath $path
  $target=$null;$arguments=$null
  if($exists){$link=$shell.CreateShortcut($path);$target=$link.TargetPath;$arguments=$link.Arguments}
  $links.Add([pscustomobject]@{Kind=$item[0];Path=$path;Exists=$exists;Target=$target;Arguments=$arguments})
}
[pscustomobject]@{Records=$records.ToArray();Links=$links.ToArray();GideonProcesses=@(Get-Process -Name GIDEON -ErrorAction SilentlyContinue).Count} | ConvertTo-Json -Depth 5 -Compress
`;

async function probe() {
  const output = await run('pwsh.exe', ['-NoProfile', '-NonInteractive', '-File', join(temporary, 'probe.ps1')], { timeout: 30_000, label: 'Own installer registry and shortcut probe' });
  return JSON.parse(output.replace(/^\uFEFF/, ''));
}
function emptyRegistration(state) {
  return state.Records.every(record => !record.InstallPresent && !record.UninstallPresent) && state.Links.every(link => !link.Exists);
}
function registryOwnsTarget(state) {
  const own = state.Records.find(record => record.Scope === 'CurrentUser' && record.View === 'Registry64');
  return own?.InstallPresent && own.UninstallPresent && samePath(own.Location, installDirectory)
    && samePath(own.UninstallTarget, join(installDirectory, 'Uninstall GIDEON.exe'));
}
function assertOwnRegistry(state) {
  assert.equal(state.GideonProcesses, 0, 'Silent installation unexpectedly launched GIDEON, or another GIDEON process exists.');
  const own = state.Records.find(record => record.Scope === 'CurrentUser' && record.View === 'Registry64');
  assert.ok(own?.InstallPresent && own.UninstallPresent, 'Per-user uninstall registration is missing.');
  assert.ok(samePath(own.Location, installDirectory), 'Installer registered a directory outside its owned test target.');
  assert.ok(samePath(own.UninstallTarget, join(installDirectory, 'Uninstall GIDEON.exe')), 'Registered uninstaller does not belong to this test.');
  assert.ok(state.Records.filter(record => record.Scope === 'LocalMachine').every(record => !record.InstallPresent && !record.UninstallPresent), 'Per-user installer wrote a machine registration.');
}
async function assertOwnRegistration(state) {
  assertOwnRegistry(state);
  for (const kind of ['Desktop', 'StartMenu']) {
    const link = state.Links.find(link => link.Kind === kind);
    const detail = `${kind} shortcut does not target the installed GIDEON executable: ${JSON.stringify({ expected: installedExecutable, link })}`;
    assert.ok(link?.Exists && typeof link.Target === 'string' && link.Arguments === '', detail);
    await regular(link.Target); await regular(installedExecutable);
    // Windows TEMP can use RUNNER~1 while the shell returns runneradmin.
    // Compare the existing files' canonical paths, not their DOS alias spelling.
    assert.ok(samePath(await realpath(link.Target), await realpath(installedExecutable)), detail);
  }
  assert.ok(state.Links.filter(link => link.Kind.startsWith('Shared')).every(link => !link.Exists), 'Per-user installer created a shared shortcut.');
}

async function assertInstalledVersion(version) {
  const require = createRequire(join(root, 'desktop', 'package.json'));
  const asar = require('@electron/asar');
  const packaged = JSON.parse(asar.extractFile(join(installDirectory, 'resources', 'app.asar'), 'package.json').toString('utf8'));
  assert.equal(packaged.version, version, 'Installed application version does not match the intended upgrade stage.');
}

async function verifyInstalled(installer, version) {
  const sources = JSON.parse(await readFile(join(dirname(installer), 'PACKAGED-SOURCES.json'), 'utf8'));
  assert.equal(sources.format, 1); assert.equal(sources.version, version);
  assert.ok(sources.files && Object.keys(sources.files).length > 1000, 'Packaged runtime source manifest is incomplete.');
  const resources = join(installDirectory, 'resources');
  const require = createRequire(join(root, 'desktop', 'package.json'));
  const asar = require('@electron/asar');
  const archive = join(resources, 'app.asar');
  await regular(archive);
  const entries = Object.entries(sources.files);
  const started = Date.now(); let lastNotice = started;
  for (let offset = 0; offset < entries.length; offset += 24) {
    await Promise.all(entries.slice(offset, offset + 24).map(async ([name, expected]) => {
      assert.ok(typeof name === 'string' && !name.includes('\\') && name.split('/').every(part => part && part !== '.' && part !== '..' && !part.includes(':')), 'Unsafe packaged manifest path.');
      assert.match(expected, /^[a-f0-9]{64}$/);
      const actual = name.startsWith('app.asar/')
        ? createHash('sha256').update(asar.extractFile(archive, name.slice('app.asar/'.length))).digest('hex')
        : await hash(join(resources, ...name.split('/')));
      assert.equal(actual, expected, `Installed packaged source checksum mismatch: ${name}`);
    }));
    if (Date.now() - lastNotice > 15_000) { annotation('notice', `Verified ${Math.min(offset + 24, entries.length)}/${entries.length} installed source checksums.`); lastNotice = Date.now(); }
  }
  const unpacked = join(dirname(installer), 'win-unpacked');
  assert.equal(await hash(installedExecutable), await hash(join(unpacked, 'GIDEON.exe')), 'Installed Electron executable differs from the verified packaged app.');
  const manifestPath = join(resources, 'runtime-manifest.json');
  assert.equal(await hash(manifestPath), await hash(join(unpacked, 'resources', 'runtime-manifest.json')));
  const runtimeManifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  assert.equal(await hash(join(resources, 'node', 'node.exe')), runtimeManifest.node.executableSha256, 'Installed bundled Node checksum differs from the verified runtime.');
  annotation('notice', `Verified all ${entries.length} installed packaged source checksums, Electron executable and bundled Node.`);
}

async function uninstall() {
  uninstallAttempted = true;
  stage = 'natural uninstall and own shortcut/registry cleanup';
  const state = await probe(); assertOwnRegistry(state);
  const uninstaller = join(installDirectory, 'Uninstall GIDEON.exe'); await regular(uninstaller);
  await run(uninstaller, ['/currentuser', '/S'], { label: 'Own silent GIDEON uninstaller' });
  const deadline = Date.now() + budget;
  let lastNotice = 0, after;
  while (Date.now() < deadline) {
    after = await probe();
    if (emptyRegistration(after) && await missing(installDirectory)) {
      assert.equal(after.GideonProcesses, 0, 'A GIDEON process survived uninstall.');
      ownedInstall = false;
      uninstalled = true;
      annotation('notice', 'Own installed application, per-user registration and created shortcuts were removed.');
      return;
    }
    if (Date.now() - lastNotice > 60_000) {
      annotation('notice', `Own uninstall remaining state: ${JSON.stringify({ ...after, directoryExists: !(await missing(installDirectory)) })}`);
      lastNotice = Date.now();
    }
    await sleep(3000);
  }
  const remainingFiles = [];
  let visitedDirectories = 0;
  async function collect(directory) {
    if (++visitedDirectories > 200 || remainingFiles.length >= 16) return;
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (remainingFiles.length >= 16) break;
      const path = join(directory, entry.name);
      if (entry.isDirectory() && !entry.isSymbolicLink()) await collect(path);
      else remainingFiles.push({ path, length: path.length });
    }
  }
  if (!(await missing(installDirectory))) await collect(installDirectory);
  throw new Error(`Own uninstaller did not remove the installed app, shortcuts and registration before its deadline: ${JSON.stringify({ ...after, remainingFiles })}`);
}

async function main() {
  if (process.platform !== 'win32' || process.env.GITHUB_ACTIONS !== 'true') throw new Error('Installer smoke requires an isolated GitHub Actions Windows runner.');
  if (!argument) throw new Error('Supply the built GIDEON installer executable.');
  assert.ok(process.env.APPDATA, 'Windows APPDATA is unavailable.');
  dataDirectory = join(process.env.APPDATA, 'GIDEON');
  assert.ok(await missing(dataDirectory), 'Existing GIDEON user data is protected; installer smoke refused.');
  const installer = resolve(argument); await regular(installer);
  const desktopPackage = JSON.parse(await readFile(join(root, 'desktop', 'package.json'), 'utf8'));
  const sums = await readFile(join(dirname(installer), 'SHA256SUMS.txt'), 'utf8');
  const line = sums.split(/\r?\n/).find(line => line.endsWith(`  ${basename(installer)}`));
  assert.ok(line && /^[a-f0-9]{64}  /.test(line), 'Installer checksum is absent from the built artifact manifest.');
  assert.equal(await hash(installer), line.slice(0, 64), 'Installer checksum differs from the built artifact.');
  temporary = await mkdtemp(join(tmpdir(), 'gideon-installer-smoke-'));
  installDirectory = join(temporary, 'installed'); installedExecutable = join(installDirectory, 'GIDEON.exe');
  // NSIS /D must be the final, unquoted parameter. Hosted Windows runner TEMP
  // has no spaces; refuse another layout rather than testing a different path.
  assert.ok(!/\s/.test(installDirectory), 'CI install target must have no whitespace for the standard NSIS /D parameter.');
  await writeFile(join(temporary, 'probe.ps1'), probeScript);
  await writeFile(join(temporary, 'session-fixture.mjs'), sessionFixtureScript);
  const before = await probe();
  assert.ok(emptyRegistration(before), 'Existing GIDEON installation or shortcuts are protected; smoke refused.');
  assert.equal(before.GideonProcesses, 0, 'Existing GIDEON processes are protected; smoke refused.');
  stage = 'download and authenticate published previous installer';
  const previousInstaller = join(temporary, `GIDEON-${previousVersion}-Kurulum.exe`);
  await run('curl.exe', ['--fail', '--location', '--show-error', '--silent', '--max-time', '240', '--output', previousInstaller, previousInstallerUrl], { timeout: 250_000, label: stage });
  assert.equal(await hash(previousInstaller), previousInstallerSha256, 'Published previous installer does not match the pinned verified release; upgrade smoke refused.');
  stage = 'actual previous per-user silent installation';
  installerAttempted = true;
  await run(previousInstaller, ['/S', `/D=${installDirectory}`], { label: stage });
  const installedState = await probe();
  if (registryOwnsTarget(installedState)) ownedInstall = true;
  await assertOwnRegistration(installedState);
  await regular(installedExecutable); await regular(join(installDirectory, 'Uninstall GIDEON.exe'));
  assert.ok(await missing(dataDirectory), 'Silent installer unexpectedly launched the app or created user data.');
  await assertInstalledVersion(previousVersion);
  await mkdir(dataDirectory); ownedDataDirectory = true;
  dataMarker = join(dataDirectory, `installer-test-${randomBytes(12).toString('hex')}.txt`);
  const markerText = 'Owned CI marker: upgrades and uninstall must preserve application data.\n';
  await writeFile(dataMarker, markerText, { flag: 'wx' });
  stage = 'previous installed profile and active one-hour SQLite conversation';
  await runProfileSetup(stage);
  const stateDirectory = join(dataDirectory, 'state');
  const configPath = join(stateDirectory, 'openclaw.json');
  const oldConfig = JSON.parse(await readFile(configPath, 'utf8'));
  const oldAgentInstructions = await readFile(join(stateDirectory, 'workspace', 'AGENTS.md'));
  assert.equal(oldConfig.agents.defaults.model.primary, 'google/gemini-3.1-pro-preview');
  const userPath = join(stateDirectory, 'workspace', 'USER.md');
  const memoryPath = join(stateDirectory, 'workspace', 'MEMORY.md');
  const dailyPath = join(stateDirectory, 'workspace', 'memory', '2026-10-14.md');
  await writeFile(userPath, '# Sentetik kullanıcı tercihi\nTürkçe konuş; İzmir yolculuğu notlarımı koru.\n');
  await writeFile(memoryPath, '# Sentetik kalıcı hafıza\nYarın İzmir yolculuğum var. Bir saatlik konuşmanın notları güncellemede silinmemeli.\n');
  await writeFile(dailyPath, '# Sentetik günlük not\nProgram güncellemesi kullanıcı notlarını değiştirmemeli.\n', { flag: 'wx' });
  const sessionId = randomUUID();
  await runSessionFixture('seed', sessionId);
  stage = 'previous installed Electron Windows encrypted credential fixture';
  fakeKey = `gideon-native-smoke-${randomBytes(20).toString('hex')}`;
  await credentialProbe('encrypt', stage);
  const credentialPath = join(dataDirectory, 'credentials.bin');
  const credentialBytes = await readFile(credentialPath);
  assert.ok(credentialBytes.length > 0 && !credentialBytes.includes(Buffer.from(fakeKey)), 'Previous credential fixture was not encrypted.');
  const sqlitePath = join(stateDirectory, 'agents', 'main', 'agent', 'openclaw-agent.sqlite');
  const protectedPaths = [dataMarker, userPath, memoryPath, dailyPath, credentialPath, sqlitePath];
  const protectedHashes = new Map(await Promise.all(protectedPaths.map(async path => [path, await hash(path)])));
  const assertPreserved = async label => {
    for (const [path, expected] of protectedHashes) assert.equal(await hash(path), expected, `${label}: saved user data changed (${basename(path)}).`);
  };
  stage = 'actual current installer over previous installed version';
  await run(installer, ['/S', `/D=${installDirectory}`], { label: stage });
  await assertOwnRegistration(await probe());
  await assertInstalledVersion(desktopPackage.version);
  await assertPreserved('Installer upgrade');
  stage = 'installed file and source integrity';
  await verifyInstalled(installer, desktopPackage.version);
  stage = 'new installed profile migration without memory loss';
  await runProfileSetup(stage);
  await assertPreserved('Profile migration');
  const migrated = JSON.parse(await readFile(configPath, 'utf8'));
  assert.ok(migrated.gateway.auth.token === oldConfig.gateway.auth.token, 'Profile migration replaced the saved gateway token.');
  assert.equal(migrated.agents.defaults.model.primary, oldConfig.agents.defaults.model.primary, 'Profile migration replaced the chosen model.');
  assert.equal(migrated.session.reset.mode, 'none', 'Profile migration enabled automatic session resets.');
  assert.equal(JSON.parse(await readFile(join(stateDirectory, 'gideon-install.json'), 'utf8')).capabilitiesRevision, 2, 'New installed capabilities were not migrated.');
  assert.ok(!oldAgentInstructions.equals(await readFile(join(stateDirectory, 'workspace', 'AGENTS.md'))), 'Unmodified old factory instructions were not updated.');
  await regular(join(stateDirectory, 'workspace', 'TOOLS.md'));
  const migratedConfigBytes = await readFile(configPath);
  await runProfileSetup('repeat installed setup remains idempotent');
  assert.ok(migratedConfigBytes.equals(await readFile(configPath)), 'Repeated installed setup rewrote configuration.');
  await assertPreserved('Repeated installed setup');
  await runSessionFixture('verify', sessionId);
  stage = 'new installed Electron decrypts retained old Windows credential';
  await credentialProbe('decrypt', stage);
  assert.equal(await hash(credentialPath), protectedHashes.get(credentialPath), 'Reading the retained encrypted credential changed its bytes.');
  stage = 'installed real PDF and document creation';
  await run(process.execPath, [join(root, 'scripts', 'verify-documents-windows.mjs'), join(installDirectory, 'resources')], { output: true, timeout: 120_000, label: stage });
  stage = 'actual installed GUI, second click and Windows DPAPI';
  const guiAppData = join(temporary, 'isolated-gui-appdata'); await mkdir(guiAppData);
  await run(process.execPath, [join(root, 'scripts', 'verify-desktop-launch-windows.mjs'), installedExecutable], { output: true, label: stage, env: { APPDATA: guiAppData } });
  assert.equal(await readFile(dataMarker, 'utf8'), markerText, 'Isolated GUI smoke changed the normal GIDEON data marker.');
  await assertPreserved('Isolated installed GUI smoke');
  await uninstall();
  await assertPreserved('Uninstaller');
  annotation('notice', `PASS: actual published ${previousVersion} → ${desktopPackage.version} per-user installer upgrade; active SQLite conversation spanning one hour, notes, custom user preferences, model, token and encrypted credentials retained; new profile migration/idempotence, installed PDF/Markdown/TXT/CSV, all source checksums, shortcut targets, real GUI/second click/DPAPI/natural exit and own uninstall cleanup verified. No engine or Gemini request was started.`);
}

try { await main(); }
catch (error) { failed = true; annotation('error', `Stage=${stage}: ${error.message}`); }
finally {
  if (installerAttempted && !uninstalled && !ownedInstall) {
    try {
      const partial = await probe();
      if (registryOwnsTarget(partial)) ownedInstall = true;
      else if (!emptyRegistration(partial) || partial.GideonProcesses !== 0) {
        throw new Error('Partial installation cleanup ownership could not be verified; registration, shortcuts and files were retained.');
      }
    } catch (error) { failed = true; cleanupBlocked = true; annotation('error', `Partial installation cleanup: ${error.message}`); }
  }
  if (ownedInstall && !uninstallAttempted) {
    try { await uninstall(); } catch (error) { failed = true; annotation('error', `Own installation cleanup: ${error.message}`); }
  }
  if (ownedDataDirectory) {
    try {
      assert.equal(await readFile(dataMarker, 'utf8'), 'Owned CI marker: upgrades and uninstall must preserve application data.\n');
      assert.equal((await probe()).GideonProcesses, 0, 'Owned app-data cleanup refused while GIDEON is running.');
      // This directory was absent at preflight and created by this test. It
      // contains only synthetic fixtures and the two owned GUI probes' data.
      await rm(dataDirectory, { recursive: true, force: true, maxRetries: 3, retryDelay: 500 });
    } catch { annotation('notice', 'Owned synthetic app-data cleanup could not be safely completed; files were preserved.'); }
  }
  if (temporary && !ownedInstall && !cleanupBlocked) {
    try { await rm(temporary, { recursive: true, force: true, maxRetries: 3, retryDelay: 500 }); }
    catch { annotation('notice', 'Owned installer smoke temporary directory could not be completely removed.'); }
  } else if (temporary) {
    annotation('notice', 'Owned install directory was retained because verified uninstall cleanup did not finish.');
  }
}
if (failed) process.exitCode = 1;

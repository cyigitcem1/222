#!/usr/bin/env node
// CI-only: install once into an owned directory, exercise the installed app,
// then use its own uninstaller. No engine or Gemini request is started.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { createReadStream } from 'node:fs';
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, rmdir, unlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argument = process.argv[2];
const budget = 600_000;
let stage = 'preflight', temporary, installDirectory, installedExecutable, ownedInstall = false;
let installerAttempted = false, uninstallAttempted = false, uninstalled = false, cleanupBlocked = false;
let dataMarker, dataDirectory, ownedDataDirectory = false, failed = false;
const sleep = ms => new Promise(fulfill => setTimeout(fulfill, ms));
function redact(value) {
  let text = String(value);
  for (const key of [process.env.GEMINI_API_KEY, process.env.GOOGLE_API_KEY]) if (key) text = text.split(key).join('[REDACTED]');
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

async function run(command, args, { timeout = budget, output = false, label = stage } = {}) {
  const child = spawn(command, args, { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, GEMINI_API_KEY: '', GOOGLE_API_KEY: '' } });
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
function assertOwnRegistration(state) {
  assertOwnRegistry(state);
  for (const kind of ['Desktop', 'StartMenu']) {
    const link = state.Links.find(link => link.Kind === kind);
    assert.ok(link?.Exists && samePath(link.Target, installedExecutable) && link.Arguments === '', `${kind} shortcut does not target the installed GIDEON executable: ${JSON.stringify({ expected: installedExecutable, link })}`);
  }
  assert.ok(state.Links.filter(link => link.Kind.startsWith('Shared')).every(link => !link.Exists), 'Per-user installer created a shared shortcut.');
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
  const remainingFiles = await missing(installDirectory) ? [] : (await readdir(installDirectory)).slice(0, 40);
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
  const before = await probe();
  assert.ok(emptyRegistration(before), 'Existing GIDEON installation or shortcuts are protected; smoke refused.');
  assert.equal(before.GideonProcesses, 0, 'Existing GIDEON processes are protected; smoke refused.');
  stage = 'actual per-user silent installation';
  installerAttempted = true;
  await run(installer, ['/S', `/D=${installDirectory}`], { label: stage });
  const installedState = await probe();
  if (registryOwnsTarget(installedState)) ownedInstall = true;
  assertOwnRegistration(installedState);
  await regular(installedExecutable); await regular(join(installDirectory, 'Uninstall GIDEON.exe'));
  assert.ok(await missing(dataDirectory), 'Silent installer unexpectedly launched the app or created user data.');
  stage = 'installed file and source integrity';
  await verifyInstalled(installer, desktopPackage.version);
  stage = 'actual installed GUI, second click and Windows DPAPI';
  await run(process.execPath, [join(root, 'scripts', 'verify-desktop-launch-windows.mjs'), installedExecutable], { output: true, label: stage });
  assert.ok(await missing(dataDirectory), 'Isolated GUI smoke changed the normal GIDEON user data directory.');
  await mkdir(dataDirectory); ownedDataDirectory = true;
  dataMarker = join(dataDirectory, `installer-test-${randomBytes(12).toString('hex')}.txt`);
  await writeFile(dataMarker, 'Owned CI marker: uninstall must preserve application data.\n', { flag: 'wx' });
  await uninstall();
  assert.equal(await readFile(dataMarker, 'utf8'), 'Owned CI marker: uninstall must preserve application data.\n', 'Uninstaller removed application data.');
  annotation('notice', 'PASS: actual per-user installer, installed source checksums, Desktop/Start Menu shortcut targets, real GUI/second click/DPAPI/natural exit, own uninstall cleanup and preserved app data. No engine or Gemini request was started.');
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
    try { if (dataMarker) await unlink(dataMarker); await rmdir(dataDirectory); }
    catch { annotation('notice', 'Own app-data marker directory could not be removed; other contents were preserved.'); }
  }
  if (temporary && !ownedInstall && !cleanupBlocked) {
    try { await rm(temporary, { recursive: true, force: true, maxRetries: 3, retryDelay: 500 }); }
    catch { annotation('notice', 'Owned installer smoke temporary directory could not be completely removed.'); }
  } else if (temporary) {
    annotation('notice', 'Owned install directory was retained because verified uninstall cleanup did not finish.');
  }
}
if (failed) process.exitCode = 1;

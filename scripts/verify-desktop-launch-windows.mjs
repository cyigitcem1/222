#!/usr/bin/env node
// Exercises the actual Electron executable and sandboxed renderer. No engine
// startup or Gemini request: saveKey/forgetKey use only local Windows storage.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { lstat, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const arguments_ = process.argv.slice(2);
const legacy = arguments_.includes('--legacy-profile');
const executableArgument = arguments_.find(value => !value.startsWith('--'));
const timeoutArgument = arguments_.find(value => value.startsWith('--startup-timeout-ms='));
const startupTimeoutMs = timeoutArgument ? Number(timeoutArgument.split('=')[1]) : 300_000;
let stage = 'preflight';
let temporary, child, secondChild, closed, page, browser, mainInspector, legacyDirectory;
let mayRemoveLegacy = false;
let exited = false;
let exitResult;
let tail = '';
let fakeKey = '';
const rendererFailures = [];
const sleep = ms => new Promise(fulfill => setTimeout(fulfill, ms));

function redact(value) {
  let text = String(value);
  for (const secret of [fakeKey, process.env.GEMINI_API_KEY, process.env.GOOGLE_API_KEY]) {
    if (secret) text = text.split(secret).join('[REDACTED]');
  }
  return text
    .replace(/([#?&]token=)[^\s"'<>]+/gi, '$1[REDACTED]')
    .replace(/((?:api[_ -]?key|authorization|token)\s*[=:]\s*)[^\s,;]+/gi, '$1[REDACTED]')
    .replace(/AIza[\w-]{20,}/g, '[REDACTED]');
}

function annotation(kind, message) {
  const safe = redact(message).replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');
  console.log(`::${kind} title=Windows Electron GUI smoke::${safe.slice(0, 6000)}`);
}

function capture(data) { tail = redact((tail + String(data)).slice(-32_768)); }

async function missing(path) {
  try { await lstat(path); return false; }
  catch (error) { if (error.code === 'ENOENT') return true; throw error; }
}

async function availablePort() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  await new Promise(fulfill => server.close(fulfill));
  return port;
}

class DevTools {
  constructor(url) {
    const parsed = new URL(url);
    if (parsed.protocol !== 'ws:' || !['127.0.0.1', 'localhost'].includes(parsed.hostname)) throw new Error('Non-loopback DevTools endpoint refused.');
    this.socket = new WebSocket(url);
    this.pending = new Map();
    this.sequence = 0;
    this.socket.addEventListener('message', event => {
      let message;
      try { message = JSON.parse(String(event.data)); } catch { return; }
      if (message.id && this.pending.has(message.id)) {
        const pending = this.pending.get(message.id);
        clearTimeout(pending.timer); this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(`DevTools ${pending.method} failed.`));
        else pending.fulfill(message.result);
      }
      if (message.method === 'Runtime.exceptionThrown' && rendererFailures.length < 12) {
        const detail = message.params?.exceptionDetails;
        rendererFailures.push(redact(detail?.exception?.description || detail?.text || 'Renderer exception').slice(0, 1200));
      }
      if (message.method === 'Log.entryAdded' && message.params?.entry?.level === 'error' && rendererFailures.length < 12) {
        rendererFailures.push(redact(message.params.entry.text).slice(0, 1200));
      }
    });
    const disconnected = () => {
      for (const pending of this.pending.values()) {
        clearTimeout(pending.timer); pending.reject(new Error('DevTools disconnected.'));
      }
      this.pending.clear();
    };
    this.socket.addEventListener('close', disconnected);
    this.socket.addEventListener('error', disconnected);
  }
  async connect() {
    if (this.socket.readyState === WebSocket.OPEN) return;
    let timer;
    try {
      await Promise.race([
        new Promise((fulfill, reject) => {
          this.socket.addEventListener('open', fulfill, { once: true });
          this.socket.addEventListener('error', () => reject(new Error('DevTools connection failed.')), { once: true });
          this.socket.addEventListener('close', () => reject(new Error('DevTools closed before connecting.')), { once: true });
        }),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('DevTools connection timed out.')), 10_000); }),
      ]);
    } finally { clearTimeout(timer); }
  }
  command(method, params = {}, timeout = 20_000) {
    if (this.socket.readyState !== WebSocket.OPEN) return Promise.reject(new Error('DevTools is not connected.'));
    const id = ++this.sequence;
    return new Promise((fulfill, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`DevTools ${method} timed out.`)); }, timeout);
      this.pending.set(id, { fulfill, reject, timer, method });
      try { this.socket.send(JSON.stringify({ id, method, params })); }
      catch { clearTimeout(timer); this.pending.delete(id); reject(new Error('DevTools send failed.')); }
    });
  }
  async evaluate(expression) {
    const response = await this.command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (response.exceptionDetails) throw new Error(redact(response.exceptionDetails.exception?.description || response.exceptionDetails.text || 'Renderer evaluation failed.').slice(0, 1200));
    return response.result?.value;
  }
  dispose() { try { this.socket.close(); } catch {} }
}

// Names and creation times are used only to establish ownership. No command
// lines, unrelated window text, environment dumps or credential values.
const nativeProbeScript = String.raw`$ErrorActionPreference='Stop'
$rootPid=[uint32]$env:GIDEON_GUI_ROOT_PID
$file=$env:GIDEON_GUI_OWNERSHIP_FILE
$old=@()
if(Test-Path -LiteralPath $file){$old=@(Get-Content -LiteralPath $file -Raw | ConvertFrom-Json)}
$all=@(Get-CimInstance Win32_Process | Where-Object {$null -ne $_.CreationDate} | ForEach-Object {
  [pscustomobject]@{Pid=[uint32]$_.ProcessId; Parent=[uint32]$_.ParentProcessId; Name=$_.Name; Created=$_.CreationDate.ToUniversalTime().Ticks.ToString()}
})
$own=[System.Collections.Generic.HashSet[uint32]]::new()
foreach($p in $all){foreach($o in $old){if($p.Pid -eq $o.Pid -and $p.Created -eq $o.Created){[void]$own.Add($p.Pid)}}}
if($old.Count -eq 0){foreach($p in $all){if($p.Pid -eq $rootPid){[void]$own.Add($p.Pid)}}}
do {$changed=$false; foreach($p in $all){if($own.Contains($p.Parent) -and -not $own.Contains($p.Pid)){[void]$own.Add($p.Pid);$changed=$true}}} while($changed)
$processes=@($all | Where-Object {$own.Contains($_.Pid)})
$processes | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $file -Encoding utf8
if($env:GIDEON_GUI_PROBE_MODE -eq 'cleanup'){
  foreach($p in $processes){
$current=Get-CimInstance Win32_Process -Filter "ProcessId=$($p.Pid)" -ErrorAction SilentlyContinue
    if($null -ne $current -and $null -ne $current.CreationDate -and $current.CreationDate.ToUniversalTime().Ticks.ToString() -eq $p.Created){Stop-Process -Id $p.Pid -Force -ErrorAction SilentlyContinue}
  }
  [pscustomobject]@{OwnedProcessCount=$processes.Count} | ConvertTo-Json -Compress
  exit 0
}
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public class GideonGuiWindowProbe {
  public delegate bool Callback(IntPtr handle, IntPtr state);
  [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left,Top,Right,Bottom; }
  [DllImport("user32.dll")] public static extern bool EnumWindows(Callback callback,IntPtr state);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr handle,out uint pid);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr handle);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr handle);
  [DllImport("user32.dll",CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr handle,StringBuilder text,int count);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr handle,out Rect rect);
}
'@
$collectText=$false
if($env:GIDEON_GUI_PROBE_MODE -eq 'diagnose'){
  try{
    Add-Type -AssemblyName UIAutomationClient
    Add-Type -AssemblyName UIAutomationTypes
    $collectText=$true
  }catch{}
}
$windows=[System.Collections.Generic.List[object]]::new()
$callback=[GideonGuiWindowProbe+Callback]{param($handle,$state)
  [uint32]$windowPid=0
  [void][GideonGuiWindowProbe]::GetWindowThreadProcessId($handle,[ref]$windowPid)
  if(-not $own.Contains($windowPid)){return $true}
  $title=[System.Text.StringBuilder]::new(1024)
  [void][GideonGuiWindowProbe]::GetWindowText($handle,$title,$title.Capacity)
  $rect=[GideonGuiWindowProbe+Rect]::new()
  [void][GideonGuiWindowProbe]::GetWindowRect($handle,[ref]$rect)
  $texts=@()
  if($collectText -and [GideonGuiWindowProbe]::IsWindowVisible($handle)){
    try{
      $element=[System.Windows.Automation.AutomationElement]::FromHandle($handle)
      $condition=[System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::ControlTypeProperty,[System.Windows.Automation.ControlType]::Text)
      $found=$element.FindAll([System.Windows.Automation.TreeScope]::Descendants,$condition)
      for($i=0;$i -lt [Math]::Min(20,$found.Count);$i++){$texts += $found.Item($i).Current.Name.Substring(0,[Math]::Min(500,$found.Item($i).Current.Name.Length))}
    }catch{}
  }
  $windows.Add([pscustomobject]@{Pid=$windowPid;Title=$title.ToString();Visible=[GideonGuiWindowProbe]::IsWindowVisible($handle);Minimized=[GideonGuiWindowProbe]::IsIconic($handle);Width=$rect.Right-$rect.Left;Height=$rect.Bottom-$rect.Top;Text=$texts})
  return $true
}
[void][GideonGuiWindowProbe]::EnumWindows($callback,[IntPtr]::Zero)
[pscustomobject]@{Processes=$processes;Windows=$windows.ToArray()} | ConvertTo-Json -Depth 5 -Compress
`;

async function nativeProbe(mode = 'probe') {
  if (!child?.pid) return { Processes: [], Windows: [] };
  const helper = spawn('pwsh.exe', ['-NoProfile', '-NonInteractive', '-File', join(temporary, 'probe.ps1')], {
    windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, GIDEON_GUI_ROOT_PID: String(child.pid), GIDEON_GUI_OWNERSHIP_FILE: join(temporary, 'owned-processes.json'), GIDEON_GUI_PROBE_MODE: mode },
  });
  let output = '', errors = '';
  helper.stdout.on('data', data => { output = (output + data).slice(-128_000); });
  helper.stderr.on('data', data => { errors = redact((errors + data).slice(-1000)); });
  let timer, timedOut = false;
  try {
    const [code, signal] = await Promise.race([
      once(helper, 'close'),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          timedOut = true;
          try { helper.kill(); } catch {}
          helper.stdout.destroy(); helper.stderr.destroy();
          reject(new Error('Native helper deadline reached.'));
        }, 30_000);
      }),
    ]);
    if (code !== 0 || signal) throw new Error(`helper exit=${code ?? 'null'} signal=${signal ?? 'none'}`);
    return JSON.parse(output.replace(/^\uFEFF/, ''));
  } catch (error) {
    const diagnostic = errors || (timedOut ? '30s deadline reached' : error.code || error.message);
    throw new Error(`Owned Windows process/window probe failed: mode=${mode}; timedOut=${timedOut}; ${redact(diagnostic).slice(0, 1000)}`);
  } finally { clearTimeout(timer); }
}

async function devToolsJson(port, path) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, { redirect: 'error', signal: AbortSignal.timeout(1500) });
  if (!response.ok) throw new Error('DevTools HTTP endpoint is not ready.');
  return response.json();
}

async function run() {
  if (process.platform !== 'win32') throw new Error('This smoke test requires actual Windows Electron.');
  if (!executableArgument) throw new Error('Supply the actual portable or unpacked GIDEON executable path.');
  if (!Number.isInteger(startupTimeoutMs) || startupTimeoutMs < 10_000 || startupTimeoutMs > 300_000) throw new Error('Startup timeout must be between 10000 and 300000 ms.');
  if (legacy && process.env.GITHUB_ACTIONS !== 'true') throw new Error('Legacy profile smoke is allowed only on an isolated GitHub Actions Windows runner.');
  if (!process.env.APPDATA) throw new Error('Windows APPDATA is unavailable.');
  legacyDirectory = join(process.env.APPDATA, 'GIDEON');
  if (!await missing(legacyDirectory)) throw new Error('Existing APPDATA/GIDEON data is protected; smoke test refused.');
  mayRemoveLegacy = legacy;
  const executable = resolve(executableArgument);
  assert.ok((await lstat(executable)).isFile(), 'GIDEON executable is missing.');
  temporary = await mkdtemp(join(tmpdir(), 'gideon-native-gui-'));
  await writeFile(join(temporary, 'probe.ps1'), nativeProbeScript);
  const profile = legacy ? legacyDirectory : join(temporary, 'new-profile');
  const chromeLog = join(temporary, 'electron.log');
  const port = await availablePort();
  const inspectorPort = await availablePort();
  const env = { ...process.env, GEMINI_API_KEY: '', GOOGLE_API_KEY: '', GIDEON_DESKTOP_DATA_DIR: profile };
  delete env.ELECTRON_RUN_AS_NODE;
  if (legacy) delete env.GIDEON_DESKTOP_DATA_DIR;
  stage = 'launch and portable extraction';
  const started = Date.now();
  annotation('notice', `Launching actual ${legacy ? 'original legacy-profile' : 'isolated first-launch'} executable; startup budget ${startupTimeoutMs / 1000}s.`);
  child = spawn(executable, [`--inspect=127.0.0.1:${inspectorPort}`, `--remote-debugging-port=${port}`, '--remote-debugging-address=127.0.0.1', '--enable-logging', `--log-file=${chromeLog}`], {
    cwd: dirname(executable), env, windowsHide: false, stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', capture); child.stderr.on('data', capture);
  closed = new Promise(fulfill => {
    child.once('error', () => { exited = true; exitResult = { code: null, signal: null, spawnError: true }; fulfill(exitResult); });
    child.once('close', (code, signal) => { exited = true; exitResult = { code, signal }; fulfill(exitResult); });
  });
  let target;
  let nextNotice = started + 30_000;
  while (Date.now() - started < startupTimeoutMs) {
    try {
      const targets = await devToolsJson(port, '/json/list');
      target = targets.find(item => item.type === 'page' && /^file:/.test(item.url) && /[\\/]ui[\\/]index\.html(?:[?#]|$)/i.test(item.url));
      if (target?.webSocketDebuggerUrl) break;
    } catch {}
    if (exited && exitResult?.code !== 0) throw new Error('Actual GIDEON executable exited before showing its interface.');
    if (Date.now() >= nextNotice) {
      annotation('notice', `Waiting for real Electron renderer, elapsed ${Math.round((Date.now() - started) / 1000)}s; launcher exited=${exited}.`);
      nextNotice = Date.now() + 30_000;
    }
    await sleep(250);
  }
  assert.ok(target?.webSocketDebuggerUrl, 'Actual Electron setup renderer did not appear before startup deadline.');
  stage = 'sandbox preload and rendered first-launch interface';
  page = new DevTools(target.webSocketDebuggerUrl); await page.connect();
  await page.command('Runtime.enable');
  await page.command('Log.enable');
  let observed;
  const ipcDeadline = Date.now() + 30_000;
  while (Date.now() < ipcDeadline) {
    try {
      observed = await page.evaluate(`(async()=>({title:document.title,ready:document.readyState,visible:document.visibilityState,bridge:typeof window.gideon?.getStatus==='function',status:window.gideon?await window.gideon.getStatus():null,screen:document.querySelector('[data-screen].is-visible')?.dataset.screen,form:!!document.getElementById('setup-form')}))()`);
      if (observed.bridge && observed.screen === 'welcome' && observed.status?.phase === 'welcome') break;
    } catch {}
    await sleep(200);
  }
  assert.ok(observed?.bridge, 'Sandbox preload did not expose the real GIDEON IPC bridge.');
  assert.equal(observed.title, 'GIDEON');
  assert.equal(observed.screen, 'welcome', 'Actual first-launch renderer did not show the welcome screen.');
  assert.equal(observed.status.phase, 'welcome');
  assert.equal(observed.status.hasKey, false);
  assert.equal(observed.status.gatewayReady, false);
  assert.equal(observed.status.keyStorageAvailable, true, 'Actual Electron Windows secure storage is unavailable.');
  assert.equal(observed.form, true);
  const native = await nativeProbe();
  assert.ok((native.Windows || []).some(window => window.Visible && !window.Minimized && window.Width >= 600 && window.Height >= 400 && /GIDEON/i.test(window.Title)), 'GIDEON has no actual visible Windows setup window.');
  assert.ok(!(native.Processes || []).some(process => /^node\.exe$/i.test(process.Name)), 'GUI smoke unexpectedly started the backend engine.');
  annotation('notice', `Real visible first-launch window, welcome form and sandbox IPC verified in ${Math.round((Date.now() - started) / 1000)}s.`);

  stage = 'second actual executable launch and original window survival';
  secondChild = spawn(executable, [], { cwd: dirname(executable), env, windowsHide: false, stdio: ['ignore', 'pipe', 'pipe'] });
  secondChild.stdout.on('data', capture); secondChild.stderr.on('data', capture);
  const secondClosed = once(secondChild, 'close');
  const secondTimer = setTimeout(() => secondChild.kill(), startupTimeoutMs);
  let secondResult;
  try { secondResult = await secondClosed; } finally { clearTimeout(secondTimer); }
  assert.deepEqual(secondResult, [0, null], 'Second executable launch did not exit naturally through the single-instance lock.');
  assert.equal((await page.evaluate('window.gideon.getStatus()')).phase, 'welcome', 'Original Electron IPC stopped responding after the second launch.');
  assert.equal(await page.evaluate("document.querySelector('[data-screen].is-visible')?.dataset.screen"), 'welcome');
  assert.equal(exited, false, 'Original executable exited after the second launch.');

  stage = 'actual Electron main-process inspector';
  const mainTargets = await devToolsJson(inspectorPort, '/json/list');
  const mainTarget = mainTargets.find(target => target.webSocketDebuggerUrl);
  assert.ok(mainTarget, 'Actual Electron main-process inspector is unavailable.');
  mainInspector = new DevTools(mainTarget.webSocketDebuggerUrl); await mainInspector.connect();
  await mainInspector.command('Runtime.enable');
  const resourcesSurvived = await mainInspector.evaluate(`(()=>{const r=process.mainModule.require.bind(process.mainModule);const fs=r('node:fs');const p=r('node:path');return fs.existsSync(p.join(process.resourcesPath,'runtime','scripts','gideon.mjs'))&&fs.existsSync(p.join(process.resourcesPath,'node','node.exe'));})()`);
  assert.equal(resourcesSurvived, true, 'Second portable launch removed the original executable runtime resources.');

  stage = 'real Electron Windows encrypted key storage';
  fakeKey = `gideon-native-smoke-${randomBytes(20).toString('hex')}`;
  const saved = await page.evaluate(`window.gideon.saveKey(${JSON.stringify(fakeKey)})`);
  assert.equal(saved.phase, 'welcome', 'Real Windows secure key save failed.');
  assert.equal(saved.hasKey, true); assert.equal(saved.gatewayReady, false);
  const credentials = join(profile, 'credentials.bin');
  const encrypted = await readFile(credentials);
  assert.ok(encrypted.length > 0);
  assert.equal(encrypted.includes(Buffer.from(fakeKey)), false, 'Credential file contains plaintext.');
  const decryptedMatches = await mainInspector.evaluate(`(()=>{const r=process.mainModule.require.bind(process.mainModule);return r('electron').safeStorage.decryptString(r('node:fs').readFileSync(${JSON.stringify(credentials)}))===${JSON.stringify(fakeKey)};})()`);
  assert.equal(decryptedMatches, true, 'Actual Electron Windows DPAPI decryption did not match the synthetic saved key.');
  assert.equal((await page.evaluate('window.gideon.getStatus()')).hasKey, true);
  const forgotten = await page.evaluate('window.gideon.forgetKey()');
  assert.equal(forgotten.hasKey, false); assert.equal(forgotten.gatewayReady, false);
  assert.ok(await missing(credentials), 'Saved credential was not removed.');
  assert.ok(await missing(join(profile, 'state', 'openclaw.json')), 'GUI smoke unexpectedly prepared the engine.');
  assert.ok(await missing(join(profile, 'state', 'launcher-runtime.json')), 'GUI smoke unexpectedly started an engine.');

  // Node can wait for its inspector to disconnect before exiting. Disconnect
  // only the test debugger before measuring the application's natural exit.
  const inspectorClosed = mainInspector.socket.readyState === WebSocket.CLOSED
    ? Promise.resolve() : new Promise(fulfill => mainInspector.socket.addEventListener('close', fulfill, { once: true }));
  mainInspector.dispose();
  await Promise.race([inspectorClosed, sleep(2000)]);
  mainInspector = undefined;

  stage = 'natural Electron and portable launcher shutdown';
  try { await page.evaluate('window.close()'); } catch {}
  const closeDeadline = Date.now() + 30_000;
  while (!exited && Date.now() < closeDeadline) await sleep(100);
  if (!exited) {
    const version = await devToolsJson(port, '/json/version');
    browser = new DevTools(version.webSocketDebuggerUrl); await browser.connect();
    try { await browser.command('Browser.close', {}, 5000); } catch {}
    while (!exited && Date.now() < closeDeadline + 10_000) await sleep(100);
  }
  assert.equal(exited, true, 'Electron or portable launcher did not exit naturally.');
  assert.equal(exitResult.spawnError, undefined);
  assert.equal(exitResult.signal, null, 'Actual GUI was forcibly terminated.');
  assert.equal(exitResult.code, 0, 'Actual GUI exited unsuccessfully.');
  await assert.rejects(devToolsJson(port, '/json/version'), 'DevTools listener survived GUI shutdown.');
  assert.equal(rendererFailures.length, 0, 'Actual renderer reported an exception or load error.');
  annotation('notice', `PASS: actual visible Windows Electron GUI, sandbox preload IPC, second launch with original runtime survival, native DPAPI encryption/decryption/forget and natural executable shutdown; elapsed ${Math.round((Date.now() - started) / 1000)}s. No engine or Gemini request was started.`);
}

let failed = false;
try { await run(); }
catch (error) {
  failed = true;
  annotation('error', `Stage=${stage}: ${error.message}`);
  for (const failure of rendererFailures) annotation('error', `Renderer: ${failure}`);
  if (temporary) {
    try {
      const native = await nativeProbe('diagnose');
      annotation('notice', `Owned executable windows: ${JSON.stringify(native.Windows || [])}`);
    } catch { annotation('notice', 'Owned Windows UI/process diagnostic was unavailable.'); }
    try { capture((await readFile(join(temporary, 'electron.log'), 'utf8')).slice(-12_000)); } catch {}
  }
  if (tail) annotation('notice', `Redacted own-process log tail: ${tail.slice(-4000)}`);
} finally {
  page?.dispose(); browser?.dispose(); mainInspector?.dispose();
  if (secondChild && secondChild.exitCode === null && secondChild.signalCode === null) try { secondChild.kill(); } catch {}
  if (temporary && child?.pid && (!exited || failed)) {
    try { await nativeProbe('cleanup'); } catch { if (!exited) try { child.kill(); } catch {} }
    if (closed && !exited) await Promise.race([closed, sleep(5000)]);
  }
  if (mayRemoveLegacy && legacyDirectory) {
    try { await rm(legacyDirectory, { recursive: true, force: true, maxRetries: 3, retryDelay: 500 }); }
    catch { annotation('notice', 'Newly created legacy CI test profile could not be fully removed.'); }
  }
  if (temporary) {
    try { await rm(temporary, { recursive: true, force: true, maxRetries: 3, retryDelay: 500 }); }
    catch { annotation('notice', 'Temporary GUI smoke files could not be fully removed.'); }
  }
}
if (failed) process.exitCode = 1;

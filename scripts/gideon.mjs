import { spawn } from 'node:child_process';
import { readFile, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT, VERSION, statePath, openclawEnv, setupProfile, assertProfileState, bindDesktopRuntime } from '../lib/profile.mjs';
import { createBackup, restoreBackup } from '../lib/backup.mjs';
import { acquireRuntime, assertStopped } from '../lib/runtime.mjs';
import { chooseDesktopPort } from '../lib/desktop-port.mjs';
import '../lib/windows-runtime-preload.cjs';

const cli = join(ROOT, 'node_modules', 'openclaw', 'openclaw.mjs');
const state = statePath();

export async function runOpenClaw(args, { stateDir = state, env = process.env, capture = false } = {}) {
  await assertProfileState(stateDir);
  await mkdir(join(stateDir, 'cache'), { recursive: true, mode: 0o700 });
  return new Promise((accept, reject) => {
    const preload = process.platform === 'win32' ? ['--require', join(ROOT, 'lib', 'windows-runtime-preload.cjs')] : [];
    const child = spawn(process.execPath, [...preload, cli, ...args], {
      cwd: ROOT, env: openclawEnv(stateDir, env), stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit', windowsHide: true,
    });
    let stdout = '', stderr = '';
    if (capture) {
      child.stdout.on('data', d => { stdout += d; });
      child.stderr.on('data', d => { stderr += d; });
    }
    let forceTimer;
    const terminate = () => child.kill('SIGTERM');
    const interrupt = () => {
      if (process.platform === 'win32' && !capture && process.stdin.isTTY) {
        // The inherited Windows console sends Ctrl+C to the child as well.
        forceTimer = setTimeout(() => child.kill(), 30_000); forceTimer.unref();
      } else terminate();
    };
    process.once('SIGINT', interrupt); process.once('SIGTERM', terminate);
    child.on('error', reject);
    child.on('close', (code, signal) => {
      clearTimeout(forceTimer);
      process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', terminate);
      accept({ code: code ?? (signal ? 130 : 1), stdout, stderr });
    });
  });
}

export function hiddenInput(label) {
  if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== 'function') {
    throw new Error('Gizli giriş için etkileşimli terminal gerekli. Gemini için güvenli GEMINI_API_KEY değişkenini kullanın.');
  }
  return new Promise((accept, reject) => {
    let value = '';
    const previous = process.stdin.isRaw;
    process.stdout.write(label);
    process.stdin.setRawMode(true); process.stdin.resume(); process.stdin.setEncoding('utf8');
    const finish = () => { process.stdin.off('data', collect); process.stdin.setRawMode(previous); process.stdin.pause(); process.stdout.write('\n'); };
    function collect(chunk) {
      for (const char of chunk) {
        if (char === '\u0003') { finish(); reject(new Error('İşlem iptal edildi.')); return; }
        if (char === '\r' || char === '\n') { finish(); accept(value); return; }
        if (char === '\u007f' || char === '\b') value = value.slice(0, -1);
        else if (char >= ' ' && value.length < 8192) value += char;
      }
    }
    process.stdin.on('data', collect);
  });
}

async function config() {
  await assertProfileState(state);
  try { return JSON.parse(await readFile(join(state, 'openclaw.json'), 'utf8')); }
  catch (e) { if (e.code === 'ENOENT') throw new Error('Önce npm run setup çalıştırın.'); throw e; }
}

async function validate() {
  const result = await runOpenClaw(['config', 'validate'], { capture: true });
  if (result.code !== 0) throw new Error('OpenClaw yapılandırma doğrulaması başarısız. npm run openclaw -- config validate ile kontrol edin.');
}

function openDashboard(c) {
  const url = `http://127.0.0.1:${c.gateway.port}/#token=${encodeURIComponent(c.gateway.auth.token)}`;
  const [command, args] = process.platform === 'win32' ? ['rundll32.exe', ['url.dll,FileProtocolHandler', url]]
    : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  const child = spawn(command, args, { stdio: 'ignore', detached: true, windowsHide: true });
  child.on('error', () => console.error('Tarayıcı açılamadı. Kendi bilgisayarınızdaki OpenClaw panelini açın; erişim token’ı özel yapılandırmanızdadır.'));
  child.unref();
}

async function openWhenReady(c, signal) {
  for (let attempt = 0; attempt < 120 && !signal.aborted; attempt++) {
    try {
      const response = await fetch(`http://127.0.0.1:${c.gateway.port}/healthz`, { signal: AbortSignal.any([signal, AbortSignal.timeout(1000)]) });
      if (response.ok) {
        const health = await runOpenClaw(['health', '--json'], { capture: true });
        if (health.code === 0 && !signal.aborted) { openDashboard(c); return; }
      }
    } catch {}
    await new Promise(r => setTimeout(r, 500));
  }
}

async function doctor() {
  await config();
  const checks = [];
  checks.push(['Node', Number(process.versions.node.split('.')[0]) === 24 && Number(process.versions.node.split('.')[1]) >= 16 || Number(process.versions.node.split('.')[0]) >= 26]);
  const version = await runOpenClaw(['--version'], { capture: true });
  checks.push(['OpenClaw sürümü', version.code === 0 && version.stdout.includes(VERSION)]);
  const validation = await runOpenClaw(['config', 'validate'], { capture: true });
  checks.push(['Yapılandırma', validation.code === 0]);
  const health = await runOpenClaw(['health', '--json'], { capture: true });
  checks.push(['Gateway bağlantısı', health.code === 0]);
  const memory = await runOpenClaw(['memory', 'status', '--agent', 'main', '--json'], { capture: true });
  checks.push(['Yerel hafıza', memory.code === 0]);
  for (const [name, okay] of checks) console.log(`${okay ? 'BAŞARILI' : 'BAŞARISIZ'} — ${name}`);
  const key = Boolean(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY);
  console.log(`${key ? 'MEVCUT' : 'EKSİK'} — Gemini ortam anahtarı (değer gösterilmez)`);
  console.log('TEST EDİLMEDİ — Gemini canlı yanıtı ve mikrofon (bu denetim ücretli API isteği yapmaz).');
  if (checks.some(([, okay]) => !okay)) process.exitCode = 1;
}

async function main() {
  const [command = 'help', ...args] = process.argv.slice(2);
  if (command === 'setup' || command === 'setup-desktop') {
    const requestedPort = Number(process.env.GIDEON_PORT || 18799);
    const result = await setupProfile(state, {
      port: command === 'setup-desktop' ? await chooseDesktopPort(state, requestedPort) : requestedPort,
      model: process.env.GIDEON_MODEL || 'google/gemini-3.1-pro-preview',
    });
    if (command === 'setup-desktop') await bindDesktopRuntime(state);
    await validate();
    console.log(result.created ? 'GIDEON profili oluşturuldu; mevcut OpenClaw kurulumuna dokunulmadı.' : 'GIDEON profili korundu; mevcut bilgiler üzerine yazılmadı.');
    console.log('Sonraki adım: npm start. Ayrı bir terminalde npm run dashboard paneli açar.');
  } else if (command === 'start') {
    const c = await config(); await validate();
    const env = { ...process.env };
    if (!env.GEMINI_API_KEY && !env.GOOGLE_API_KEY) {
      if (process.stdin.isTTY) {
        const key = await hiddenInput('Gemini API anahtarı (gizli; Enter ile atla): ');
        if (key) env.GEMINI_API_KEY = key;
      }
      if (!env.GEMINI_API_KEY) console.log('Gemini anahtarı eksik: panel açılabilir, metin ve canlı ses yanıtı kullanılamaz.');
    }
    console.log('GIDEON başlatılıyor. Kapatmak için Ctrl+C. Panel açılmazsa ayrı terminalde npm run dashboard.');
    const release = await acquireRuntime(state);
    const controller = new AbortController();
    try {
      if (process.stdin.isTTY && process.env.GIDEON_NO_OPEN !== '1') void openWhenReady(c, controller.signal);
      const result = await runOpenClaw(['gateway', 'run', '--bind', 'loopback', '--port', String(c.gateway.port)], { env });
      process.exitCode = result.code;
    } finally { controller.abort(); await release(); }
  } else if (command === 'dashboard') {
    const c = await config();
    const result = await runOpenClaw(['health', '--json'], { capture: true });
    if (result.code !== 0) throw new Error('Gateway çalışmıyor. Önce başka bir terminalde npm start çalıştırın.');
    openDashboard(c); console.log('GIDEON paneli varsayılan tarayıcıda açılıyor.');
  } else if (command === 'doctor') await doctor();
  else if (command === 'openclaw') {
    await config(); const result = await runOpenClaw(args); process.exitCode = result.code;
  } else if (command === 'backup') {
    const c = await config();
    await assertStopped(state, c.gateway.port);
    const password = await hiddenInput('Yedek parolası (en az 8 karakter; gizli): ');
    if (password !== await hiddenInput('Parolayı tekrar girin: ')) throw new Error('Parolalar eşleşmiyor.');
    const destination = resolve(args[0] || join(ROOT, '.gideon-backups', `${new Date().toISOString().replaceAll(':', '-')}.gideon`));
    await mkdir(resolve(destination, '..'), { recursive: true, mode: 0o700 });
    const result = await createBackup({ stateDir: state, destination, password });
    console.log(`Şifreli yedek oluşturuldu: ${result.fileCount} dosya. Parolayı kaybederseniz yedek açılamaz.`);
  } else if (command === 'restore') {
    if (args.length !== 2) throw new Error('Kullanım: npm run restore -- YEDEK_DOSYASI BOŞ_HEDEF_KLASÖR');
    const destination = resolve(args[1]);
    if (destination === state) throw new Error('Önce ayrı, boş bir klasöre geri yükleyin; mevcut GIDEON üzerine yazılmaz.');
    const password = await hiddenInput('Yedek parolası (gizli): ');
    const result = await restoreBackup({ archivePath: resolve(args[0]), destination, password });
    console.log(`Yedek ${result.fileCount} dosya ile ayrı klasöre doğrulanarak geri yüklendi.`);
    console.log('Bu bir kurtarma testidir. Farklı dizinde kullanım için yapılandırmadaki mutlak yolları kontrol edin.');
  } else console.log('GIDEON: npm run setup → npm start → npm run dashboard. Denetim: npm run doctor. Yedek: npm run backup.');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(e => { console.error(`GIDEON: ${e.message}`); process.exitCode = 1; });
}

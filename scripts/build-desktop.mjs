#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { createReadStream, existsSync } from 'node:fs';
import { cp, mkdir, open, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const build = join(root, '.desktop-build');
const downloads = join(build, 'downloads');
const runtime = join(build, 'runtime');
const nodeVersion = '24.19.0';
const nodeArchive = `node-v${nodeVersion}-win-x64.zip`;
const nodeBase = `https://nodejs.org/dist/v${nodeVersion}/`;
const electronVersion = '44.7.1';
const electronArchive = `electron-v${electronVersion}-win32-x64.zip`;
const electronBase = `https://github.com/electron/electron/releases/download/v${electronVersion}/`;
const npmCache = process.env.GIDEON_NPM_CACHE || join(dirname(root), '.npm-cache');
const builderCache = join(build, 'builder-cache');
const electronCache = join(build, 'electron-cache');
const prepareOnly = process.argv.includes('--prepare-only');
const packageOnly = process.argv.includes('--package-only');
const verifyOnly = process.argv.includes('--verify-only');
const withInstaller = process.argv.includes('--installer');
if (withInstaller && process.platform !== 'win32') throw new Error('The optional NSIS installer must be built on Windows; Linux delivery uses the portable executable');

async function run(command, args, cwd = root, env = {}) {
  console.log(`> ${command} ${args.join(' ')}`);
  await new Promise((fulfill, reject) => {
    const child = spawn(command, args, { cwd, stdio: 'inherit', env: { ...process.env, ...env }, windowsHide: true });
    child.once('error', reject);
    child.once('exit', (code, signal) => code === 0 ? fulfill() : reject(new Error(`${command} exited ${code ?? signal}`)));
  });
}

async function runNpm(args, cwd) {
  if (process.platform !== 'win32') return run('npm', args, cwd);
  const npmCli = [process.env.npm_execpath, join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')]
    .find(value => value && value.endsWith('npm-cli.js') && existsSync(value));
  if (!npmCli) throw new Error('A Node installation with npm is required to build the Windows artifact');
  // .cmd launchers require a command shell on Windows; directly own the npm CLI.
  return run(process.execPath, [npmCli, ...args], cwd);
}

async function hash(path) {
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(path)) digest.update(chunk);
  return digest.digest('hex');
}

async function download(url, path) {
  const temporary = `${path}.partial`;
  // curl honors the cloud HTTPS proxy and preserves TLS certificate checks.
  await run(process.platform === 'win32' ? 'curl.exe' : 'curl', ['--fail', '--location', '--show-error', '--silent', '--max-time', '180', '--output', temporary, url]);
  await rename(temporary, path);
}

async function prepareNode() {
  await mkdir(downloads, { recursive: true });
  // The authoritative release manifest is always refreshed through verified TLS.
  const sumsPath = join(downloads, 'SHASUMS256.txt');
  await download(`${nodeBase}SHASUMS256.txt`, sumsPath);
  const sums = await readFile(sumsPath, 'utf8');
  const line = sums.split('\n').find(value => value.endsWith(`  ${nodeArchive}`));
  if (!line || !/^[a-f0-9]{64}  /.test(line)) throw new Error('Node Windows archive missing from official SHA256 manifest');
  const expected = line.slice(0, 64);
  const archive = join(downloads, nodeArchive);
  if (!existsSync(archive) || await hash(archive) !== expected) await download(`${nodeBase}${nodeArchive}`, archive);
  if (await hash(archive) !== expected) throw new Error('Node archive SHA256 mismatch; refusing to use downloaded runtime');
  const unpack = join(build, 'node-unpack');
  await rm(unpack, { recursive: true, force: true });
  await mkdir(unpack, { recursive: true });
  if (process.platform === 'win32') {
    await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Expand-Archive -LiteralPath $env:GIDEON_BUILD_ARCHIVE -DestinationPath $env:GIDEON_BUILD_UNPACK'], root, { GIDEON_BUILD_ARCHIVE: archive, GIDEON_BUILD_UNPACK: unpack });
  } else {
    await run('unzip', ['-q', archive, '-d', unpack]);
  }
  const source = join(unpack, `node-v${nodeVersion}-win-x64`);
  const target = join(build, 'node');
  await mkdir(target, { recursive: true });
  await cp(join(source, 'node.exe'), join(target, 'node.exe'));
  await cp(join(source, 'LICENSE'), join(target, 'LICENSE'));
  await writeFile(join(target, 'SHA256SUMS.txt'), `${await hash(join(target, 'node.exe'))}  node.exe\n${expected}  ${nodeArchive}\n`);
  await rm(unpack, { recursive: true, force: true });
  return expected;
}

async function prepareElectron() {
  const sumsPath = join(downloads, 'ELECTRON-SHASUMS256.txt');
  await download(`${electronBase}SHASUMS256.txt`, sumsPath);
  const line = (await readFile(sumsPath, 'utf8')).split('\n').find(value => value.endsWith(` *${electronArchive}`) || value.endsWith(`  ${electronArchive}`));
  if (!line || !/^[a-f0-9]{64} /.test(line)) throw new Error('Electron Windows archive missing from official SHA256 manifest');
  const expected = line.slice(0, 64);
  const archive = join(downloads, electronArchive);
  if (!existsSync(archive) || await hash(archive) !== expected) await download(`${electronBase}${electronArchive}`, archive);
  if (await hash(archive) !== expected) throw new Error('Electron archive SHA256 mismatch; refusing to package downloaded framework');
  return expected;
}

async function prepareRuntime() {
  await mkdir(runtime, { recursive: true });
  for (const name of ['package.json', 'package-lock.json', 'README.md']) await cp(join(root, name), join(runtime, name));
  const sourceLockHash = await hash(join(root, 'package-lock.json'));
  const stampPath = join(runtime, '.gideon-install-stamp');
  const stamp = `win32-x64-ignore-scripts-v1:${sourceLockHash}`;
  const previous = existsSync(stampPath) ? await readFile(stampPath, 'utf8') : null;
  if (previous !== stamp || !existsSync(join(runtime, 'node_modules', 'openclaw', 'openclaw.mjs'))) {
    await runNpm(['ci', '--os=win32', '--cpu=x64', '--ignore-scripts', '--include=optional', '--no-audit', '--no-fund', '--cache', npmCache], runtime);
    // The published postinstall performs local dist pruning and a host-native probe.
    // Only pruning and the lifecycle marker completion apply when cross-packaging.
    const lifecycle = await import(pathToFileURL(join(runtime, 'node_modules', 'openclaw', 'scripts', 'postinstall-bundled-plugins.mjs')).href);
    const packageRoot = join(runtime, 'node_modules', 'openclaw');
    lifecycle.pruneInstalledPackageDist({ packageRoot });
    if (!lifecycle.completePackageLifecycle({ packageRoot })) throw new Error('OpenClaw lifecycle marker could not be completed');
    await writeFile(stampPath, stamp);
  }
  for (const name of ['lib', 'scripts', 'templates', 'extensions', 'docs']) {
    await rm(join(runtime, name), { recursive: true, force: true });
    await cp(join(root, name), join(runtime, name), { recursive: true, filter: source => !source.startsWith(join(root, 'scripts', 'build-desktop')) && !source.startsWith(join(root, 'scripts', 'release-desktop')) });
  }
  const required = [
    'openclaw/dist/control-ui/index.html',
    'openclaw/dist/extensions/google',
    '@esbuild/win32-x64/esbuild.exe',
    '@koromix/koffi-win32-x64',
    '@openclaw/fs-safe-win32-x64-msvc',
    '@lydell/node-pty-win32-x64',
    '@trycua/cua-driver-win32-x64-msvc',
    '@ubjs/node-win32-x64-msvc',
    'sqlite-vec-windows-x64',
  ];
  for (const name of required) {
    if (!existsSync(join(runtime, 'node_modules', name))) throw new Error(`Windows runtime dependency missing: ${name}`);
  }
  // pi-tui publishes multiple platforms in one tarball; retain only Windows.
  for (const platform of ['darwin', 'linux']) {
    await rm(join(runtime, 'node_modules', '@earendil-works', 'pi-tui', 'native', platform), { recursive: true, force: true });
  }
  // Never ship host-native Linux or Darwin packages by mistake.
  const lock = JSON.parse(await readFile(join(runtime, 'package-lock.json'), 'utf8'));
  for (const [location, entry] of Object.entries(lock.packages || {})) {
    if (!location || !existsSync(join(runtime, location))) continue;
    if (entry.os && !entry.os.includes('win32') && !entry.os.includes('!linux') && !entry.os.includes('!darwin')) {
      throw new Error(`Unexpected non-Windows dependency in release: ${location}`);
    }
  }
  async function verifyNativeDirectory(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await verifyNativeDirectory(path);
      else if (entry.isFile() && /\.(node|exe|dll)$/i.test(entry.name)) {
        const descriptor = await open(path, 'r');
        const header = Buffer.alloc(2);
        try { await descriptor.read(header, 0, 2, 0); } finally { await descriptor.close(); }
        if (header.toString('ascii') !== 'MZ') throw new Error(`Non-Windows native binary in release: ${path}`);
      }
    }
  }
  await verifyNativeDirectory(join(runtime, 'node_modules'));
  return sourceLockHash;
}

async function installBuildTools() {
  const desktop = join(root, 'desktop');
  if (!existsSync(join(desktop, 'package-lock.json'))) {
    await runNpm(['install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund', '--cache', npmCache], desktop);
  }
  if (!existsSync(join(desktop, 'node_modules', 'electron-builder', 'cli.js'))) {
    await runNpm(['ci', '--ignore-scripts', '--no-audit', '--no-fund', '--cache', npmCache], desktop);
  }
}

async function verifyPackageSources() {
  const desktop = join(root, 'desktop');
  const require = createRequire(join(desktop, 'package.json'));
  const asar = require('@electron/asar');
  const resources = join(root, 'dist', 'desktop', 'win-unpacked', 'resources');
  const appArchive = join(resources, 'app.asar');
  const files = {};
  const digest = value => createHash('sha256').update(value).digest('hex');
  async function regularFiles(directory, prefix = '') {
    const result = [];
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const name = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) result.push(...await regularFiles(join(directory, entry.name), name));
      else if (entry.isFile()) result.push(name);
    }
    return result;
  }
  const gui = ['main.cjs', 'controller.cjs', 'preload.cjs'];
  for (const directory of ['ui', 'assets']) {
    gui.push(...(await regularFiles(join(desktop, directory))).map(name => `${directory}/${name}`));
  }
  for (const name of gui) {
    const expected = digest(await readFile(join(desktop, name)));
    const actual = digest(asar.extractFile(appArchive, name));
    if (actual !== expected) throw new Error(`Packaged desktop source is stale: ${name}; repeat packaging after source changes finish`);
    files[`app.asar/${name}`] = actual;
  }
  for (const directory of ['lib', 'scripts', 'templates', 'extensions']) {
    for (const name of await regularFiles(join(root, directory))) {
      if (directory === 'scripts' && /^(build-desktop|release-desktop)/.test(name)) continue;
      const source = join(root, directory, name);
      const packaged = join(resources, 'runtime', directory, name);
      if (await hash(source) !== await hash(packaged)) throw new Error(`Packaged runtime source is stale: ${directory}/${name}; repeat the full build to refresh runtime`);
      files[`runtime/${directory}/${name}`] = await hash(packaged);
    }
  }
  const manifest = JSON.parse(await readFile(join(resources, 'runtime-manifest.json'), 'utf8'));
  if (await hash(join(resources, 'node', 'node.exe')) !== manifest.node.executableSha256) throw new Error('Packaged Node executable does not match verified runtime');
  const dependencies = join(runtime, 'node_modules');
  const packagedDependencies = join(resources, 'runtime', 'node_modules');
  if (!existsSync(join(packagedDependencies, 'openclaw', 'openclaw.mjs'))) throw new Error('Packaged OpenClaw runtime dependencies are missing');
  const dependencyFiles = (await regularFiles(dependencies)).filter(name => !name.startsWith('.bin/') && !name.includes('/.cache/') && !name.endsWith('.log'));
  for (let index = 0; index < dependencyFiles.length; index += 24) {
    await Promise.all(dependencyFiles.slice(index, index + 24).map(async name => {
      // electron-builder omits empty Git directory markers from resource trees.
      // They contain no runtime code/data; all nonempty dependency files remain mandatory.
      if (name.endsWith('/.gitkeep') && (await stat(join(dependencies, name))).size === 0) return;
      const expected = await hash(join(dependencies, name));
      const actual = await hash(join(packagedDependencies, name));
      if (actual !== expected) throw new Error(`Packaged dependency does not match verified staged source: ${name}`);
      files[`runtime/node_modules/${name}`] = actual;
    }));
  }
  console.log(`Verified ${dependencyFiles.length} bundled dependency files against frozen installed runtime`);
  return files;
}

await mkdir(build, { recursive: true });
if (!packageOnly && !verifyOnly) {
  const archiveSha256 = await prepareNode();
  const electronSha256 = await prepareElectron();
  const lockSha256 = await prepareRuntime();
  const manifest = {
    format: 1,
    platform: 'win32',
    architecture: 'x64',
    node: { version: nodeVersion, source: `${nodeBase}${nodeArchive}`, archiveSha256, executableSha256: await hash(join(build, 'node', 'node.exe')) },
    electron: { version: electronVersion, source: `${electronBase}${electronArchive}`, archiveSha256: electronSha256 },
    openclaw: { version: '2026.10.3', packageLockSha256: lockSha256 },
    verification: 'Official Node/Electron SHA256 release manifests and npm package-lock integrity; TLS verification enabled',
  };
  await writeFile(join(build, 'runtime-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  await installBuildTools();
}
if (!prepareOnly) {
  const desktop = join(root, 'desktop');
  for (const name of ['main.cjs', 'preload.cjs', 'controller.cjs', 'ui/index.html']) if (!existsSync(join(desktop, name))) throw new Error(`Desktop source missing: ${name}`);
  const electronZip = join(downloads, electronArchive);
  const manifest = JSON.parse(await readFile(join(build, 'runtime-manifest.json'), 'utf8'));
  if (!existsSync(electronZip) || await hash(electronZip) !== manifest.electron?.archiveSha256) throw new Error('Verified Windows Electron archive not prepared');
  if (!verifyOnly) {
    await run(process.execPath, [join(desktop, 'node_modules', 'electron-builder', 'cli.js'), '--config', 'electron-builder.yml', `--config.electronDist=${electronZip}`, '--win', 'portable', ...(withInstaller ? ['nsis'] : []), '--x64', '--publish', 'never'], desktop, {
      ELECTRON_BUILDER_CACHE: builderCache,
      ELECTRON_CACHE: electronCache,
      ELECTRON_BUILDER_COMPRESSION_LEVEL: '7',
      CSC_IDENTITY_AUTO_DISCOVERY: 'false',
    });
  }
  const packagedFiles = await verifyPackageSources();
  const version = JSON.parse(await readFile(join(desktop, 'package.json'), 'utf8')).version;
  const output = join(root, 'dist', 'desktop');
  const artifacts = [`GIDEON-${version}-Windows.exe`, ...(withInstaller ? [`GIDEON-${version}-Kurulum.exe`] : [])];
  const sums = [];
  for (const name of artifacts) {
    const path = join(output, name);
    const info = await stat(path);
    if (info.size < 1024 * 1024) throw new Error(`Desktop artifact unexpectedly small: ${name}`);
    const checksum = await hash(path);
    sums.push(`${checksum}  ${name}`);
    console.log(`Release ready: ${name} (${(info.size / 1024 / 1024).toFixed(1)} MiB, SHA256 ${checksum})`);
  }
  await writeFile(join(output, 'SHA256SUMS.txt'), `${sums.join('\n')}\n`);
  await writeFile(join(output, 'PACKAGED-SOURCES.json'), `${JSON.stringify({ format: 1, version, files: packagedFiles }, null, 2)}\n`);
}

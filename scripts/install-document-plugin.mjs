#!/usr/bin/env node
import { createHash, randomBytes } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const files = ['index.js', 'documents.js', 'package.json', 'openclaw.plugin.json', 'assets/DejaVuSans.ttf', 'assets/FONT-LICENSE.txt', 'assets/FONT-SOURCE.json'];
const markerName = '.gideon-bundled-source.json';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

async function assertNormalParents(target) {
  for (let current = target; ; current = dirname(current)) {
    try { if ((await lstat(current)).isSymbolicLink()) throw new Error('Bundled document plugin paths cannot contain symbolic links'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (dirname(current) === current) return;
  }
}
async function readNormalFile(path) {
  await assertNormalParents(path);
  const info = await lstat(path);
  if (!info.isFile() || info.nlink !== 1) throw new Error('Bundled document plugin requires independent regular files');
  return readFile(path);
}
async function assertOwnedTree(target) {
  const marker = JSON.parse(await readNormalFile(join(target, markerName)));
  const metadata = JSON.parse(await readNormalFile(join(target, 'package.json')));
  if (marker.product !== 'GIDEON' || marker.pluginId !== 'gideon-documents' || metadata.name !== '@gideon/openclaw-documents') throw new Error('An existing foreign document plugin directory was preserved');
  const allowed = new Set([...files, markerName]);
  async function visit(directory, prefix = '') {
    for (const name of await readdir(directory)) {
      const relative = prefix ? `${prefix}/${name}` : name;
      const path = join(directory, name); const info = await lstat(path);
      if (info.isSymbolicLink() || (info.isFile() && info.nlink !== 1)) throw new Error('An existing linked document plugin path was preserved');
      if (info.isDirectory() && relative === 'assets') await visit(path, relative);
      else if (!info.isFile() || !allowed.has(relative)) throw new Error('An unexpected document plugin file was preserved');
    }
  }
  await visit(target);
}

/** Package GIDEON's reviewed document tool as part of its own OpenClaw distribution.
 * The host grants declared bundled tools local-media custody. No core code or
 * third-party plugin provenance is changed and no private-network exception is used.
 */
export async function installDocumentPlugin(runtimeRoot = repository) {
  const root = resolve(runtimeRoot);
  const source = join(root, 'extensions', 'gideon-documents');
  const packageRoot = join(root, 'node_modules', 'openclaw');
  const host = JSON.parse(await readNormalFile(join(packageRoot, 'package.json')));
  if (host.name !== 'openclaw' || host.version !== '2026.10.3') throw new Error('Document plugin requires the pinned OpenClaw 2026.10.3 distribution');
  const target = join(packageRoot, 'dist', 'extensions', 'gideon-documents');
  await assertNormalParents(target);
  const entries = [];
  for (const name of files) {
    const bytes = await readNormalFile(join(source, name));
    entries.push({ name, bytes, sha256: digest(bytes) });
  }
  const metadata = JSON.parse(entries.find(entry => entry.name === 'package.json').bytes);
  const manifest = JSON.parse(entries.find(entry => entry.name === 'openclaw.plugin.json').bytes);
  if (metadata.name !== '@gideon/openclaw-documents' || manifest.id !== 'gideon-documents' || JSON.stringify(manifest.contracts?.tools) !== '["gideon_document"]') throw new Error('Document plugin ownership and declared tool contract must match');
  const marker = `${JSON.stringify({ product: 'GIDEON', pluginId: manifest.id, distribution: 'GIDEON-owned bundled extension; not an upstream OpenClaw plugin', openclawVersion: host.version, files: entries.map(({ name, sha256 }) => ({ path: name, sha256 })) }, null, 2)}\n`;
  let existing = false;
  try {
    const info = await lstat(target);
    if (!info.isDirectory()) throw new Error('An existing foreign document plugin path was preserved');
    await assertOwnedTree(target); existing = true;
    if (await readFile(join(target, markerName), 'utf8') === marker && (await Promise.all(entries.map(async entry => digest(await readNormalFile(join(target, entry.name))) === entry.sha256))).every(Boolean)) return target;
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const suffix = randomBytes(8).toString('hex');
  const temporary = `${target}.gideon-staging-${suffix}`;
  const previous = `${target}.gideon-previous-${suffix}`;
  await mkdir(join(temporary, 'assets'), { recursive: true });
  let moved = false;
  try {
    for (const entry of entries) await writeFile(join(temporary, entry.name), entry.bytes, { flag: 'wx', mode: 0o644 });
    await writeFile(join(temporary, markerName), marker, { flag: 'wx', mode: 0o644 });
    if (existing) { await rename(target, previous); moved = true; }
    try { await rename(temporary, target); } catch (error) { if (moved) { await rename(previous, target); moved = false; } throw error; }
    if (moved) await rm(previous, { recursive: true });
  } finally { await rm(temporary, { recursive: true, force: true }); }
  return target;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const target = await installDocumentPlugin(process.argv[2]);
  console.log(`GIDEON bundled document plugin ready: ${target}`);
}

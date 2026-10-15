import { constants } from 'node:fs';
import { chmod, link, lstat, mkdir, open, readdir, realpath, rename, rm, rmdir } from 'node:fs/promises';
import path from 'node:path';
import { createCipheriv, createDecipheriv, createHash, randomBytes, scrypt } from 'node:crypto';
import { promisify } from 'node:util';

// This container holds OpenClaw's original files, never a second memory database.
const MAGIC = Buffer.from('GIDEONBK');
const VERSION = 1;
const PREFIX_BYTES = 40;
const HEADER_BYTES = 56;
const MAX_ARCHIVE_BYTES = 256 * 1024 * 1024;
const MAX_SOURCE_BYTES = 128 * 1024 * 1024;
const MAX_ENTRIES = 25_000;
const derive = promisify(scrypt);
const hash = (buffer) => createHash('sha256').update(buffer).digest('hex');
const inside = (root, candidate) => candidate === root || candidate.startsWith(root + path.sep);

function checkPassword(password) {
  if (typeof password !== 'string' || password.length < 8 || Buffer.byteLength(password) > 1024) {
    throw new Error('Yedek parolası en az 8 karakter olmalı ve 1024 baytı aşmamalıdır.');
  }
}

function checkPath(name) {
  if (typeof name !== 'string' || !name || name.length > 1024 || path.posix.isAbsolute(name)) {
    throw new Error('Yedekte geçersiz dosya yolu.');
  }
  for (const part of name.split('/')) {
    if (!part || part === '.' || part === '..' || /[<>:"\\|?*\u0000-\u001f]/u.test(part)
      || /[. ]$/u.test(part) || Buffer.byteLength(part) > 255
      || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(part)) {
      throw new Error('Yedekte güvensiz veya taşınamayan dosya yolu.');
    }
  }
  return name;
}

async function missingLstat(name) {
  try { return await lstat(name); } catch (error) {
    if (error.code === 'ENOENT') return undefined;
    throw error;
  }
}

async function targetPath(destination) {
  if (typeof destination !== 'string' || !destination) throw new Error('Hedef yolu gerekli.');
  const resolved = path.resolve(destination);
  // Existing parent directories are required; their canonical path also catches
  // destinations that enter the source through a directory symlink.
  const parent = await realpath(path.dirname(resolved));
  return path.join(parent, path.basename(resolved));
}

async function readRegularFile(filename, expected, limit) {
  const handle = await open(filename, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.dev !== expected.dev || stat.ino !== expected.ino || stat.size > limit) {
      throw new Error('Yedekleme sırasında dosya değişti veya boyut sınırı aşıldı.');
    }
    const data = Buffer.alloc(stat.size);
    let offset = 0;
    while (offset < data.length) {
      const result = await handle.read(data, offset, data.length - offset, offset);
      if (!result.bytesRead) throw new Error('Yedekleme sırasında dosya değişti.');
      offset += result.bytesRead;
    }
    const after = await handle.stat();
    if (after.size !== stat.size || after.mtimeMs !== stat.mtimeMs || after.ctimeMs !== stat.ctimeMs) {
      throw new Error('Yedekleme sırasında dosya değişti; yeniden deneyin.');
    }
    return data;
  } finally { await handle.close(); }
}

async function snapshot(root) {
  const files = [];
  const directories = [];
  const names = new Set();
  const excludedPaths = [];
  let totalBytes = 0;
  async function walk(directory, relative = '') {
    // Linux's descriptor path pins each parent directory: replacing an ancestor
    // cannot redirect a later read through a symbolic link. Other platforms use
    // repeated canonical-path checks; run backups with the state writer stopped.
    let directoryHandle;
    let anchored = directory;
    if (process.platform === 'linux') {
      directoryHandle = await open(directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
      anchored = `/proc/self/fd/${directoryHandle.fd}`;
    }
    try {
      const expectedDirectory = relative ? path.join(root, ...relative.split('/')) : root;
      if (await realpath(anchored) !== expectedDirectory) throw new Error('Yedekleme sırasında dizin yolu değişti.');
      for (const item of (await readdir(anchored)).sort()) {
        const name = checkPath(relative ? `${relative}/${item}` : item);
        if (names.has(name.toLowerCase())) throw new Error('Yedekte çakışan dosya yolları.');
        names.add(name.toLowerCase());
        const absolute = path.join(anchored, item);
        const expectedPath = path.join(root, ...name.split('/'));
        const stat = await lstat(absolute);
        if (stat.isSymbolicLink()) {
          // The host owns these generated skill pointers. Ignore the pointer
          // itself, never its destination; ordinary files here still survive.
          if (relative === 'plugin-skills') { excludedPaths.push(name); continue; }
          throw new Error(`Sembolik bağlantılar yedeklenmez: ${name}`);
        }
        const canonical = await realpath(absolute);
        if (canonical !== expectedPath || !inside(root, canonical)) throw new Error('Dosya durum dizininin dışına çıkıyor.');
        if (files.length + directories.length >= MAX_ENTRIES) throw new Error('Yedekte çok fazla dosya veya dizin var.');
        if (stat.isDirectory()) {
          directories.push({ path: name });
          // OpenClaw rebuilds plugin admission captures at every startup. They
          // contain links to installed code, not session or user data. Keep an
          // empty directory without reading or following any captured entry.
          if (name === 'tmp/plugin-captures') { excludedPaths.push(name); continue; }
          await walk(absolute, name);
        } else if (stat.isFile()) {
          const data = await readRegularFile(absolute, stat, MAX_SOURCE_BYTES - totalBytes);
          if (await realpath(absolute) !== expectedPath) throw new Error('Yedekleme sırasında dosya yolu değişti.');
          totalBytes += data.length;
          files.push({ path: name, mode: stat.mode & 0o700, size: data.length, sha256: hash(data), data: data.toString('base64') });
        } else {
          throw new Error('Yedek yalnızca normal dosya ve dizin içerebilir.');
        }
      }
    } finally { if (directoryHandle) await directoryHandle.close(); }
  }
  await walk(root);
  const manifest = { format: 'gideon.openclaw.state', version: VERSION, directories, files };
  return { manifest, fileCount: files.length, totalBytes, excludedPaths };
}

async function encryptionKey(password, salt) {
  const bytes = Buffer.from(password, 'utf8');
  try {
    return await derive(bytes, salt, 32, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  } finally { bytes.fill(0); }
}

function prefix(salt, iv) {
  const result = Buffer.alloc(PREFIX_BYTES);
  MAGIC.copy(result);
  result.writeUInt32BE(VERSION, 8);
  salt.copy(result, 12);
  iv.copy(result, 28);
  return result;
}

/** Create an authenticated, encrypted archive without replacing an existing file.
 * Credentials, session originals and user files are preserved. Regenerable
 * tmp/plugin-captures and generated plugin-skills pointers are omitted without
 * following their code links.
 * Keep the password outside command-line arguments and source control.
 */
export async function createBackup({ stateDir, destination, password }) {
  checkPassword(password);
  if (typeof stateDir !== 'string' || !stateDir) throw new Error('OpenClaw durum dizini gerekli.');
  const source = path.resolve(stateDir);
  const sourceStat = await lstat(source);
  if (!sourceStat.isDirectory() || sourceStat.isSymbolicLink()) throw new Error('Durum dizini gerçek bir dizin olmalıdır.');
  const root = await realpath(source);
  const archivePath = await targetPath(destination);
  if (inside(root, archivePath)) throw new Error('Yedek hedefi durum dizininin dışında olmalıdır.');
  if (await missingLstat(archivePath)) throw new Error('Yedek hedefi zaten var; mevcut dosya değiştirilmedi.');
  const { manifest, fileCount, totalBytes, excludedPaths } = await snapshot(root);
  const plaintext = Buffer.from(JSON.stringify(manifest));
  if (plaintext.length + HEADER_BYTES > MAX_ARCHIVE_BYTES) throw new Error('Yedek boyut sınırını aşıyor.');
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const authenticatedPrefix = prefix(salt, iv);
  const key = await encryptionKey(password, salt);
  let archive;
  try {
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(authenticatedPrefix);
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    archive = Buffer.concat([authenticatedPrefix, cipher.getAuthTag(), ciphertext]);
  } finally {
    key.fill(0);
    plaintext.fill(0);
  }
  const temporary = path.join(path.dirname(archivePath), `.gideon-backup-${randomBytes(12).toString('hex')}`);
  let handle;
  try {
    handle = await open(temporary, 'wx', 0o600);
    await handle.writeFile(archive);
    await handle.sync();
    await handle.close();
    handle = undefined;
    // Hard-link publication is atomic and refuses to replace a concurrent file.
    await link(temporary, archivePath);
  } finally {
    if (handle) await handle.close();
    await rm(temporary, { force: true });
  }
  return { archivePath, fileCount, totalBytes, excludedPaths };
}

function validateManifest(manifest) {
  if (!manifest || manifest.format !== 'gideon.openclaw.state' || manifest.version !== VERSION
    || !Array.isArray(manifest.directories) || !Array.isArray(manifest.files)
    || manifest.directories.length + manifest.files.length > MAX_ENTRIES) {
    throw new Error('Yedek içeriği geçersiz veya desteklenmeyen sürümde.');
  }
  const paths = new Set();
  const filePaths = new Set();
  const result = [];
  let totalBytes = 0;
  for (const entry of [...manifest.directories, ...manifest.files]) {
    const name = checkPath(entry?.path);
    const normalized = name.toLowerCase();
    if (paths.has(normalized)) throw new Error('Yedekte çakışan dosya yolları.');
    paths.add(normalized);
  }
  for (const entry of manifest.files) {
    if (!Number.isSafeInteger(entry.size) || entry.size < 0 || entry.size > MAX_SOURCE_BYTES - totalBytes
      || !Number.isInteger(entry.mode) || entry.mode < 0 || entry.mode > 0o700 || (entry.mode & ~0o700)
      || typeof entry.sha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(entry.sha256)
      || typeof entry.data !== 'string' || entry.data.length !== Math.ceil(entry.size / 3) * 4) {
      throw new Error('Yedekte geçersiz dosya bilgisi.');
    }
    const data = Buffer.from(entry.data, 'base64');
    // Node's base64 decoder is permissive. Canonical re-encoding rejects invalid
    // characters, whitespace and padding without a repeated-group regex that
    // exhausts the regexp stack on real SQLite files.
    if (data.length !== entry.size || data.toString('base64') !== entry.data || hash(data) !== entry.sha256) {
      throw new Error('Yedekte dosya sağlama toplamı doğrulanamadı.');
    }
    totalBytes += data.length;
    filePaths.add(entry.path.toLowerCase());
    result.push({ path: entry.path, mode: entry.mode, data });
  }
  for (const name of paths) {
    const parts = name.split('/');
    for (let i = 1; i < parts.length; i += 1) {
      if (filePaths.has(parts.slice(0, i).join('/'))) throw new Error('Yedekte dosya ve dizin yolları çakışıyor.');
    }
  }
  return { directories: manifest.directories.map((entry) => entry.path), files: result, totalBytes };
}

async function ensureEmpty(destination) {
  const stat = await missingLstat(destination);
  if (stat && (!stat.isDirectory() || stat.isSymbolicLink() || (await readdir(destination)).length)) {
    throw new Error('Geri yükleme için yeni veya boş bir dizin gerekli; mevcut durum değiştirilmedi.');
  }
  return Boolean(stat);
}

/** Restore verified originals only to a new/empty directory, through staging. */
export async function restoreBackup({ archivePath, destination, password }) {
  checkPassword(password);
  if (typeof archivePath !== 'string' || !archivePath) throw new Error('Yedek dosyası gerekli.');
  const target = await targetPath(destination);
  await ensureEmpty(target);
  const archiveStat = await lstat(archivePath);
  if (archiveStat.isSymbolicLink() || !archiveStat.isFile() || archiveStat.size < HEADER_BYTES
    || archiveStat.size > MAX_ARCHIVE_BYTES) throw new Error('Yedek dosyası geçersiz veya çok büyük.');
  const archive = await readRegularFile(archivePath, archiveStat, MAX_ARCHIVE_BYTES);
  if (!archive.subarray(0, 8).equals(MAGIC) || archive.readUInt32BE(8) !== VERSION) {
    throw new Error('Yedek biçimi veya sürümü desteklenmiyor.');
  }
  const key = await encryptionKey(password, archive.subarray(12, 28));
  let plaintext;
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, archive.subarray(28, 40));
    decipher.setAAD(archive.subarray(0, PREFIX_BYTES));
    decipher.setAuthTag(archive.subarray(PREFIX_BYTES, HEADER_BYTES));
    plaintext = Buffer.concat([decipher.update(archive.subarray(HEADER_BYTES)), decipher.final()]);
  } catch {
    throw new Error('Yedek doğrulanamadı: parola yanlış veya dosya bozulmuş.');
  } finally { key.fill(0); }
  let contents;
  try {
    let manifest;
    try { manifest = JSON.parse(plaintext.toString('utf8')); } catch { throw new Error('Yedek içeriği geçersiz.'); }
    contents = validateManifest(manifest);
  } finally { plaintext.fill(0); }
  await ensureEmpty(target);
  const staging = path.join(path.dirname(target), `.gideon-restore-${randomBytes(12).toString('hex')}`);
  await mkdir(staging, { mode: 0o700 });
  try {
    for (const directory of contents.directories) {
      await mkdir(path.join(staging, ...directory.split('/')), { recursive: true, mode: 0o700 });
    }
    for (const file of contents.files) {
      const filename = path.join(staging, ...file.path.split('/'));
      await mkdir(path.dirname(filename), { recursive: true, mode: 0o700 });
      const handle = await open(filename, 'wx', 0o600);
      try { await handle.writeFile(file.data); await handle.sync(); } finally { await handle.close(); }
      await chmod(filename, file.mode);
    }
    await ensureEmpty(target);
    try {
      await rename(staging, target);
    } catch (error) {
      // Windows cannot rename a directory over an existing empty directory.
      // rmdir itself refuses a directory populated since the preceding check.
      if (process.platform !== 'win32' || !['EEXIST', 'EPERM', 'ENOTEMPTY'].includes(error.code)
        || !(await ensureEmpty(target))) throw error;
      await rmdir(target);
      try { await rename(staging, target); } catch (failure) {
        if (!(await missingLstat(target))) await mkdir(target, { mode: 0o700 });
        throw failure;
      }
    }
  } finally {
    await rm(staging, { recursive: true, force: true });
    for (const file of contents.files) file.data.fill(0);
  }
  return { destination: target, fileCount: contents.files.length, totalBytes: contents.totalBytes };
}

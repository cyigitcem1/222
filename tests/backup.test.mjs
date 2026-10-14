import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, stat, symlink, truncate, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createCipheriv, createHash, randomBytes, scryptSync } from 'node:crypto';
import { createBackup, restoreBackup } from '../lib/backup.mjs';

const password = 'synthetic-test-password-only';

async function sandbox(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'gideon-backup-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

async function source(root) {
  const stateDir = path.join(root, 'source');
  await mkdir(path.join(stateDir, 'agents', 'main', 'sessions'), { recursive: true });
  await mkdir(path.join(stateDir, 'workspace', 'memory'), { recursive: true });
  await mkdir(path.join(stateDir, 'workspace', 'empty'), { recursive: true });
  await mkdir(path.join(stateDir, 'credentials'), { recursive: true });
  // These are deliberate synthetic fixtures; no real credentials are stored.
  await writeFile(path.join(stateDir, 'credentials', 'synthetic.json'), '{"token":"test-placeholder"}');
  await writeFile(path.join(stateDir, 'openclaw.json'), '{"fixture":true}');
  await writeFile(path.join(stateDir, 'agents', 'main', 'sessions', 'original.jsonl'), '{"message":"Merhaba, GIDEON"}\n');
  await writeFile(path.join(stateDir, 'workspace', 'memory', '2026-10-14.md'), 'Özgün hafıza: bugün kahve.\n');
  await writeFile(path.join(stateDir, 'workspace', 'binary.bin'), Buffer.from([0, 255, 128, 1]));
  return stateDir;
}

function hostileArchive(manifest) {
  const header = Buffer.alloc(40);
  header.write('GIDEONBK');
  header.writeUInt32BE(1, 8);
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  salt.copy(header, 12);
  iv.copy(header, 28);
  const key = scryptSync(password, salt, 32, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(header);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(manifest)), cipher.final()]);
  key.fill(0);
  return Buffer.concat([header, cipher.getAuthTag(), ciphertext]);
}

function fileEntry(filename, data = 'fixture') {
  const buffer = Buffer.from(data);
  return { path: filename, mode: 0o600, size: buffer.length,
    sha256: createHash('sha256').update(buffer).digest('hex'), data: buffer.toString('base64') };
}

test('encrypted roundtrip preserves OpenClaw session, memory, config, auth, binary and empty directories', async (t) => {
  const root = await sandbox(t);
  const stateDir = await source(root);
  const archivePath = path.join(root, 'state.gideon');
  const result = await createBackup({ stateDir, destination: archivePath, password });
  assert.equal(result.fileCount, 5);
  const encrypted = await readFile(archivePath);
  assert.equal(encrypted.includes(Buffer.from('test-placeholder')), false);
  assert.equal(encrypted.includes(Buffer.from('Özgün hafıza')), false);
  if (process.platform !== 'win32') assert.equal((await stat(archivePath)).mode & 0o777, 0o600);
  const destination = path.join(root, 'restored');
  const restored = await restoreBackup({ archivePath, destination, password });
  assert.equal(restored.fileCount, result.fileCount);
  assert.equal(restored.totalBytes, result.totalBytes);
  for (const filename of ['credentials/synthetic.json', 'openclaw.json', 'agents/main/sessions/original.jsonl',
    'workspace/memory/2026-10-14.md', 'workspace/binary.bin']) {
    assert.deepEqual(await readFile(path.join(destination, filename)), await readFile(path.join(stateDir, filename)));
    if (process.platform !== 'win32') assert.equal((await stat(path.join(destination, filename))).mode & 0o077, 0);
  }
  assert.deepEqual(await readdir(path.join(destination, 'workspace', 'empty')), []);
  await mkdir(path.join(root, 'empty-target'));
  await restoreBackup({ archivePath, destination: path.join(root, 'empty-target'), password });
  assert.deepEqual(await readFile(path.join(root, 'empty-target', 'openclaw.json')), await readFile(path.join(stateDir, 'openclaw.json')));
});

test('an 8 MiB native database-sized file roundtrips without regexp stack exhaustion', async (t) => {
  const root = await sandbox(t);
  const stateDir = await source(root);
  const database = randomBytes(8 * 1024 * 1024);
  const databasePath = path.join('agents', 'main', 'openclaw-agent.sqlite');
  await writeFile(path.join(stateDir, databasePath), database);
  const archivePath = path.join(root, 'state.gideon');
  const result = await createBackup({ stateDir, destination: archivePath, password });
  assert.ok(result.totalBytes >= database.length);
  const destination = path.join(root, 'restored');
  await restoreBackup({ archivePath, destination, password });
  assert.deepEqual(await readFile(path.join(destination, databasePath)), database);
});

test('wrong password and modified ciphertext leave no destination or temporary restore files', async (t) => {
  const root = await sandbox(t);
  const stateDir = await source(root);
  const archivePath = path.join(root, 'state.gideon');
  await createBackup({ stateDir, destination: archivePath, password });
  const destination = path.join(root, 'restored');
  await assert.rejects(restoreBackup({ archivePath, destination, password: 'wrong-password' }), /doğrulanamadı/u);
  const empty = path.join(root, 'empty');
  await mkdir(empty);
  await assert.rejects(restoreBackup({ archivePath, destination: empty, password: 'wrong-password' }), /doğrulanamadı/u);
  assert.deepEqual(await readdir(empty), []);
  const encrypted = await readFile(archivePath);
  encrypted[encrypted.length - 1] ^= 1;
  await writeFile(archivePath, encrypted);
  await assert.rejects(restoreBackup({ archivePath, destination, password }), /doğrulanamadı/u);
  assert.deepEqual((await readdir(root)).sort(), ['empty', 'source', 'state.gideon']);
});

test('existing backups and populated restore destinations are preserved', async (t) => {
  const root = await sandbox(t);
  const stateDir = await source(root);
  const archivePath = path.join(root, 'state.gideon');
  await createBackup({ stateDir, destination: archivePath, password });
  const original = await readFile(archivePath);
  await assert.rejects(createBackup({ stateDir, destination: archivePath, password }), /zaten var/u);
  assert.deepEqual(await readFile(archivePath), original);
  await assert.rejects(restoreBackup({ archivePath, destination: stateDir, password }), /mevcut durum değiştirilmedi/u);
  assert.equal((await readFile(path.join(stateDir, 'openclaw.json'), 'utf8')), '{"fixture":true}');
  const destination = path.join(root, 'current');
  await mkdir(destination);
  await writeFile(path.join(destination, 'keep.txt'), 'preserve me');
  await assert.rejects(restoreBackup({ archivePath, destination, password }), /mevcut durum değiştirilmedi/u);
  assert.equal(await readFile(path.join(destination, 'keep.txt'), 'utf8'), 'preserve me');
});

test('source symlinks and archive destinations inside source are rejected', async (t) => {
  const root = await sandbox(t);
  const stateDir = await source(root);
  await assert.rejects(createBackup({ stateDir, destination: path.join(stateDir, 'unsafe.gideon'), password }), /dışında/u);
  await writeFile(path.join(root, 'outside.txt'), 'outside data');
  await symlink(path.join(root, 'outside.txt'), path.join(stateDir, 'escape.txt'));
  await assert.rejects(createBackup({ stateDir, destination: path.join(root, 'state.gideon'), password }), /Sembolik/u);
  assert.equal((await readdir(root)).includes('state.gideon'), false);
  await symlink(stateDir, path.join(root, 'linked-source'), 'dir');
  await assert.rejects(createBackup({ stateDir: path.join(root, 'linked-source'), destination: path.join(root, 'state.gideon'), password }), /gerçek/u);
});

test('oversized source files are rejected before being read into memory', async (t) => {
  const root = await sandbox(t);
  const stateDir = await source(root);
  await truncate(path.join(stateDir, 'workspace', 'binary.bin'), 128 * 1024 * 1024 + 1);
  await assert.rejects(createBackup({ stateDir, destination: path.join(root, 'state.gideon'), password }), /boyut sınırı/u);
  assert.deepEqual((await readdir(root)).sort(), ['source']);
});

test('authenticated malicious manifests cannot traverse, collide, or bypass file hashes', async (t) => {
  const root = await sandbox(t);
  const archivePath = path.join(root, 'hostile.gideon');
  const destination = path.join(root, 'restored');
  const manifest = (files, directories = []) => ({ format: 'gideon.openclaw.state', version: 1, files, directories });
  const fixtures = [
    manifest([fileEntry('../outside.txt')]),
    manifest([fileEntry('/outside.txt')]),
    manifest([fileEntry('C:\\outside.txt')]),
    manifest([fileEntry('nested/../../outside.txt')]),
    manifest([fileEntry('safe/../outside.txt')]),
    manifest([fileEntry('a'), fileEntry('a/b')]),
    manifest([fileEntry('A'), fileEntry('a')]),
    manifest([fileEntry('same')], [{ path: 'same' }]),
    manifest([{ ...fileEntry('memory.md'), sha256: '0'.repeat(64) }]),
    manifest([{ ...fileEntry('memory.md'), data: 'not base64' }]),
    manifest([{ ...fileEntry('memory.md'), data: 'Zml4dHVyZQ??' }]),
    // Non-zero padding bits decode to the same bytes but are not canonical.
    manifest([{ ...fileEntry('memory.md'), data: 'Zml4dHVyZR==' }]),
    manifest([{ ...fileEntry('memory.md'), mode: 4294967296 }]),
    { format: 'gideon.openclaw.state', version: 2, files: [], directories: [] },
  ];
  for (const fixture of fixtures) {
    await writeFile(archivePath, hostileArchive(fixture));
    await assert.rejects(restoreBackup({ archivePath, destination, password }));
    assert.deepEqual((await readdir(root)).sort(), ['hostile.gideon']);
  }
});

test('unknown versions, truncation, oversized archives and linked destinations fail safely', async (t) => {
  const root = await sandbox(t);
  const stateDir = await source(root);
  const archivePath = path.join(root, 'state.gideon');
  await createBackup({ stateDir, destination: archivePath, password });
  const valid = await readFile(archivePath);
  const destination = path.join(root, 'restored');
  const unknown = Buffer.from(valid);
  unknown.writeUInt32BE(999, 8);
  await writeFile(archivePath, unknown);
  await assert.rejects(restoreBackup({ archivePath, destination, password }), /sürümü/u);
  await writeFile(archivePath, valid.subarray(0, 55));
  await assert.rejects(restoreBackup({ archivePath, destination, password }), /geçersiz/u);
  await truncate(archivePath, 256 * 1024 * 1024 + 1);
  await assert.rejects(restoreBackup({ archivePath, destination, password }), /çok büyük/u);
  await writeFile(archivePath, valid);
  await mkdir(destination);
  await symlink(destination, path.join(root, 'linked-destination'), 'dir');
  await assert.rejects(restoreBackup({ archivePath, destination: path.join(root, 'linked-destination'), password }), /mevcut durum değiştirilmedi/u);
  await symlink(archivePath, path.join(root, 'linked-archive'));
  await assert.rejects(restoreBackup({ archivePath: path.join(root, 'linked-archive'), destination, password }), /geçersiz/u);
  assert.deepEqual(await readdir(destination), []);
});

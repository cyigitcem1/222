import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, rm, writeFile, symlink, mkdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const { configureUserData } = createRequire(import.meta.url)('../desktop/app-paths.cjs');

async function fixture(t) {
  const appData = await mkdtemp(join(tmpdir(), 'gideon-first-launch-'));
  t.after(() => rm(appData, { recursive: true, force: true }));
  const paths = {};
  const app = {
    getPath: name => { assert.equal(name, 'appData'); return appData; },
    setPath: (name, target) => {
      // Electron's setPath rejects missing directories. This models the native
      // precondition, including when a fresh account has no GIDEON folder yet.
      assert.ok(existsSync(target), 'Electron was given a missing directory');
      paths[name] = target;
    },
  };
  return { app, appData, paths, target: join(appData, 'GIDEON') };
}

test('fresh desktop launch creates its data directory before Electron uses it', async t => {
  const f = await fixture(t);
  assert.equal(existsSync(f.target), false);
  assert.equal(configureUserData(f.app, {}), f.target);
  assert.ok((await stat(f.target)).isDirectory());
  assert.equal(f.paths.userData, f.target);
  assert.equal(f.paths.sessionData, f.target);
});

test('desktop relaunch preserves existing encrypted credentials and notes', async t => {
  const f = await fixture(t);
  await mkdir(f.target);
  const credentials = join(f.target, 'credentials.bin');
  await writeFile(credentials, Buffer.from([0, 1, 2, 255]));
  configureUserData(f.app, {});
  configureUserData(f.app, {});
  assert.deepEqual(await readFile(credentials), Buffer.from([0, 1, 2, 255]));
});

test('desktop data directory rejects files and symlinks without replacing them', async t => {
  const f = await fixture(t);
  await writeFile(f.target, 'existing user file');
  assert.throws(() => configureUserData(f.app, {}), /unsafe/);
  assert.equal(await readFile(f.target, 'utf8'), 'existing user file');
  await rm(f.target);
  const elsewhere = join(f.appData, 'elsewhere');
  await mkdir(elsewhere);
  await symlink(elsewhere, f.target, process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => configureUserData(f.app, {}), /unsafe/);
  assert.deepEqual(f.paths, {});
});

test('desktop verification can use an isolated absolute profile', async t => {
  const f = await fixture(t);
  const isolated = join(f.appData, 'verification', 'profile');
  configureUserData(f.app, { GIDEON_DESKTOP_DATA_DIR: isolated });
  assert.ok((await stat(isolated)).isDirectory());
  assert.equal(existsSync(f.target), false);
  assert.equal(f.paths.userData, isolated);
  assert.throws(() => configureUserData(f.app, { GIDEON_DESKTOP_DATA_DIR: 'relative-folder' }), /absolute/);
});

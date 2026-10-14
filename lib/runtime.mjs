import { readFile, writeFile, unlink } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { createConnection } from 'node:net';
import { join } from 'node:path';
import { assertProfileState } from './profile.mjs';

async function runningLauncher(stateDir) {
  let marker;
  try { marker = JSON.parse(await readFile(join(stateDir, 'launcher-runtime.json'), 'utf8')); }
  catch (e) { if (e.code === 'ENOENT') return false; throw new Error('Hizmet kilidi doğrulanamadı; işlem yapılmadı.'); }
  if (!Number.isSafeInteger(marker.pid) || marker.pid <= 0) throw new Error('Hizmet kilidi doğrulanamadı.');
  try { process.kill(marker.pid, 0); return true; }
  catch (e) { if (e.code === 'ESRCH') return false; return true; }
}

export async function acquireRuntime(stateDir) {
  await assertProfileState(stateDir);
  const path = join(stateDir, 'launcher-runtime.json');
  const content = JSON.stringify({ pid: process.pid, id: randomBytes(16).toString('hex') });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await writeFile(path, content, { flag: 'wx', mode: 0o600 });
      return async () => {
        try { if (await readFile(path, 'utf8') === content) await unlink(path); }
        catch (e) { if (e.code !== 'ENOENT') throw e; }
      };
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      if (await runningLauncher(stateDir)) throw new Error('GIDEON bu veri klasöründe zaten çalışıyor veya başlatılıyor.');
      await unlink(path); // Only a verified dead launcher marker is reclaimed.
    }
  }
  throw new Error('GIDEON hizmet kilidi alınamadı.');
}

export async function assertStopped(stateDir, port) {
  await assertProfileState(stateDir);
  if (await runningLauncher(stateDir)) throw new Error('Önce GIDEON terminalinde Ctrl+C ile hizmeti durdurun.');
  await new Promise((accept, reject) => {
    const socket = createConnection({ host: '127.0.0.1', port });
    socket.setTimeout(1500);
    socket.once('connect', () => { socket.destroy(); reject(new Error('Bu portta hizmet çalışıyor. Yedek almadan önce durdurun.')); });
    socket.once('timeout', () => { socket.destroy(); reject(new Error('Hizmetin durduğu doğrulanamadı; yedek alınmadı.')); });
    socket.once('error', e => {
      socket.destroy();
      if (e.code === 'ECONNREFUSED') accept();
      else reject(new Error('Hizmetin durduğu doğrulanamadı; yedek alınmadı.'));
    });
  });
}

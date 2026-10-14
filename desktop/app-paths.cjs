'use strict';

const fs = require('node:fs');
const path = require('node:path');

function configureUserData(app, env = process.env) {
  const requested = env.GIDEON_DESKTOP_DATA_DIR || path.join(app.getPath('appData'), 'GIDEON');
  if (!path.isAbsolute(requested)) throw new Error('GIDEON data directory must be absolute');
  const target = path.resolve(requested);
  const parents = [];
  for (let current = target; ; current = path.dirname(current)) {
    parents.push(current);
    if (path.dirname(current) === current) break;
  }
  for (const directory of parents.reverse()) {
    let entry;
    try { entry = fs.lstatSync(directory); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      try { fs.mkdirSync(directory, { mode: 0o700 }); }
      catch (mkdirError) { if (mkdirError.code !== 'EEXIST') throw mkdirError; }
      entry = fs.lstatSync(directory);
    }
    if (!entry.isDirectory() || entry.isSymbolicLink()) throw new Error('GIDEON data directory is unsafe');
  }
  // Electron requires the directory to exist before setPath. A fresh Windows
  // account has no GIDEON folder yet; creating it after this call is too late.
  app.setPath('userData', target);
  app.setPath('sessionData', target);
  return target;
}

module.exports = { configureUserData };

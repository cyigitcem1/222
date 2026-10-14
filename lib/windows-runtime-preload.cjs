'use strict';
const { existsSync } = require('node:fs');
const { dirname, join, resolve } = require('node:path');

// Native addons use an altered DLL search path. Load the app-local Microsoft
// runtime first so an older machine-wide copy cannot hide a missing dependency.
const libraries = [];
const runtimeRoot = resolve(__dirname, '..');
if (process.platform === 'win32' && existsSync(join(runtimeRoot, '..', 'runtime-manifest.json'))) {
  const koffi = require('koffi'); // This native binding is statically linked to CRT.
  const kernel = koffi.load('kernel32.dll');
  const getModule = kernel.func('void * __stdcall GetModuleHandleW(const char16_t *name)');
  const getFilename = kernel.func('uint32_t __stdcall GetModuleFileNameW(void *module, void *filename, uint32_t size)');
  libraries.push(kernel);
  for (const name of ['vcruntime140.dll', 'vcruntime140_1.dll', 'msvcp140.dll']) {
    const expected = join(dirname(process.execPath), name);
    if (!existsSync(expected)) throw new Error('GIDEON bundled Microsoft runtime is missing.');
    libraries.push(koffi.load(expected));
    const module = getModule(name);
    const buffer = Buffer.alloc(32768 * 2);
    const length = getFilename(module, buffer, 32768);
    if (!module || !length || length >= 32768 || resolve(buffer.toString('utf16le', 0, length * 2)).toLowerCase() !== resolve(expected).toLowerCase()) {
      throw new Error('GIDEON Microsoft runtime was not loaded from its verified bundle.');
    }
  }
}
// The module cache retains the library handles for this process's lifetime.
module.exports = Object.freeze(libraries);

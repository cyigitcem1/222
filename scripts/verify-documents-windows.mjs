#!/usr/bin/env node
// Exercise the shipped document writer and independent PDFium reader using the
// bundled Windows Node. All documents are synthetic fixtures in an owned folder.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { lstat, mkdir, mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const timeoutMs = 90_000;
const fixtureSentence = 'İstanbul’da çalışan Çağrı Şahin, çığ ve ışık hakkında ölçülü bir inceleme hazırladı.';
const fixtureAlphabet = 'Türkçe karakterler: ÇĞİÖŞÜ çğıöşü.';
const fixtureCitation = 'TEST KARARI — Yargıtay 3. Hukuk Dairesi; Esas: 2025/12345; Karar: 2026/67890; Tarih: 14.10.2026.';
const fixtureUrl = 'https://karararama.yargitay.gov.tr/';
const fixtureSources = [{ title: 'Sentetik CI kaynak kaydı', url: fixtureUrl, citation: fixtureCitation, publishedAt: '2026-10-14' }];
const fixedNow = new Date('2026-10-14T12:00:00.000Z');

function redact(value) {
  let text = String(value);
  for (const key of [process.env.GEMINI_API_KEY, process.env.GOOGLE_API_KEY]) {
    if (key) text = text.split(key).join('[REDACTED]');
  }
  return text.replace(/([#?&]token=)[^\s"'<>]+/gi, '$1[REDACTED]')
    .replace(/AIza[\w-]{20,}/g, '[REDACTED]');
}

function annotation(kind, message) {
  const safe = redact(message).replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');
  console.log(`::${kind} title=Windows document smoke::${safe.slice(0, 6000)}`);
}

async function regular(path) {
  const entry = await lstat(path);
  assert.ok(entry.isFile() && !entry.isSymbolicLink(), 'Expected a bundled or generated regular file.');
}

function normalized(text) { return text.normalize('NFC').replace(/\s+/gu, ' ').trim(); }
function containsText(text, expected, description) {
  assert.ok(normalized(text).includes(normalized(expected)), description);
}

// Independent RFC 4180 reader for small test fixtures: quoted commas, escaped
// quotes and embedded line breaks must decode into the original cell values.
function csvRows(text) {
  const rows = [];
  let row = [], field = '', quoted = false, endedQuote = false;
  const cell = () => { row.push(field); field = ''; endedQuote = false; };
  const line = () => { cell(); rows.push(row); row = []; };
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') { field += '"'; index += 1; }
      else if (char === '"') { quoted = false; endedQuote = true; }
      else field += char;
      continue;
    }
    if (char === ',') { cell(); continue; }
    if (char === '\r' || char === '\n') {
      if (char === '\r') { assert.equal(text[index + 1], '\n', 'CSV contains a bare carriage return.'); index += 1; }
      line(); continue;
    }
    assert.equal(endedQuote, false, 'CSV contains data after a closing quote.');
    if (char === '"') { assert.equal(field, '', 'CSV quote appeared inside an unquoted field.'); quoted = true; }
    else field += char;
  }
  assert.equal(quoted, false, 'CSV contains an unterminated quoted field.');
  if (field || row.length || endedQuote) line();
  return rows;
}

async function exercise(runtime, workspace) {
  const modulePath = join(runtime, 'extensions', 'gideon-documents', 'documents.js');
  const fontPath = join(runtime, 'extensions', 'gideon-documents', 'assets', 'DejaVuSans.ttf');
  await regular(modulePath); await regular(fontPath);
  const { createDocument } = await import(pathToFileURL(modulePath).href);
  assert.equal(typeof createDocument, 'function', 'Bundled document writer export is missing.');
  // This import resolves from this shipped script into runtime/node_modules,
  // never into a globally installed PDF reader or the build host dependencies.
  const { openPdf } = await import('clawpdf');
  const pdfContent = [
    'Bu belge yalnızca otomatik test verisidir; gerçek karar veya hukuki görüş değildir.',
    fixtureSentence, fixtureAlphabet,
    ...Array.from({ length: 24 }, (_, index) => `İnceleme bölümü ${index + 1}. ${fixtureSentence} ${fixtureAlphabet}`),
  ].join('\n\n');
  const markdown = `# Türkçe inceleme\n\n**Önemli:** ${fixtureSentence}\n\n- ${fixtureAlphabet}\n`;
  const plain = `${fixtureSentence}\n${fixtureAlphabet}\n`;
  const csv = 'Ad,Şehir,Not\r\n"Çağrı ""Şahin""","İstanbul","Çığ, ışık ve ölçü"\r\n"İpek","İzmir","Şüphe ve güven\nİkinci satır"\r\n"Deniz","Ankara","=1+1"\r\n';
  const expectedCsv = [
    ['Ad', 'Şehir', 'Not'], ['Çağrı "Şahin"', 'İstanbul', 'Çığ, ışık ve ölçü'],
    ['İpek', 'İzmir', 'Şüphe ve güven\nİkinci satır'], ['Deniz', 'Ankara', "'=1+1"],
  ];
  const fixtures = [
    { format: 'pdf', content: pdfContent, mime: 'application/pdf', sources: fixtureSources },
    { format: 'md', content: markdown, mime: 'text/markdown', sources: fixtureSources },
    { format: 'txt', content: plain, mime: 'text/plain', sources: fixtureSources },
    { format: 'csv', content: csv, mime: 'text/csv', sources: fixtureSources },
  ];
  const results = [];
  const ids = new Set();
  for (const fixture of fixtures) {
    // Default fontPath is intentional: prove the installed writer finds its
    // bundled Unicode font without relying on a system font or build folder.
    const report = await createDocument({
      workspace, format: fixture.format, title: 'İş ve hukuk — Türkçe belge testi',
      content: fixture.content, sources: fixture.sources, now: fixedNow,
    });
    assert.ok(typeof report.id === 'string' && report.id.length > 0, 'Document ID is missing.');
    assert.ok(!ids.has(report.id), 'Different generated documents reused an ID.'); ids.add(report.id);
    assert.ok(typeof report.path === 'string' && isAbsolute(report.path), 'Document path must be absolute.');
    const reportRelative = relative(await realpath(workspace), await realpath(report.path));
    assert.ok(reportRelative && !isAbsolute(reportRelative) && !reportRelative.split(/[\\/]/).includes('..'), 'Document escaped the owned workspace.');
    await regular(report.path);
    assert.ok(typeof report.name === 'string' && report.name.length > 0 && !/[\\/\x00-\x1f\x7f]/.test(report.name), 'Download name is missing or unsafe.');
    containsText(report.name, 'İş ve hukuk', 'Download filename lost Turkish characters.');
    assert.ok(report.name.endsWith(`.${fixture.format}`), 'Generated file extension differs from requested format.');
    assert.equal(report.mimeType.split(';')[0].trim(), fixture.mime, 'Generated MIME type differs from requested format.');
    assert.equal(report.createdAt, fixedNow.toISOString(), 'Generated creation metadata is incorrect.');
    const bytes = await readFile(report.path);
    assert.equal(report.sizeBytes, bytes.length, 'Attachment size metadata differs from generated bytes.');
    assert.equal(report.sha256, createHash('sha256').update(bytes).digest('hex'), 'Attachment checksum differs from generated bytes.');
    assert.ok(bytes.length > 0, 'Generated document is empty.');

    if (fixture.format === 'pdf') {
      assert.ok(bytes.subarray(0, 5).equals(Buffer.from('%PDF-')), 'Generated file is not a PDF.');
      const pdf = await openPdf(bytes);
      try {
        assert.ok(pdf.pageCount >= 2, 'Long Turkish document did not paginate.');
        const text = pdf.text({ maxPages: 50, maxChars: 200_000 });
        containsText(text, fixtureSentence, 'PDFium could not recover the Turkish sentence.');
        containsText(text, fixtureAlphabet, 'PDFium could not recover all Turkish glyphs.');
        containsText(text, 'İnceleme bölümü 24.', 'The final paragraph was lost across PDF pages.');
        containsText(text, fixtureUrl, 'PDF source URL is missing.');
        containsText(text, fixtureCitation, 'PDF case citation fields are missing or damaged.');
        containsText(text, '2026-10-14', 'PDF source publication date is missing.');
        const png = Buffer.from(await pdf.page(1).png({ dpi: 72 }));
        assert.ok(png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), 'Independent PDFium rendering failed.');
        results.push({ format: 'pdf', bytes: bytes.length, pages: pdf.pageCount, rendered: true });
      } finally { pdf.destroy(); }
    } else {
      const text = bytes.toString('utf8').replace(/^\uFEFF/, '');
      if (fixture.format === 'csv') {
        assert.ok(bytes.subarray(0, 3).equals(Buffer.from([239, 187, 191])), 'CSV UTF-8 BOM is missing.');
        const rows = csvRows(text);
        assert.deepEqual(rows.slice(0, expectedCsv.length), expectedCsv, 'CSV cells, quoting, Turkish characters or formula neutralization differ.');
        const cells = rows.flat();
        for (const value of [fixtureUrl, fixtureCitation, '2026-10-14']) assert.ok(cells.includes(value), 'CSV source metadata is missing or damaged.');
      } else {
        assert.ok(text.includes(fixture.content.trimEnd()), 'Text or Markdown body was changed or truncated.');
        containsText(text, fixtureUrl, 'Text document source URL is missing.');
        containsText(text, fixtureCitation, 'Text document case citation is missing.');
        containsText(text, '2026-10-14', 'Text document source publication date is missing.');
      }
      results.push({ format: fixture.format, bytes: bytes.length });
    }
  }
  console.log(JSON.stringify({ verified: true, documents: results }));
}

async function main() {
  assert.equal(process.platform, 'win32', 'Document verification requires native Windows.');
  if (process.argv[2] === '--worker') {
    assert.ok(process.argv[3] && process.argv[4], 'Owned runtime and workspace are required.');
    await exercise(resolve(process.argv[3]), resolve(process.argv[4]));
    return;
  }
  const resources = resolve(process.argv[2] || 'dist/desktop/win-unpacked/resources');
  const runtime = join(resources, 'runtime');
  const node = join(resources, 'node', 'node.exe');
  const preload = join(runtime, 'lib', 'windows-runtime-preload.cjs');
  const worker = join(runtime, 'scripts', 'verify-documents-windows.mjs');
  for (const file of [node, preload, worker, join(resources, 'node', 'vcruntime140.dll')]) await regular(file);
  const temporary = await mkdtemp(join(tmpdir(), 'gideon-document-smoke-'));
  const workspace = join(temporary, 'workspace');
  await mkdir(workspace);
  let child, closed, timer, progress;
  try {
    const env = { ...process.env, GIDEON_STATE_DIR: join(temporary, 'state'), GEMINI_API_KEY: '', GOOGLE_API_KEY: '', NODE_DISABLE_COMPILE_CACHE: '1' };
    delete env.NODE_COMPILE_CACHE;
    child = spawn(node, ['--require', preload, worker, '--worker', runtime, workspace], { cwd: runtime, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '', errors = '';
    child.stdout.on('data', data => { output = redact(output + String(data)).slice(-16_000); });
    child.stderr.on('data', data => { errors = redact(errors + String(data)).slice(-16_000); });
    closed = once(child, 'close');
    progress = setInterval(() => annotation('notice', 'Bundled document writer and PDFium verification are still running.'), 30_000);
    const result = await Promise.race([
      closed,
      new Promise((_, reject) => { timer = setTimeout(() => { child.kill(); reject(new Error(`Document verification exceeded ${timeoutMs / 1000}s.`)); }, timeoutMs); }),
    ]);
    assert.deepEqual(result, [0, null], `Bundled document writer failed.\n${errors}\n${output}`);
    const summary = JSON.parse(output.trim());
    assert.equal(summary.verified, true, 'Worker did not report completed verification.');
    assert.deepEqual(summary.documents.map(document => document.format), ['pdf', 'md', 'txt', 'csv']);
    annotation('notice', `PASS: bundled Node produced PDF/Markdown/TXT/CSV; PDFium recovered Turkish text, legal case fields and source links across pages and rendered a page. Attachment size/checksum metadata matched real files. No engine or provider request was started. ${JSON.stringify(summary.documents)}`);
  } finally {
    clearTimeout(timer); clearInterval(progress);
    if (child && child.exitCode === null && child.signalCode === null) { child.kill(); if (closed) await closed.catch(() => {}); }
    await rm(temporary, { recursive: true, force: true, maxRetries: 3, retryDelay: 500 });
  }
}

try { await main(); }
catch (error) { annotation('error', error.message); process.exitCode = 1; }

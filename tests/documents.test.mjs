import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cp, link, lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { openPdf } from 'clawpdf';
import plugin from '../extensions/gideon-documents/index.js';
import { createDocument, validateArtifact, MAX_DOCUMENT_BYTES } from '../extensions/gideon-documents/documents.js';
import { installDocumentPlugin } from '../scripts/install-document-plugin.mjs';

const title = 'Türkçe hukuk araştırması — ÇĞİÖŞÜçğıöşü';
const content = 'İşçi, işveren ve kişisel veriler hakkında örnek rapor.\nİkinci paragraf: ölçülülük, sözleşme ve özgürlük.';
const sources = [{ title: 'Örnek resmî karar kaynağı', url: 'https://karararama.yargitay.gov.tr/', citation: 'Yargıtay 9. Hukuk Dairesi, E. 2024/1234, K. 2025/5678', publishedAt: '2025-03-14' }];
const now = '2026-10-14T12:00:00.000Z';
async function fixture(t) {
  const workspace = await mkdtemp(join(tmpdir(), 'gideon-document-test-'));
  t.after(() => rm(workspace, { recursive: true, force: true }));
  return workspace;
}
function registration(workspace) {
  let factory;
  plugin.register({ pluginConfig: { workspace }, registerTool(value, options) { factory = value; assert.equal(options.name, 'gideon_document'); } });
  return { factory };
}

test('PDF independently decodes Turkish, multiple pages and complete legal source metadata', async t => {
  const workspace = await fixture(t);
  const paragraphs = Array.from({ length: 42 }, (_, index) => `${index + 1}. ${content}`).join('\n\n');
  const artifact = await createDocument({ workspace, format: 'pdf', title, content: paragraphs, sources, now });
  const bytes = await readFile(artifact.path);
  assert.match(bytes.subarray(0, 8).toString(), /^%PDF-/);
  assert.equal(artifact.mimeType, 'application/pdf');
  assert.equal(artifact.sizeBytes, bytes.length);
  assert.equal(artifact.sha256, createHash('sha256').update(bytes).digest('hex'));
  assert.equal(artifact.createdAt, now);
  const pdf = await openPdf(bytes);
  try {
    assert.ok(pdf.pageCount >= 2);
    const extracted = pdf.text({ maxChars: MAX_DOCUMENT_BYTES });
    assert.ok(extracted.includes('ÇĞİÖŞÜçğıöşü'));
    assert.ok(extracted.includes('İşçi, işveren'));
    assert.ok(extracted.includes('Kaynaklar'));
    assert.ok(extracted.replace(/\s/g, '').includes(sources[0].url));
    assert.ok(extracted.includes('E. 2024/1234, K. 2025/5678'));
    assert.ok(extracted.includes('2025-03-14'));
  } finally { pdf.destroy(); }
});

for (const format of ['md', 'txt']) test(`${format} preserves Turkish report, citations and generated timestamp`, async t => {
  const workspace = await fixture(t);
  const first = await createDocument({ workspace, format, title, content, sources, now });
  const second = await createDocument({ workspace, format, title, content, sources, now });
  assert.notEqual(first.path, second.path);
  assert.equal(dirname(first.path), join(workspace, 'reports'));
  assert.match(first.id, /^[a-f0-9]{32}$/);
  assert.match(first.name, new RegExp(`\\.${format}$`));
  const report = await readFile(first.path, 'utf8');
  for (const part of [title, content, now, sources[0].url, sources[0].citation, sources[0].publishedAt]) assert.ok(report.includes(part));
  assert.equal((await lstat(first.path)).nlink, 1);
  if (process.platform !== 'win32') assert.equal((await lstat(first.path)).mode & 0o777, 0o600);
});

test('CSV preserves quoted-comma/multiline row cells and neutralizes formulas before appending report metadata', async t => {
  const workspace = await fixture(t);
  const csv = 'Ad,Açıklama,Tutar\r\n"Çığ şüphesi","Kadın, erkek",42\r\n"İkinci satır","birinci\r\nikinci","=1+1"\r\n';
  const artifact = await createDocument({ workspace, format: 'csv', title, content: csv, sources, now });
  const output = await readFile(artifact.path, 'utf8');
  const expectedBody = '\uFEFF"Ad","Açıklama","Tutar"\r\n"Çığ şüphesi","Kadın, erkek","42"\r\n"İkinci satır","birinci\r\nikinci","\'=1+1"\r\n';
  assert.ok(output.startsWith(expectedBody));
  assert.ok(output.includes('\r\n\r\n"GIDEON rapor bilgileri",""\r\n'));
  assert.ok(output.includes(sources[0].citation));
  assert.ok(output.includes(sources[0].url));
  assert.ok(output.includes(now));
  await assert.rejects(createDocument({ workspace, format: 'csv', title, content: 'Alan,Değer\n"kapanmayan' }), /alıntı/);
});

test('input cap, controls, active-link source schemes and unsupported formats fail before report creation', async t => {
  const workspace = await fixture(t);
  for (const override of [
    { content: 'x'.repeat(MAX_DOCUMENT_BYTES + 1) }, { title: 'başlık\u0000secret' },
    { format: '../outside' }, { sources: [{ title: 'Kaynak', url: 'javascript:alert(1)' }] },
    { sources: [{ title: 'Kaynak', url: 'https://user:secret@example.org/' }] },
  ]) {
    await assert.rejects(createDocument({ workspace, format: 'txt', title, content, ...override }), error => !error.message.includes('secret'));
  }
  assert.deepEqual(await readdir(workspace), []);
});

test('existing reports symlink cannot redirect a generated document', async t => {
  const workspace = await fixture(t);
  const outside = await fixture(t);
  await symlink(outside, join(workspace, 'reports'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(createDocument({ workspace, format: 'txt', title, content }));
  assert.deepEqual(await readdir(outside), []);
});

test('artifact resolver rejects hardlinked or modified content', async t => {
  const workspace = await fixture(t);
  const artifact = await createDocument({ workspace, format: 'txt', title, content });
  assert.deepEqual(await validateArtifact(artifact, workspace), await readFile(artifact.path));
  const otherName = join(workspace, 'linked.txt');
  await link(artifact.path, otherName);
  await assert.rejects(validateArtifact(artifact, workspace));
  await rm(otherName);
  await writeFile(artifact.path, 'different content');
  await assert.rejects(validateArtifact(artifact, workspace));
});

test('expired invocation removes only its new partial artifact', async t => {
  const workspace = await fixture(t); let guards = 0;
  await assert.rejects(createDocument({ workspace, format: 'txt', title, content, assertCurrent() { if (++guards === 4) throw new Error('İstek süresi doldu.'); } }), /süresi doldu/);
  assert.deepEqual(await readdir(join(workspace, 'reports')), []);
});

test('bundled factory hands only its verified report to native managed attachment custody', async t => {
  const workspace = await fixture(t);
  const unrelated = await fixture(t);
  const { factory } = registration(workspace);
  assert.equal(factory.contextVersion, 2);
  let guards = 0;
  const tool = factory.create({ assertInvocationCurrent() { guards++; }, delivery: { send() { throw new Error('Auto external delivery forbidden.'); } } });
  const result = await tool.execute('document-call', { format: 'txt', title, content, sources, workspace: unrelated });
  assert.ok(guards >= 2);
  const { media } = result.details;
  assert.equal(media.trustedLocalMedia, true);
  assert.equal(media.attachments[0].url, media.mediaUrl);
  const path = media.mediaUrl;
  assert.equal(dirname(path), join(workspace, 'reports'));
  assert.match(path, /[a-f0-9]{32}\.txt$/);
  assert.deepEqual(await readdir(unrelated), []);
  assert.equal(createHash('sha256').update(await readFile(path)).digest('hex'), result.details.sha256);
  assert.equal(JSON.stringify(result).includes(unrelated), false);
  await writeFile(path, 'replaced report');
  await assert.rejects(validateArtifact({ ...result.details, path }, workspace));
});

test('GIDEON bundles only its declared tool, preserves foreign targets and records exact source bytes', async t => {
  const runtime = await fixture(t);
  const source = join(runtime, 'extensions', 'gideon-documents');
  await mkdir(dirname(source), { recursive: true });
  await cp(new URL('../extensions/gideon-documents', import.meta.url), source, { recursive: true });
  const host = join(runtime, 'node_modules', 'openclaw');
  await mkdir(host, { recursive: true });
  await writeFile(join(host, 'package.json'), JSON.stringify({ name: 'openclaw', version: '2026.10.3' }));
  const bundled = await installDocumentPlugin(runtime);
  const markerPath = join(bundled, '.gideon-bundled-source.json');
  const markerBytes = await readFile(markerPath);
  const marker = JSON.parse(markerBytes);
  assert.equal(marker.product, 'GIDEON');
  assert.equal(marker.pluginId, 'gideon-documents');
  for (const entry of marker.files) {
    const expected = await readFile(join(source, entry.path));
    assert.deepEqual(await readFile(join(bundled, entry.path)), expected);
    assert.equal(entry.sha256, createHash('sha256').update(expected).digest('hex'));
  }
  assert.equal(await installDocumentPlugin(runtime), bundled);
  assert.deepEqual(await readFile(markerPath), markerBytes);
  await writeFile(join(source, 'index.js'), `${await readFile(join(source, 'index.js'), 'utf8')}\n// Synthetic upgrade fixture.\n`);
  await installDocumentPlugin(runtime);
  assert.deepEqual(await readFile(join(bundled, 'index.js')), await readFile(join(source, 'index.js')));
  await writeFile(join(bundled, 'foreign.txt'), 'User-owned sentinel');
  await assert.rejects(installDocumentPlugin(runtime), /unexpected/);
  assert.equal(await readFile(join(bundled, 'foreign.txt'), 'utf8'), 'User-owned sentinel');
  await rm(join(bundled, 'foreign.txt'));
  await writeFile(join(host, 'package.json'), JSON.stringify({ name: 'openclaw', version: '9999.1.1' }));
  await assert.rejects(installDocumentPlugin(runtime), /pinned/);
});

import { randomBytes, createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, realpath, unlink } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const MAX_DOCUMENT_BYTES = 1024 * 1024;
const formats = Object.freeze({ pdf: 'application/pdf', md: 'text/markdown', txt: 'text/plain', csv: 'text/csv' });
const control = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/;
const oneLineControl = /[\x00-\x1f\x7f]/;
const defaultFont = fileURLToPath(new URL('./assets/DejaVuSans.ttf', import.meta.url));

function text(value, limit, label, multiline = false) {
  if (typeof value !== 'string' || !value.trim() || Buffer.byteLength(value) > limit || (multiline ? control : oneLineControl).test(value)) {
    throw new Error(`Geçerli ve sınır içinde bir ${label} gerekli.`);
  }
  return multiline ? value : value.trim();
}
function validate(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Belge parametreleri geçersiz.');
  if (!Object.hasOwn(formats, input.format)) throw new Error('Belge biçimi pdf, md, txt veya csv olmalı.');
  const title = text(input.title, 800, 'başlık');
  const suppliedContent = text(input.content, MAX_DOCUMENT_BYTES, 'belge içeriği', true);
  const content = input.format === 'csv' ? suppliedContent : suppliedContent.replaceAll('\r\n', '\n').replaceAll('\r', '\n');
  const supplied = input.sources ?? [];
  if (!Array.isArray(supplied) || supplied.length > 64) throw new Error('En fazla 64 kaynak kullanılabilir.');
  const sources = supplied.map(source => {
    if (!source || typeof source !== 'object' || Array.isArray(source)) throw new Error('Kaynak bilgisi geçersiz.');
    const title = text(source.title, 800, 'kaynak başlığı');
    const url = text(source.url, 2048, 'kaynak bağlantısı');
    let parsed;
    try { parsed = new URL(url); } catch { throw new Error('Kaynak bağlantısı geçersiz.'); }
    if (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error('Kaynak bağlantısı HTTP veya HTTPS olmalı.');
    const citation = source.citation === undefined ? undefined : text(source.citation, 2000, 'karar veya madde referansı');
    const publishedAt = source.publishedAt === undefined ? undefined : text(source.publishedAt, 128, 'kaynak tarihi');
    return { title, url: parsed.href, ...(citation ? { citation } : {}), ...(publishedAt ? { publishedAt } : {}) };
  });
  if (Buffer.byteLength(JSON.stringify({ title, content, sources })) > MAX_DOCUMENT_BYTES) throw new Error('Belge girdisi 1 MiB sınırını aşıyor.');
  const date = input.now === undefined ? new Date() : new Date(input.now);
  if (!Number.isFinite(date.getTime())) throw new Error('Belge tarihi geçersiz.');
  return { title, content, sources, format: input.format, createdAt: date.toISOString() };
}

async function safeDirectoryTree(directory) {
  const parts = [];
  for (let current = directory; ; current = dirname(current)) {
    parts.push(current);
    if (dirname(current) === current) break;
  }
  for (const part of parts.reverse()) {
    const stat = await lstat(part);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Belge klasörü normal ve bağlantısız olmalı.');
  }
}
async function reportsDirectory(workspace, assertCurrent) {
  if (typeof workspace !== 'string' || !isAbsolute(workspace)) throw new Error('Belge çalışma alanı mutlak bir klasör olmalı.');
  const root = resolve(workspace);
  await safeDirectoryTree(root);
  const reports = join(root, 'reports');
  assertCurrent?.();
  try { await mkdir(reports, { mode: 0o700 }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
  await safeDirectoryTree(reports);
  return { reports, canonical: await realpath(reports) };
}
function sourceLines(sources) {
  return sources.map((source, index) => `${index + 1}. ${source.title}\n${source.url}${source.citation ? `\nReferans: ${source.citation}` : ''}${source.publishedAt ? `\nKaynak tarihi: ${source.publishedAt}` : ''}`);
}
function csvCell(value) {
  let string = String(value);
  if (/^[\s]*[=+\-@]/.test(string)) string = `'${string}`;
  return `"${string.replaceAll('"', '""')}"`;
}
function csvRows(content) {
  const input = content.replace(/^\uFEFF/, '');
  const rows = []; let row = [], cell = '', quoted = false, afterQuote = false;
  const pushCell = () => { row.push(cell); cell = ''; afterQuote = false; if (row.length > 256) throw new Error('CSV en fazla 256 sütun içerebilir.'); };
  const pushRow = () => { pushCell(); rows.push(row); row = []; if (rows.length > 20_000) throw new Error('CSV en fazla 20000 satır içerebilir.'); };
  for (let i = 0; i < input.length; i++) {
    const character = input[i];
    if (quoted) {
      if (character === '"' && input[i + 1] === '"') { cell += '"'; i++; }
      else if (character === '"') { quoted = false; afterQuote = true; }
      else cell += character;
      continue;
    }
    if (character === ',') { pushCell(); continue; }
    if (character === '\r' || character === '\n') { if (character === '\r' && input[i + 1] === '\n') i++; pushRow(); continue; }
    if (afterQuote) throw new Error('CSV alıntı veya ayraç biçimi geçersiz.');
    if (character === '"') { if (cell.length) throw new Error('CSV alıntı biçimi geçersiz.'); quoted = true; }
    else cell += character;
  }
  if (quoted) throw new Error('CSV içinde kapanmamış alıntı var.');
  if (row.length || cell.length || afterQuote) pushRow();
  if (!rows.length) throw new Error('CSV tablosu boş.');
  return rows;
}
function renderText(document) {
  const { title, createdAt, content, sources, format } = document;
  if (format === 'csv') {
    const rows = [...csvRows(content), [], ['GIDEON rapor bilgileri', ''], ['Başlık', title], ['Oluşturulma tarihi', createdAt]];
    sources.forEach((source, index) => {
      rows.push([`Kaynak ${index + 1}`, source.title], ['Bağlantı', source.url]);
      if (source.citation) rows.push(['Referans', source.citation]);
      if (source.publishedAt) rows.push(['Kaynak tarihi', source.publishedAt]);
    });
    return Buffer.from(`\uFEFF${rows.map(row => row.map(csvCell).join(',')).join('\r\n')}\r\n`, 'utf8');
  }
  const sourcesText = sources.length ? `\n\n${format === 'md' ? '## ' : ''}Kaynaklar\n\n${sourceLines(sources).join('\n\n')}` : '';
  return Buffer.from(`${format === 'md' ? '# ' : ''}${title}\n\nOluşturulma tarihi: ${createdAt}\n\n${content}${sourcesText}\n`, 'utf8');
}
async function renderPdf(document, fontPath) {
  const fontStat = await lstat(fontPath);
  if (!fontStat.isFile() || fontStat.isSymbolicLink()) throw new Error('Gömülü belge yazı tipi okunamıyor.');
  const { default: PDFDocument } = await import('pdfkit');
  return new Promise((fulfill, reject) => {
    const pdf = new PDFDocument({ size: 'A4', margin: 48, compress: true, info: { Title: document.title, Creator: 'GIDEON', CreationDate: new Date(document.createdAt) } });
    const chunks = []; let bytes = 0, pages = 1, settled = false;
    const fail = () => { if (settled) return; settled = true; pdf.destroy(); reject(new Error('PDF sayfa veya 1 MiB çıktı sınırını aşıyor.')); };
    pdf.on('data', chunk => { bytes += chunk.length; if (bytes > MAX_DOCUMENT_BYTES) fail(); else chunks.push(chunk); });
    pdf.on('pageAdded', () => { if (++pages > 200) fail(); });
    pdf.on('error', () => { if (!settled) { settled = true; reject(new Error('PDF oluşturulamadı.')); } });
    pdf.on('end', () => { if (!settled) { settled = true; fulfill(Buffer.concat(chunks)); } });
    try {
      pdf.font(fontPath).fontSize(19).text(document.title);
      pdf.moveDown(0.6).fontSize(9).fillColor('#55616c').text(`Oluşturulma tarihi: ${document.createdAt}`);
      pdf.moveDown().fontSize(11).fillColor('#16212b').text(document.content, { lineGap: 3 });
      if (document.sources.length) {
        pdf.moveDown().fontSize(15).text('Kaynaklar');
        document.sources.forEach((source, index) => {
          pdf.moveDown(0.6).fontSize(11).text(`${index + 1}. ${source.title}`);
          pdf.fontSize(9).fillColor('#245d8a').text(source.url, { link: source.url });
          pdf.fillColor('#16212b');
          if (source.citation) pdf.text(`Referans: ${source.citation}`);
          if (source.publishedAt) pdf.text(`Kaynak tarihi: ${source.publishedAt}`);
        });
      }
      pdf.end();
    } catch { if (!settled) { settled = true; pdf.destroy(); reject(new Error('PDF oluşturulamadı.')); } }
  });
}

/** Creates only a newly named report; never reads a model-selected local file. */
export async function createDocument(input) {
  const document = validate(input);
  const bytes = document.format === 'pdf' ? await renderPdf(document, input.fontPath ?? defaultFont) : renderText(document);
  if (bytes.length > MAX_DOCUMENT_BYTES) throw new Error('Belge çıktısı 1 MiB sınırını aşıyor.');
  input.assertCurrent?.();
  const { reports, canonical } = await reportsDirectory(input.workspace, input.assertCurrent);
  const id = randomBytes(16).toString('hex');
  const path = join(reports, `gideon-${id}.${document.format}`);
  let handle, identity;
  try {
    input.assertCurrent?.();
    handle = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW || 0), 0o600);
    identity = await handle.stat();
    const entry = await lstat(path);
    if (!entry.isFile() || entry.isSymbolicLink() || entry.nlink !== 1 || identity.ino !== entry.ino || identity.dev !== entry.dev) throw new Error('Belge dosyası doğrulanamadı.');
    await safeDirectoryTree(reports);
    if (await realpath(reports) !== canonical) throw new Error('Belge klasörü değişti.');
    input.assertCurrent?.();
    await handle.writeFile(bytes); await handle.sync();
    input.assertCurrent?.();
    await handle.close(); handle = undefined;
    return { id, name: `rapor-${[...document.title.replace(/[<>:"/\\|?*]/g, '-')].slice(0, 72).join('')}.${document.format}`, path, mimeType: formats[document.format], sizeBytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), createdAt: document.createdAt };
  } catch (error) {
    if (handle) await handle.close().catch(() => {});
    if (identity) {
      try { const entry = await lstat(path); if (entry.isFile() && !entry.isSymbolicLink() && entry.nlink === 1 && entry.ino === identity.ino && entry.dev === identity.dev) await unlink(path); } catch {}
    }
    if (error?.code) throw new Error('Belge çalışma alanına yazılamadı.');
    throw error;
  }
}

/** Resolver revalidates ownership and exact bytes; never follows a link. */
export async function validateArtifact(artifact, workspace) {
  if (!artifact || !/^[a-f0-9]{32}$/.test(artifact.id) || !isAbsolute(workspace)) throw new Error('Belge kaydı doğrulanamadı.');
  const reports = join(resolve(workspace), 'reports');
  await safeDirectoryTree(reports);
  if (dirname(artifact.path) !== reports) throw new Error('Belge çalışma alanı dışında.');
  const handle = await open(artifact.path, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  try {
    const stat = await handle.stat(); const entry = await lstat(artifact.path);
    if (!stat.isFile() || entry.isSymbolicLink() || stat.nlink !== 1 || entry.nlink !== 1 || stat.ino !== entry.ino || stat.dev !== entry.dev || stat.size !== artifact.sizeBytes || stat.size > MAX_DOCUMENT_BYTES) throw new Error('Belge dosyası değişti.');
    const bytes = await handle.readFile();
    if (createHash('sha256').update(bytes).digest('hex') !== artifact.sha256) throw new Error('Belge içeriği değişti.');
    return bytes;
  } finally { await handle.close(); }
}

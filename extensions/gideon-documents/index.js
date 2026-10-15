import { definePluginEntry } from 'openclaw/plugin-sdk/plugin-entry';
import { createDocument, validateArtifact } from './documents.js';

export { createDocument } from './documents.js';
const parameters = {
  type: 'object', additionalProperties: false, required: ['format', 'title', 'content'],
  properties: {
    format: { type: 'string', enum: ['pdf', 'md', 'txt', 'csv'] },
    title: { type: 'string', minLength: 1, maxLength: 200 },
    content: { type: 'string', minLength: 1, maxLength: 1048576 },
    sources: { type: 'array', maxItems: 64, items: { type: 'object', additionalProperties: false, required: ['title', 'url'], properties: { title: { type: 'string', maxLength: 200 }, url: { type: 'string', maxLength: 2048 }, citation: { type: 'string', maxLength: 1000 }, publishedAt: { type: 'string', maxLength: 64 } } } },
  },
};

export default definePluginEntry({
  id: 'gideon-documents', name: 'GIDEON Belgeler', description: 'Türkçe PDF ve kaynaklı indirilebilir raporlar.',
  register(api) {
    const workspace = api.pluginConfig?.workspace;
    if (typeof workspace !== 'string') throw new Error('GIDEON belge çalışma alanı gerekli.');
    api.registerTool({ contextVersion: 2, create(context) {
      if (context.sandboxed) return null;
      return {
        name: 'gideon_document',
        description: 'Mevcut sohbet için kaynaklı Türkçe PDF, Markdown, TXT veya CSV raporu oluşturur. Yalnız rapor klasörüne yazar; başka kişilere göndermez. CSV içeriğini geçerli CSV satırları olarak ver; rapor bilgileri ve kaynaklar ayrı son bölüme eklenir. Kaynaklara gerçek bağlantı ve karar/madde referansı ekle.',
        parameters,
        async execute(_id, input, signal) {
          const assertCurrent = () => { context.assertInvocationCurrent(); if (signal?.aborted) throw new Error('Belge isteği iptal edildi.'); };
          const artifact = await createDocument({ workspace, format: input.format, title: input.title, content: input.content, sources: input.sources, assertCurrent });
          assertCurrent();
          await validateArtifact(artifact, workspace);
          assertCurrent();
          return {
            content: [{ type: 'text', text: `Belge hazır: ${artifact.name}. Dosya bu sohbetin eki olarak sunuluyor.` }],
            details: { id: artifact.id, name: artifact.name, mimeType: artifact.mimeType, sizeBytes: artifact.sizeBytes, sha256: artifact.sha256, createdAt: artifact.createdAt, media: { mediaUrl: artifact.path, trustedLocalMedia: true, attachments: [{ url: artifact.path, name: artifact.name, mimeType: artifact.mimeType, sizeBytes: artifact.sizeBytes }] } },
          };
        },
      };
    } }, { name: 'gideon_document' });
  },
});

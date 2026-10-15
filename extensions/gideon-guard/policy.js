import path from 'node:path';
import { lstat, realpath } from 'node:fs/promises';
import { isIP } from 'node:net';
import { fileURLToPath } from 'node:url';

const PROTECTED_FILES = new Set([
  'agents.md', 'soul.md', 'identity.md', 'tools.md', 'user.md',
  'heartbeat.md', 'bootstrap.md', 'boot.md', 'policy.md',
  'openclaw.json', 'openclaw.plugin.json', 'package.json',
]);
const SAFE_TOOLS = new Set([
  'memory_search', 'memory_get', 'session_status', 'sessions_list',
  'sessions_history', 'sessions_search', 'conversations_list', 'talk_voice',
]);
const CRON_READ_ACTIONS = new Set(['status', 'list', 'get', 'runs']);
const CRON_WRITE_ACTIONS = new Set(['add', 'update', 'remove', 'run']);
const CRON_PATCH_FIELDS = new Set([
  'name', 'displayName', 'description', 'schedule', 'payload', 'enabled',
  'deleteAfterRun', 'wakeMode', 'sessionTarget', 'delivery', 'failureAlert',
]);
const PATH_FIELDS = ['path', 'file_path'];
const LEGAL_PORTALS = ['yargitay.gov.tr', 'danistay.gov.tr', 'mevzuat.gov.tr', 'anayasa.gov.tr', 'resmigazete.gov.tr'];
const hasOnly = (record, keys) => Object.keys(record).every((key) => keys.includes(key));
const frozen = (decision, params) => ({ ...decision, params: structuredClone(params) });

const deny = (reason) => ({ block: true, blockReason: reason });
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const safeLabel = (value) => String(value).replace(/[\x00-\x1f\x7f]/g, '').slice(0, 150);

function approval(title, description, severity = 'warning') {
  return {
    requireApproval: {
      title,
      description: description.slice(0, 512),
      severity,
      allowedDecisions: ['allow-once', 'deny'],
      timeoutMs: 120_000,
    },
  };
}

function hasSecret(value) {
  if (typeof value !== 'string') return false;
  if (/\b(?:AIza[\w-]{25,}|sk-[\w-]{16,}|Bearer\s+[\w./+=-]{12,})/iu.test(value)
    || /\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|authorization|secret)\s*[:=]\s*\S{8,}/iu.test(value)) return true;
  // Compare bindings without logging, persisting or returning their values.
  return Object.entries(process.env).some(([name, secret]) => /(?:^|_)(?:TOKEN|SECRET|PASSWORD|API_KEY)(?:_|$)/u.test(name)
    && typeof secret === 'string' && secret.length >= 12 && value.includes(secret));
}

function publicUrl(raw, { httpsOnly = false } = {}) {
  if (typeof raw !== 'string' || raw.length > 4096 || /[\s\\\u0000-\u001f\u007f]/u.test(raw)
    || !/^https?:\/\//iu.test(raw) || hasSecret(raw)) return undefined;
  let url;
  try { url = new URL(raw); } catch { return undefined; }
  if (!['http:', 'https:'].includes(url.protocol) || (httpsOnly && url.protocol !== 'https:')
    || url.username || url.password || (url.port && !['80', '443'].includes(url.port))) return undefined;
  const hostname = url.hostname.toLowerCase().replace(/\.$/u, '');
  // Public research uses DNS names. Reject IP literals, single-label hosts and
  // local namespaces before OpenClaw's DNS/redirect-aware SSRF checks run.
  if (isIP(hostname.replace(/^\[|\]$/gu, '')) || !hostname.includes('.')
    || /(?:^|\.)(?:localhost|local|internal|lan|home|test|invalid)$/u.test(hostname)) return undefined;
  for (const key of url.searchParams.keys()) {
    if (/(?:api[_-]?key|token|password|secret|auth|credential|signature|session|jwt)/iu.test(key) || /^key$/iu.test(key)) return undefined;
  }
  return url;
}

function guardWeb(tool, params) {
  if (tool === 'web_search') {
    if (!hasOnly(params, ['query', 'count', 'country', 'language', 'search_lang', 'ui_lang', 'freshness', 'date_after', 'date_before'])
      || typeof params.query !== 'string' || !params.query.trim() || params.query.length > 3000 || hasSecret(params.query)
      || (params.count !== undefined && (!Number.isInteger(params.count) || params.count < 1 || params.count > 10))) {
      return deny('Arama sorgusu doğrulanamadı; kimlik bilgilerini arama motoruna göndermeyin.');
    }
    if (Object.entries(params).some(([key, value]) => !['query', 'count'].includes(key)
      && (typeof value !== 'string' || value.length > 100 || hasSecret(value)))) return deny('Arama filtreleri doğrulanamadı.');
    for (const match of params.query.matchAll(/https?:\/\/[^\s"'<>]+/giu)) {
      if (!publicUrl(match[0])) return deny('Arama sorgusunda yerel, özel veya kimlik bilgisi içeren adres var.');
    }
    return undefined;
  }
  if (!hasOnly(params, ['url', 'extractMode', 'maxChars']) || !publicUrl(params.url)
    || (params.extractMode !== undefined && !['text', 'markdown'].includes(params.extractMode))
    || (params.maxChars !== undefined && (!Number.isInteger(params.maxChars) || params.maxChars < 1 || params.maxChars > 200_000))) {
    return deny('Web okuması yalnızca kimlik bilgisi içermeyen genel HTTP(S) adreslerinde kullanılabilir.');
  }
  return undefined;
}

async function guardPdf(params, workspace, stateDir) {
  if (params.pages || params.password) {
    return deny('Gemini’nin doğal PDF aracı pages/password desteklemez. Sayfa isteğini prompt içinde belirtin; şifreli PDF için yerelde kilidi açılmış bir kopya gerekir.');
  }
  if (!hasOnly(params, ['pdf', 'pdfs', 'prompt', 'pages', 'password', 'model', 'maxBytesMb'])
    || (params.pdf !== undefined && typeof params.pdf !== 'string')
    || (params.pdfs !== undefined && (!Array.isArray(params.pdfs) || params.pdfs.some((value) => typeof value !== 'string')))
    || (params.prompt !== undefined && (typeof params.prompt !== 'string' || params.prompt.length > 10_000 || hasSecret(params.prompt)))
    || (params.pages !== undefined && (typeof params.pages !== 'string' || !/^[\d, -]{1,200}$/u.test(params.pages)))
    || (params.password !== undefined && (typeof params.password !== 'string' || params.password.length > 1024))
    || (params.model !== undefined && (typeof params.model !== 'string' || !/^google\/[a-zA-Z0-9._-]+$/u.test(params.model)))
    || (params.maxBytesMb !== undefined && (!Number.isFinite(params.maxBytesMb) || params.maxBytesMb <= 0 || params.maxBytesMb > 20))) {
    return deny('PDF okuma parametreleri doğrulanamadı.');
  }
  const inputs = [...new Set([...(params.pdf ? [params.pdf] : []), ...(params.pdfs ?? [])])];
  const normalizedInputs = [];
  if (!inputs.length || inputs.length > 10) return deny('Bir ile on arasında PDF kaynağı belirtin.');
  for (const input of inputs) {
    if (/^https?:/iu.test(input)) {
      if (!publicUrl(input, { httpsOnly: true })) return deny('Uzak PDF yalnızca genel, güvenli HTTPS adresinden okunabilir.');
      normalizedInputs.push(input);
      continue;
    }
    let filename = input;
    let root = workspace;
    if (/^file:/iu.test(input)) {
      try {
        const uri = new URL(input);
        if (uri.hostname || uri.search || uri.hash) return deny('Yerel PDF adresi doğrulanamadı.');
        filename = fileURLToPath(uri);
      } catch { return deny('Yerel PDF adresi doğrulanamadı.'); }
    }
    if (/^media:\/\//iu.test(input)) {
      if (!stateDir || !/^media:\/\/inbound\/[^/?#%\\]+$/u.test(input)) return deny('Gelen PDF kaynağı doğrulanamadı.');
      const id = input.slice('media://inbound/'.length);
      root = path.join(stateDir, 'media', 'inbound');
      filename = path.join(root, id);
    } else if (path.isAbsolute(filename) && stateDir && !outside(path.join(stateDir, 'media', 'inbound'), filename)) {
      root = path.join(stateDir, 'media', 'inbound');
    }
    if (!/\.pdf$/iu.test(filename) || (await validatePath(root, filename, false)).error) {
      return deny('PDF yalnızca kendi çalışma alanınızdan veya yönetilen gelen medya klasöründen okunabilir.');
    }
    try { if (!(await lstat(path.resolve(root, filename))).isFile()) return deny('PDF kaynağı normal bir dosya olmalıdır.'); }
    catch { return deny('PDF kaynağı bulunamadı.'); }
    normalizedInputs.push(path.resolve(root, filename));
  }
  const normalized = { ...params, pdfs: normalizedInputs };
  delete normalized.pdf;
  return { params: normalized };
}

function guardMessage(params) {
  if (!hasOnly(params, ['action', 'channel', 'accountId', 'target', 'message'])
    || params.action !== 'send' || params.channel !== 'whatsapp' || params.accountId !== 'gideon'
    || typeof params.target !== 'string' || !/^\+[1-9]\d{7,14}$/u.test(params.target)
    || typeof params.message !== 'string' || !params.message.trim() || hasSecret(params.message)
    || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u202a-\u202e\u2066-\u2069]/u.test(params.message)) {
    return deny('Yalnızca GIDEON WhatsApp hesabından tek telefon numarasına düz metin mesajı gönderilebilir.');
  }
  const prefix = `WhatsApp alıcısı: ${params.target}\nMesajın tamamı:\n`;
  if (prefix.length + params.message.length > 512) {
    return deny(`Onay paneli mesajın tamamını göstermelidir. Mesajı en fazla ${512 - prefix.length} karakterlik parçalara ayırın; her parça ayrıca onaylanır.`);
  }
  const decision = approval('WhatsApp mesajını gönder', prefix + params.message);
  decision.requireApproval.scope = { kind: 'message-send', target: 'whatsapp', recipientCount: 1, recipients: [params.target], audience: 'external' };
  return frozen(decision, params);
}

function legalPortal(url) {
  return url.hostname === 'emsal.uyap.gov.tr' || LEGAL_PORTALS.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`));
}

async function guardBrowser(params, getBrowserTab) {
  if (!hasOnly(params, ['action', 'target', 'profile', 'targetId', 'targetUrl', 'url', 'label', 'limit', 'maxChars', 'mode', 'snapshotFormat', 'refs', 'interactive', 'compact', 'depth', 'selector', 'timeoutMs', 'request', 'kind', 'ref', 'text', 'submit', 'slowly', 'fields'])
    || (params.target !== undefined && params.target !== 'host')
    || (params.profile !== undefined && params.profile !== 'openclaw')
    || (params.timeoutMs !== undefined && (!Number.isInteger(params.timeoutMs) || params.timeoutMs < 1 || params.timeoutMs > 30_000))) {
    return deny('Tarayıcı yalnızca GIDEON’un ayrı, yönetilen openclaw profilinde kullanılabilir.');
  }
  const canonical = { ...params, target: 'host', profile: 'openclaw' };
  if (['status', 'tabs'].includes(params.action)) {
    if (!hasOnly(params, ['action', 'target', 'profile', 'timeoutMs'])) return deny('Tarayıcı listeleme parametreleri doğrulanamadı.');
    return { params: canonical };
  }
  if (['open', 'navigate'].includes(params.action)) {
    if (!hasOnly(params, ['action', 'target', 'profile', 'targetId', 'targetUrl', 'url', 'label', 'timeoutMs'])
      || (params.targetUrl !== undefined && params.url !== undefined && params.targetUrl !== params.url)
      || !publicUrl(params.targetUrl ?? params.url)) return deny('Tarayıcı yalnızca genel HTTP(S) araştırma sayfalarını açabilir.');
    return { params: canonical };
  }
  let targetId = params.targetId;
  let request;
  if (params.action === 'act') {
    if (params.request !== undefined && !isObject(params.request)) return deny('Tarayıcı işlemi doğrulanamadı.');
    request = { ...(params.request ?? {}) };
    for (const key of ['kind', 'targetId', 'ref', 'text', 'submit', 'slowly', 'fields']) {
      if (params[key] !== undefined) {
        if (request[key] !== undefined && JSON.stringify(request[key]) !== JSON.stringify(params[key])) return deny('Tarayıcı işleminin takma alanları çakışıyor.');
        request[key] = params[key];
      }
    }
    targetId = request.targetId;
    if (!hasOnly(params, ['action', 'target', 'profile', 'timeoutMs', 'request', 'kind', 'targetId', 'ref', 'text', 'submit', 'slowly', 'fields'])
      || !hasOnly(request, ['kind', 'targetId', 'ref', 'text', 'submit', 'slowly', 'fields'])
      || !['click', 'type', 'fill'].includes(request.kind) || request.submit === true) {
      return deny('Tarayıcıda yalnızca sınırlı araştırma formu işlemleri desteklenir; kod, dosya yükleme ve otomatik gönderim kapalı.');
    }
    const kindKeys = request.kind === 'click' ? ['kind', 'targetId', 'ref']
      : request.kind === 'type' ? ['kind', 'targetId', 'ref', 'text', 'submit', 'slowly'] : ['kind', 'targetId', 'fields'];
    if (!hasOnly(request, kindKeys) || (request.submit !== undefined && typeof request.submit !== 'boolean')
      || (request.slowly !== undefined && typeof request.slowly !== 'boolean')) return deny('Tarayıcı işlem alanları doğrulanamadı.');
    if (request.kind === 'fill') {
      if (!Array.isArray(request.fields) || !request.fields.length || request.fields.length > 12
        || request.fields.some((field) => !isObject(field) || !hasOnly(field, ['ref', 'type', 'value'])
          || typeof field.ref !== 'string' || !/^[a-z0-9_-]{1,100}$/iu.test(field.ref) || field.type !== 'text'
          || typeof field.value !== 'string' || field.value.length > 2000 || hasSecret(field.value))) return deny('Araştırma formu alanları doğrulanamadı.');
    } else if (typeof request.ref !== 'string' || !/^[a-z0-9_-]{1,100}$/iu.test(request.ref)
      || (request.kind === 'type' && (typeof request.text !== 'string' || request.text.length > 2000 || hasSecret(request.text)))) {
      return deny('Araştırma formu hedefi veya metni doğrulanamadı.');
    }
  } else if (['snapshot', 'text', 'read'].includes(params.action)) {
    if (!hasOnly(params, ['action', 'target', 'profile', 'targetId', 'maxChars', 'mode', 'snapshotFormat', 'refs', 'interactive', 'compact', 'depth', 'selector', 'timeoutMs'])
      || (params.maxChars !== undefined && (!Number.isInteger(params.maxChars) || params.maxChars < 1 || params.maxChars > 200_000))
      || (params.depth !== undefined && (!Number.isInteger(params.depth) || params.depth < 0 || params.depth > 30))) return deny('Tarayıcı okuma sınırları doğrulanamadı.');
  } else return deny('Bu tarayıcı işlemi GIDEON araştırma alanında desteklenmiyor.');
  if (typeof targetId !== 'string' || !/^[a-z0-9_-]{1,128}$/iu.test(targetId)) return deny('Okunacak tarayıcı sekmesini targetId ile belirtin.');
  let tab;
  try { tab = await getBrowserTab?.(targetId); } catch {}
  const current = tab && typeof tab.targetId === 'string' && [tab.targetId, tab.tabId, tab.suggestedTargetId, tab.label].includes(targetId)
    ? publicUrl(tab.url) : undefined;
  if (!current) return deny('Tarayıcı sekmesinin genel araştırma adresi doğrulanamadı; işlem yapılmadı.');
  if (!request) return { params: { ...canonical, targetId: tab.targetId, action: params.action === 'read' ? 'text' : params.action } };
  if (current.protocol !== 'https:' || !legalPortal(current)) return deny('Form işlemleri yalnızca doğrulanmış resmî HTTPS hukuk araştırma portallarında kullanılabilir.');
  const normalized = { action: 'act', target: 'host', profile: 'openclaw', request: { ...structuredClone(request), targetId: tab.targetId }, ...(params.timeoutMs ? { timeoutMs: params.timeoutMs } : {}) };
  const verb = request.kind === 'click' ? 'tıklanacak' : request.kind === 'type' ? 'metin girilecek' : 'form alanları doldurulacak';
  return frozen(approval('Araştırma formu işlemi', `${current.hostname}${safeLabel(current.pathname)}: ${safeLabel(tab.targetId)} sekmesinde ${verb}. Form davranışı ağ isteği başlatabilir. Gönderim, kayıt veya silme işlemlerini reddedin; alanlar araç çağrısında görülebilir.`), normalized);
}

function outside(root, target) {
  const relative = path.relative(root, target);
  return relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative);
}

function fileArgument(params) {
  const present = PATH_FIELDS.filter((key) => Object.hasOwn(params, key));
  if (!present.length || present.some((key) => typeof params[key] !== 'string')) return null;
  const values = present.map((key) => params[key]);
  return new Set(values).size === 1 ? values[0] : null;
}

// Parse destination headers ourselves: derivedPaths is only a best-effort host hint.
function patchTargets(params) {
  if (typeof params.input !== 'string') return null;
  const lines = params.input.trim().split(/\r?\n/);
  if (lines[0] !== '*** Begin Patch' || lines.at(-1) !== '*** End Patch') return null;
  const targets = [];
  let previousOperation;
  for (const rawLine of lines.slice(1, -1)) {
    // Added/removed/context lines are data, not structural patch headers.
    if (/^[+\- ]/.test(rawLine) && !rawLine.trimStart().startsWith('***')) continue;
    if (rawLine.startsWith('+') || rawLine.startsWith('-')) continue;
    const line = rawLine.trim();
    const marker = /^\*\*\* (Add File|Update File|Delete File|Move to): (.+)$/.exec(line);
    if (marker) {
      if (marker[1] === 'Move to' && previousOperation !== 'Update File') return null;
      targets.push(marker[2]);
      if (marker[1] !== 'Move to') previousOperation = marker[1];
    } else if (line.startsWith('***') && line !== '*** End of File') {
      return null;
    }
  }
  return targets.length ? [...new Set(targets)] : null;
}

async function validatePath(root, raw, mutating) {
  if (typeof raw !== 'string' || !raw.trim() || /[\x00-\x1f\x7f]/.test(raw) || /^[~@]/.test(raw)) {
    return { error: 'Dosya yolu doğrulanamadı.' };
  }
  // Foreign-platform absolute paths and path separators are ambiguous to the executor.
  if (path.sep === '/' && (raw.includes('\\') || /^[a-z]:/i.test(raw))) {
    return { error: 'Dosya yolu bu platformda doğrulanamadı.' };
  }
  const target = path.resolve(root, raw);
  if (target === root || outside(root, target)) {
    return { error: 'GIDEON çalışma alanı dışındaki dosyalara erişemez.' };
  }
  const relative = path.relative(root, target);
  const parts = relative.split(path.sep);
  if (parts.some((part) => /[. ]$/.test(part) || part.includes(':'))) {
    return { error: 'Dosya adındaki platforma bağlı takma adlar desteklenmiyor.' };
  }
  if (parts.some((part) => part.startsWith('.'))) {
    return { error: 'Gizli ayar ve kimlik bilgisi dosyalarına erişim kapalı.' };
  }
  if (mutating && PROTECTED_FILES.has(parts.at(-1).toLowerCase())) {
    return { error: 'GIDEON kendi kimlik, talimat veya güvenlik dosyalarını değiştiremez.' };
  }
  try {
    for (let parent = root; ; parent = path.dirname(parent)) {
      const info = await lstat(parent);
      if (info.isSymbolicLink()) return { error: 'Çalışma alanının üst yolunda sembolik bağlantı var.' };
      if (path.dirname(parent) === parent) break;
    }
    const canonicalRoot = await realpath(root);
    let current = root;
    // Reject every symlink, including one pointing to another file inside the workspace.
    for (let index = 0; index < parts.length; index += 1) {
      current = path.join(current, parts[index]);
      try {
        const info = await lstat(current);
        if (info.isSymbolicLink()) return { error: 'Sembolik bağlantılara erişim kapalı.' };
        if (info.isFile() && info.nlink > 1) return { error: 'Sabit bağlantılara erişim kapalı.' };
        if (index < parts.length - 1 && !info.isDirectory()) {
          return { error: 'Dosya üst dizini doğrulanamadı.' };
        }
        if (index === parts.length - 1 && !info.isFile()) {
          return { error: 'Bu işlem yalnızca normal dosyalarda kullanılabilir.' };
        }
        if (outside(canonicalRoot, await realpath(current))) {
          return { error: 'Dosya çalışma alanının dışında çözümlendi.' };
        }
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
        break; // New files can have parents that have not been created yet.
      }
    }
    return { label: safeLabel(relative) };
  } catch {
    return { error: 'Çalışma alanı veya dosya yolu doğrulanamadı.' };
  }
}

function localReminder(job, agentId) {
  if (!isObject(job) || job.sessionTarget !== 'main') return false;
  if (job.agentId !== undefined && job.agentId !== null && job.agentId !== agentId) return false;
  if (job.effectiveAgentId !== undefined && job.effectiveAgentId !== agentId) return false;
  if (job.sessionKey !== undefined && job.sessionKey !== null && job.sessionKey !== `agent:${agentId}:main`) return false;
  if (!isObject(job.payload) || job.payload.kind !== 'systemEvent' || typeof job.payload.text !== 'string') return false;
  if (Object.keys(job.payload).some((key) => !['kind', 'text'].includes(key))) return false;
  if (job.failureAlert !== undefined && job.failureAlert !== null && job.failureAlert !== false) return false;
  if (job.delivery !== undefined && job.delivery !== null) {
    if (!isObject(job.delivery) || job.delivery.mode !== 'none') return false;
    if (Object.keys(job.delivery).some((key) => key !== 'mode')) return false;
  }
  // Script/condition triggers can execute code outside ordinary agent tool calls.
  if (job.trigger !== undefined || job.pacing !== undefined) return false;
  if (job.owner !== undefined && (!isObject(job.owner)
    || (job.owner.agentId !== undefined && job.owner.agentId !== agentId)
    || (job.owner.sessionKey !== undefined && job.owner.sessionKey !== `agent:${agentId}:main`))) return false;
  if (!isObject(job.schedule) || !['at', 'every', 'cron'].includes(job.schedule.kind)) return false;
  return true;
}

async function guardCron(event, agentId, getJob) {
  const params = event.params;
  if (['gatewayUrl', 'gatewayToken', 'agentId', 'sessionKey'].some((key) => Object.hasOwn(params, key))) {
    return deny('Başka Gateway veya oturumlara erişim kapalı.');
  }
  const action = params.action;
  if (CRON_READ_ACTIONS.has(action)) return undefined;
  if (!CRON_WRITE_ACTIONS.has(action)) return deny('Bu hatırlatıcı işlemi GIDEON tarafından desteklenmiyor.');
  if (action === 'add') {
    if (!isObject(params.job) || params.job.owner !== undefined || !localReminder(params.job, agentId)) {
      return deny('Yalnızca ana sohbete ait yerel systemEvent hatırlatıcıları oluşturulabilir. Dış gönderim ve komut çalıştırma kapalı.');
    }
    return approval('Hatırlatıcı oluştur', 'Ana sohbetinizde yerel bir hatırlatıcı oluşturulacak. İçeriği ve zamanı araç çağrısında inceleyebilirsiniz.');
  }
  const id = params.jobId ?? params.id;
  if (typeof id !== 'string' || !id || (params.jobId && params.id && params.jobId !== params.id)) {
    return deny('Hatırlatıcı kimliği doğrulanamadı.');
  }
  let existing;
  try { existing = await getJob?.(id); } catch { return deny('Hatırlatıcı güvenliği doğrulanamadı; işlem yapılmadı.'); }
  if (!localReminder(existing, agentId)) {
    return deny('Hatırlatıcı yerel ve güvenli olarak doğrulanamadı; işlem yapılmadı.');
  }
  if (action === 'remove') {
    return approval('Hatırlatıcı sil', `Yerel hatırlatıcı ${safeLabel(id)} silinecek.`, 'critical');
  }
  if (action === 'update') {
    if (!isObject(params.job) || Object.keys(params.job).some((key) => !CRON_PATCH_FIELDS.has(key))) {
      return deny('Hatırlatıcı değişiklik alanları doğrulanamadı.');
    }
    const updated = { ...existing, ...params.job };
    if (!localReminder(updated, agentId)) return deny('Dış gönderim veya komut çalıştırmaya dönüşen hatırlatıcı değişiklikleri kapalı.');
  }
  const verb = action === 'update' ? 'değiştirilecek' : 'şimdi çalıştırılacak';
  return approval(action === 'update' ? 'Hatırlatıcı değiştir' : 'Hatırlatıcı çalıştır', `Yerel hatırlatıcı ${safeLabel(id)} ${verb}.`);
}

export function createGuard(config = {}, { getJob, getBrowserTab } = {}) {
  if (typeof config.workspace !== 'string' || !path.isAbsolute(config.workspace)) {
    throw new Error('GIDEON guard requires an absolute workspace path.');
  }
  const workspace = path.resolve(config.workspace);
  const stateDir = typeof config.stateDir === 'string' && path.isAbsolute(config.stateDir) ? path.resolve(config.stateDir) : undefined;
  const agentId = config.agentId ?? 'main';
  if (typeof agentId !== 'string' || !agentId) throw new Error('GIDEON agentId is invalid.');
  return async (event, ctx = {}) => {
    if (!isObject(event) || !isObject(event.params) || ctx.agentId !== agentId) {
      return deny('GIDEON işlem bağlamı doğrulanamadı.');
    }
    const tool = event.toolName;
    if (tool === 'web_search' || tool === 'web_fetch') return guardWeb(tool, event.params);
    if (tool === 'pdf') return guardPdf(event.params, workspace, stateDir);
    if (tool === 'browser') return guardBrowser(event.params, getBrowserTab);
    if (tool === 'message') return guardMessage(event.params);
    // The companion document plugin validates its own new-file paths and never
    // overwrites originals. Generating a requested local document is low impact.
    if (tool === 'gideon_document') return undefined;
    if (tool === 'cron' || tool === 'automations') {
      const decision = await guardCron(event, agentId, getJob);
      // Freeze the arguments validated here, including against an earlier hook rewrite.
      return decision?.requireApproval ? frozen(decision, event.params) : decision;
    }
    if (SAFE_TOOLS.has(tool)) return undefined;
    if (!['read', 'write', 'edit', 'apply_patch'].includes(tool)) {
      return deny('Bu aracın GIDEON içinde kullanılmasına izin verilmiyor.');
    }
    const mutating = tool !== 'read';
    const targets = tool === 'apply_patch' ? patchTargets(event.params) : [fileArgument(event.params)];
    if (!targets?.length || targets.some((target) => typeof target !== 'string')) {
      return deny('İşlemin tüm dosya yolları doğrulanamadı.');
    }
    const validated = [];
    for (const target of targets) {
      const result = await validatePath(workspace, target, mutating);
      if (result.error) return deny(result.error);
      validated.push(result.label);
    }
    if (!mutating) return undefined;
    const action = tool === 'write' ? 'Dosya yaz' : tool === 'edit' ? 'Dosya değiştir' : 'Dosya yamasını uygula';
    const description = `${validated.slice(0, 5).join(', ')}${validated.length > 5 ? ` ve ${validated.length - 5} dosya` : ''}: yerel dosya değişikliği. İçerik araç çağrısında incelenebilir; bu onay yalnızca bu işlem içindir.`;
    return {
      ...approval(action, description, tool === 'apply_patch' && event.params.input.includes('*** Delete File:') ? 'critical' : 'warning'),
      params: structuredClone(event.params),
    };
  };
}

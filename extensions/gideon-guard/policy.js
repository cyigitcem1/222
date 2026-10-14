import path from 'node:path';
import { lstat, realpath } from 'node:fs/promises';

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

export function createGuard(config = {}, { getJob } = {}) {
  if (typeof config.workspace !== 'string' || !path.isAbsolute(config.workspace)) {
    throw new Error('GIDEON guard requires an absolute workspace path.');
  }
  const workspace = path.resolve(config.workspace);
  const agentId = config.agentId ?? 'main';
  if (typeof agentId !== 'string' || !agentId) throw new Error('GIDEON agentId is invalid.');
  return async (event, ctx = {}) => {
    if (!isObject(event) || !isObject(event.params) || ctx.agentId !== agentId) {
      return deny('GIDEON işlem bağlamı doğrulanamadı.');
    }
    const tool = event.toolName;
    if (tool === 'cron' || tool === 'automations') {
      const decision = await guardCron(event, agentId, getJob);
      // Freeze the arguments validated here, including against an earlier hook rewrite.
      return decision?.requireApproval ? { ...decision, params: { ...event.params } } : decision;
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
      params: { ...event.params },
    };
  };
}

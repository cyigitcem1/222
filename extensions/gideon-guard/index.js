import { definePluginEntry } from 'openclaw/plugin-sdk/plugin-entry';
import { createGuard } from './policy.js';

export default definePluginEntry({
  id: 'gideon-guard',
  name: 'GIDEON İşlem Onayı',
  description: 'Dosya, hatırlatıcı, tarayıcı ve WhatsApp işlemlerini sınırlı OpenClaw onayıyla korur.',
  register(api) {
    if (typeof api.on !== 'function') {
      throw new Error('GIDEON requires OpenClaw before_tool_call hooks.');
    }
    const guard = createGuard(api.pluginConfig, {
      async getJob(id) {
        const gateway = api.runtime?.gateway;
        if (typeof gateway?.request !== 'function') {
          throw new Error('OpenClaw cron inspection is unavailable.');
        }
        return gateway.request('cron.get', { id }, { timeoutMs: 5_000 });
      },
      async getBrowserTab(targetId) {
        const gateway = api.runtime?.gateway;
        if (typeof gateway?.request !== 'function') throw new Error('Browser inspection is unavailable.');
        const result = await gateway.request('browser.request', {
          method: 'GET', path: '/tabs', query: { profile: 'openclaw' }, target: 'host',
        }, { timeoutMs: 5_000 });
        if (!Array.isArray(result?.tabs)) throw new Error('Browser targets could not be verified.');
        const matches = result.tabs.filter((tab) => [tab.targetId, tab.tabId, tab.suggestedTargetId, tab.label].includes(targetId));
        if (matches.length !== 1) throw new Error('Browser target is ambiguous or missing.');
        return matches[0];
      },
    });
    api.on('before_tool_call', guard, { priority: 100 });
  },
});

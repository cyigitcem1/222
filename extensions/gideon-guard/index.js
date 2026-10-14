import { definePluginEntry } from 'openclaw/plugin-sdk/plugin-entry';
import { createGuard } from './policy.js';

export default definePluginEntry({
  id: 'gideon-guard',
  name: 'GIDEON İşlem Onayı',
  description: 'Yerel değişiklikleri tek kullanımlık OpenClaw onayıyla korur.',
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
    });
    api.on('before_tool_call', guard, { priority: 100 });
  },
});

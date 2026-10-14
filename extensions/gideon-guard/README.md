# GIDEON işlem koruması

OpenClaw **2026.10.3** için yerel eklentidir. Yeni bir ajan veya hafıza motoru eklemez. `before_tool_call` kancası, dosya değişikliği ve hatırlatıcı işlemlerini OpenClaw'ın `plugin.approval.*` akışına iletir. Yalnızca **bir kez izin ver** veya **reddet** kararları kullanılabilir; bağlantı, karar veya süre aşımı sorunlarında OpenClaw işlemi engeller.

Eklenti `plugins.load.paths` içine bu klasörün mutlak yolu eklenerek yüklenir. `plugins.allow` listesine `gideon-guard` eklenmeli; `plugins.entries.gideon-guard.enabled` `true` ve `config.workspace` GIDEON çalışma alanının mutlak yolu olmalıdır. `config.agentId` varsayılanı `main`'dir. `stateDir` başlatıcıyla uyumluluk için kabul edilir; eklenti kimlik bilgisi dosyalarını okumaz.

Dosya okumaları çalışma alanına sınırlıdır. Gizli dosyalar, sembolik bağlantılar ve çalışma alanının dışı engellenir. Kimlik, talimat ve güvenlik dosyaları ajan tarafından değiştirilemez. `apply_patch` hedefleri, taşıma ve silme hedefleri dahil, eklenti tarafından ayrıca çözümlenir. Onay metni dosya içeriğini veya hatırlatıcı metnini kopyalamaz.

Hatırlatıcılar ana sohbette `payload.kind: systemEvent`, `sessionTarget: main` ve dış gönderim olmadan çalışır. `delivery` kullanılırsa yalnızca `{ "mode": "none" }` kabul edilir. Script, koşul, dış kanal, webhook ve başka ajanlara yönlendirme kapalıdır. `update` ve `run` öncesi mevcut tanım, desteklenen `api.runtime.gateway.request('cron.get', { id })` üzerinden doğrulanır. Bu yetenek yoksa işlem engellenir. `list`, `status`, `get`, `runs` salt okunurdur.

Bu koruma ajan araç çağrılarına uygulanır. Makineye veya yönetici arayüzüne erişen sahibin ayarları/dosyaları doğrudan değiştirmesini engellemez. Yerel dosya sistemi veya yönetici tarafından onay beklerken yapılan eşzamanlı değişiklikler bir işletim sistemi güvenlik sınırı değildir; çalışma alanını yalnızca güvenilen kullanıcılarla paylaşın.

Doğrulanan resmi kaynaklar:

- [Araç politikası kancaları](https://github.com/openclaw/openclaw/blob/v2026.10.3/docs/plugins/hooks/tool-policy.md)
- [Yerel eklenti onayları](https://github.com/openclaw/openclaw/blob/v2026.10.3/docs/plugins/plugin-permission-requests.md)
- [Eklenti oluşturma](https://github.com/openclaw/openclaw/blob/v2026.10.3/docs/plugins/building-plugins.md)
- [Zamanlayıcı çalışma biçimi](https://github.com/openclaw/openclaw/blob/v2026.10.3/docs/automation/cron-jobs/how-it-works.md)

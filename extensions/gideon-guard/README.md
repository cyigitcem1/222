# GIDEON işlem koruması

OpenClaw **2026.10.3** için yerel eklentidir. Yeni bir ajan veya hafıza motoru eklemez. `before_tool_call` kancası, dosya değişikliği, hatırlatıcı, araştırma formu ve WhatsApp işlemlerini OpenClaw'ın `plugin.approval.*` akışına iletir. Yalnızca **bir kez izin ver** veya **reddet** kararları kullanılabilir; bağlantı, karar veya süre aşımı sorunlarında OpenClaw işlemi engeller. Onay bekleyen parametreler kopyalanır; sonradan başka numara, metin veya dosya seçilemez.

Eklenti `plugins.load.paths` içine bu klasörün mutlak yolu eklenerek yüklenir. `plugins.allow` listesine `gideon-guard` eklenmeli; `plugins.entries.gideon-guard.enabled` `true` ve `config.workspace` GIDEON çalışma alanının mutlak yolu olmalıdır. `config.agentId` varsayılanı `main`'dir. `stateDir` yönetilen `media/inbound` PDF kaynaklarını doğrular; eklenti kimlik bilgisi dosyalarını okumaz.

Dosya okumaları çalışma alanına sınırlıdır. Gizli dosyalar, sembolik bağlantılar ve çalışma alanının dışı engellenir. Kimlik, talimat ve güvenlik dosyaları ajan tarafından değiştirilemez. `apply_patch` hedefleri, taşıma ve silme hedefleri dahil, eklenti tarafından ayrıca çözümlenir. Onay metni dosya içeriğini veya hatırlatıcı metnini kopyalamaz.

Hatırlatıcılar ana sohbette `payload.kind: systemEvent`, `sessionTarget: main` ve dış gönderim olmadan çalışır. `delivery` kullanılırsa yalnızca `{ "mode": "none" }` kabul edilir. Script, koşul, dış kanal, webhook ve başka ajanlara yönlendirme kapalıdır. `update` ve `run` öncesi mevcut tanım, desteklenen `api.runtime.gateway.request('cron.get', { id })` üzerinden doğrulanır. Bu yetenek yoksa işlem engellenir. `list`, `status`, `get`, `runs` salt okunurdur.

`web_search` ve `web_fetch` genel araştırmada kullanılabilir. Kimlik bilgisi içeren URL’ler, yerel ağ adresleri, IP adresleri ve özel host adları araç çağrısından önce reddedilir. Anahtar biçimleri ve mevcut süreçteki gizli ortam değişkenleri dışarı gönderilecek metinlerde kontrol edilir; değerleri yazdırılmaz. OpenClaw’ın DNS, yönlendirme ve özel ağ kontrolleri ayrıca açık tutulmalıdır; eklenti bu kontrollerin yerine geçmez.

Yerel `pdf` kaynakları çalışma alanındaki bağımsız PDF dosyalarına veya `${stateDir}/media/inbound` içine sınırlıdır. `pdf`/`pdfs`, `media://inbound/<dosya.pdf>`, güvenli yerel `file://` adresleri ve genel HTTPS PDF adresleri desteklenir; yerel yollar mutlak yola dönüştürülür. Üst dizinler dahil sembolik bağlantılar, sabit bağlantılar, gizli dosyalar ve kimlik bilgisi dizinleri reddedilir. Google’ın doğal PDF işleminde `pages` ve `password` kullanımı OpenClaw tarafından desteklenmez. İstenen yeni yerel belgeyi oluşturan `gideon_document` araç çağrısı ek onay istemez; belge eklentisi kendi dizin sınırlarını doğrular ve mevcut dosyaları değiştirmez.

Tarayıcı yalnızca makinedeki ayrı `openclaw` profiliyle kullanılır; kişisel Chrome profili, uzak node ve dashboard yönlendirmeleri kabul edilmez. Genel HTTP(S) sayfalarında açma, yönlenme, durum ve sekme listesi kullanılabilir. `snapshot`/`text` okumaları ile form işlemlerinde gerçek sekme adresi `browser.request` üzerinden yeniden doğrulanır; belirsiz sekmeler reddedilir. Resmî Yargıtay, Danıştay, Mevzuat, Anayasa Mahkemesi, Resmî Gazete ve `emsal.uyap.gov.tr` HTTPS sayfalarında sınırlı `click`, `type`, `fill` işlemleri her seferinde onay ister. Metin girmek JavaScript üzerinden ağ isteği başlatabileceği için `submit:false` onayın yerine geçmez. Kod çalıştırma, yükleme, indirme, diyalog onayı, koordinat tıklaması ve toplu işlemler kapalıdır. `browser.evaluateEnabled:false` ve özel ağ engeli korunmalıdır; onay sırasında kullanıcı tarafından değişen sayfa ve arka plan ağ trafiği için tam bir ağ izolasyonu garantisi verilmez.

WhatsApp mesajı yalnızca bağlı `gideon` hesabından tek E.164 numarasına düz metin olarak gönderilebilir:

```json
{"action":"send","channel":"whatsapp","accountId":"gideon","target":"+15551234567","message":"Yalnızca sentetik örnek."}
```

Alıcı ve mesajın tamamı tek kullanımlık onay paneline konur. Resmî `before_tool_call` onay açıklaması 512 karakterle sınırlıdır; daha uzun metin, alıcı/açıklama uzunluğuna göre reddedilir ve ayrı onaylanacak kısa parçalara bölünmesi istenir. Metin sessizce kesilmez. Toplu gönderim, grup, başka hesap/kanal, medya ve gizli alternatif gönderim alanları engellenir. WhatsApp kanalında `dmPolicy:disabled`, `groupPolicy:disabled`, `selfChatMode:false`, `configWrites:false` kullanılarak kendiliğinden yanıt üretimi kapalı tutulmalıdır. Eklenti hesabı bağlamaz veya onay gelmeden mesaj göndermez.

Bu koruma ajan araç çağrılarına uygulanır. Makineye veya yönetici arayüzüne erişen sahibin ayarları/dosyaları doğrudan değiştirmesini engellemez. Yerel dosya sistemi veya yönetici tarafından onay beklerken yapılan eşzamanlı değişiklikler bir işletim sistemi güvenlik sınırı değildir; çalışma alanını yalnızca güvenilen kullanıcılarla paylaşın.

Doğrulanan resmi kaynaklar:

- [Araç politikası kancaları](https://github.com/openclaw/openclaw/blob/v2026.10.3/docs/plugins/hooks/tool-policy.md)
- [Yerel eklenti onayları](https://github.com/openclaw/openclaw/blob/v2026.10.3/docs/plugins/plugin-permission-requests.md)
- [Eklenti oluşturma](https://github.com/openclaw/openclaw/blob/v2026.10.3/docs/plugins/building-plugins.md)
- [Zamanlayıcı çalışma biçimi](https://github.com/openclaw/openclaw/blob/v2026.10.3/docs/automation/cron-jobs/how-it-works.md)
- [PDF aracı](https://github.com/openclaw/openclaw/blob/v2026.10.3/docs/tools/pdf.md)
- [Tarayıcı güvenliği](https://github.com/openclaw/openclaw/blob/v2026.10.3/docs/tools/browser/configuration.md)
- [WhatsApp kanalı](https://github.com/openclaw/openclaw/blob/v2026.10.3/docs/channels/whatsapp.md)

# GIDEON 0.2.4 — araştırma, dosya üretimi ve kalıcı profil

[**GIDEON-0.2.4-Kurulum.exe dosyasını indir**](https://github.com/cyigitcem1/222/releases/download/v0.2.4/GIDEON-0.2.4-Kurulum.exe) · Windows x64 · 320,2 MB

**Yayımlandı ve gerçek indirme dosyasının tamamı doğrulandı.** Kaynaklı araştırma, indirilebilir raporlar, onaylı WhatsApp mesajları ve kişisel veriyi koruyan Windows güncellemesi. [Yayın sayfası](https://github.com/cyigitcem1/222/releases/tag/v0.2.4).

İndirilen dosya **320.153.552 bayt**; SHA-256: `452c98e794237c7625d6752d3b70ba8900b23f8cfcce2da942cee9c8714d41e2`. Bu özet aynı yayından indirilen `SHA256SUMS.txt` kaydıyla eşleşti. `PACKAGED-SOURCES.json` sürüm **0.2.4**, kaynak kaydı **46.705**; seçilen 26 proje kaynağı/eklenti/yazı tipi hash'i ayrıca karşılaştırıldı. Bu denetim Electron'un her kök destek dosyasının tek tek hash'inin kontrol edildiği veya GIDEON yayıncı imzası bulunduğu anlamına gelmez.

## Eklenen işlevler

- Gemini destekli web araması, özgün sayfa okuma ve Google'ın doğal PDF okuma yolu. Hukuki araştırmada kararın özgün metni, esas/karar numarası, tarih ve resmi kaynak bağlantısı birlikte aranır; arama özeti belge okuma sayılmaz.
- Gerçek **PDF, Markdown, TXT ve CSV** dosyası oluşturan `gideon_document` aracı. Türkçe PDF yazı tipi paket içindedir. İstenen yeni rapor ek onay istemez; çıktı yeni dosyaya yazılır, mevcut belge değiştirilmez. Gerçek OpenClaw WebChat akışındaki PDF eki ve kimlik doğrulamalı indirme doğrulandı.
- Ayrı OpenClaw profiliyle yönetilen tarayıcı. Sayfa okuma araştırma içindir; desteklenen resmi hukuk sitelerindeki form etkileşimleri tek kullanımlık işlem onayı ister.
- Resmi `@openclaw/whatsapp` **2026.10.3** eklentisi. Kullanıcının QR kodunu okuttuğu `gideon` hesabından tek açık telefon numarasına kısa düz metin gönderilir. Alıcı ve mesajın tamamı her defasında onaylanır. Uzun metin sessizce kesilmez; ayrı onaylanacak kısa parçalara ayrılması istenir. Grup, toplu gönderim, arama, medya gönderimi ve gelen mesajlara otomatik yanıt kapalıdır.
- Yeni profillerde **`google/gemini-3.5-flash`** metin modeli. Arama/PDF işlemleri aynı Google API erişimini kullanır; mevcut kullanıcının model seçimi değiştirilmez.

## Güncelleme ve hafıza

Program dosyaları ile kişisel veri ayrıdır. Konuşmalar, hafıza notları, raporlar ve profil `%APPDATA%\GIDEON\state` içinde; Windows hesabıyla şifrelenmiş anahtar `%APPDATA%\GIDEON\credentials.bin` içinde tutulur. Yeni program sürümü için veri klasörünü silmek gerekmez. Yeni bilgi veya ayar eklemek için yeniden kurulum gerekmez; kod güncellemesi yeni kurulum dosyasıyla uygulanır. Otomatik uygulama güncelleyicisi eklenmemiştir.

0.2.3 profilinden geçiş mevcut model seçimini, erişim token'ını ve kullanıcı verisini korur. Gerçek Windows yükseltmesi; eski konuşmalar, notlar ve DPAPI anahtarıyla doğrulandı. Eski fabrika talimatı yalnızca bilinen özgün içerikle birebir eşleşiyorsa yenilenir; değişmeden önce özel bir yedeği alınır. Kişiselleştirilmiş talimatlar üzerine yazılmaz. Güncellemeden önce önemli arşivin şifreli yedeğini alın ve aynı Windows hesabını kullanın.

OpenClaw, Google Live'ın kesinleştirdiği kullanıcı ve asistan sözlerini etkin konuşmanın SQLite kaydına işler. Arayüz sabit kayıt kimliğiyle yeniden dener ve kapatırken bekleyen kesinleşmiş kayıtları tamamlamaya çalışır. Henüz kesinleşmemiş sözler geçicidir; tek söz kaydı 8.000 karakterle sınırlıdır. Gerçek bir saatlik Gemini Live görüşmesinin tamamının uzun vadeli hafızada kalması henüz uçtan uca doğrulanmadı. Önemli bilgileri onaylı hafıza notuna dönüştürün; görüşme bitince kaydı kontrol edin.

## Bağlantı için kullanıcı adımı

Gemini için erişim yetkisi ve kotası bulunan API anahtarı gerekir. Mevcut anahtar tekrar kullanılabilir; tüketici Gemini/ChatGPT aboneliği API ücretini otomatik karşılamaz.

WhatsApp'ı bağlamak için panelde QR akışını açın; iPhone'da **WhatsApp → Ayarlar → Bağlı Cihazlar → Cihaz Bağla** seçeneğiyle okutun. Bu adım tamamlanmadan hesap bağlanmış veya mesaj gönderilmiş sayılmaz. GIDEON ve bilgisayar açık olmalıdır. Bu kanal, iPhone'un GIDEON paneline dışarıdan erişimini kendiliğinden açmaz; telefon erişimi için ayrıca güvenli HTTPS/Tailscale kurulumu ve kullanıcı girişi gerekir.

## Doğrulama durumu

**85 birim testi ve 12 entegrasyon kontrolü** [temiz GitHub ortamında](https://github.com/cyigitcem1/222/actions/runs/38696555844/job/116294351027), [`5ee1c10` kaynak sürümünde](https://github.com/cyigitcem1/222/commit/5ee1c10) geçti. Gerçek SQLite deposundaki 120 mesaj, eski Windows fabrika talimatları, notlar, raporlar ve anahtar dosyası yükseltme/tekrar kurulum testleriyle korundu. Gerçek Talk kayıt yolunda 120 kesinleşmiş sentetik konuşma parçası, iki konuşmacı, tekrar denemelerde tekilleştirme, kapanış ve yeniden başlatma sonrasında doğrulandı. Bu son kontrol gerçek mikrofon veya Google ses hizmeti kullanmadı.

Gerçek Gateway/WebChat entegrasyonu yerel bir test sağlayıcısıyla doğrulandı: `chat.send`, `gideon_document` aracını çalıştırdı; PDF eki gerçek `chat.history` sonucunda yer aldı; kimlik doğrulamalı HTTP indirmesi üretilen dosyayla bayt bayt aynı çıktı. Kimlik doğrulamasız istek `401`, yanlış konuşma ve sahte ek adresleri `404` döndürdü. Gateway yeniden başlatılınca aynı adres aynı dosyayı verdi. Bu test, Windows arayüzünde indirme düğmesine tıklama veya gerçek Gemini çağrısı değildir.

**Gerçek Windows ana dal denetimi geçti:** [Windows işi](https://github.com/cyigitcem1/222/actions/runs/38696555844/job/116295515780) motor, Türkçe PDF okuma/render, kurulu görünür arayüz, ikinci açılış, kaynak sağlama toplamları, Windows DPAPI ve kaldırma kontrollerini doğruladı. Yayımlanmış **0.2.3 → 0.2.4** yükseltmesi 15 Ekim 2026 Türkiye saatiyle **10:17:14–10:29:08** arasında geçti: SQLite'taki 60 dakikaya yayılan 61 sentetik kullanıcı mesajı, notlar, kişisel `USER.md`, model seçimi, Gateway token'ı ve eski Windows anahtarının çözülmesi korundu. Bu sentetik arşiv testi gerçek bir saatlik ses görüşmesi değildir.

**Etiket yayını ve indirme denetimi de geçti:** [`v0.2.4` etiketinin](https://github.com/cyigitcem1/222/tree/v0.2.4) [temiz kontrol işi](https://github.com/cyigitcem1/222/actions/runs/38697912257/job/116298775575) **85 birim ve 12 entegrasyon testini**, [Windows işi](https://github.com/cyigitcem1/222/actions/runs/38697912257/job/116299520065) aynı motor/PDF/kurulum/yükseltme/arayüz/DPAPI/kaldırma denetimlerini geçti. Etiketin gerçek yükseltme kontrolü 15 Ekim 2026 Türkiye saatiyle **10:27:05–10:38:59**, yayın **10:38:59–10:39:13** arasında tamamlandı; Windows işi **10:39:50**'de başarılı bitti. Yayınlanan EXE, `SHA256SUMS.txt` ve `PACKAGED-SOURCES.json` ayrıca indirildi; EXE'nin tamamının SHA-256 özeti doğrulandı. `PACKAGED-SOURCES.json` paketlenen kaynakların, `SHA256SUMS.txt` ise indirilebilir dosyaların bütünlük kaydıdır.

Bu geliştirme ortamında gerçek Gemini yanıtı, ücretli Google Search/PDF API çağrısı, gerçek WhatsApp hesabı ve gönderimi, mikrofon, bir saatlik canlı ses veya dışarıdan iPhone bağlantısı denenmedi. Kamu hukuk sitelerine istekler kaynak sunucuya ulaşmadan bulut proxy'sinde `CONNECT 403` ile engellendi; bu durum sitelerin kendisinin erişilemez olduğunu kanıtlamaz. Canlı hukuki araştırma başarılı olarak işaretlenmez.

[Araştırma, dosyalar ve WhatsApp](ARASTIRMA-VE-BAGLANTILAR.md) · [Masaüstü kullanımı](MASAUSTU.md) · [Güvenlik](GUVENLIK.md)

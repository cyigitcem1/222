# GIDEON 0.2.4 — araştırma, dosya üretimi ve kalıcı profil

Kaynaklı araştırma, indirilebilir raporlar, onaylı WhatsApp mesajları ve kişisel veriyi koruyan Windows güncellemesi. Kurulum dosyası `GIDEON-0.2.4-Kurulum.exe`; dosya bütünlüğü aynı yayındaki `SHA256SUMS.txt` ile kontrol edilir.

## Eklenen işlevler

- Gemini destekli web araması, özgün sayfa okuma ve Google'ın doğal PDF okuma yolu. Hukuki araştırmada kararın özgün metni, esas/karar numarası, tarih ve resmi kaynak bağlantısı birlikte aranır; arama özeti belge okuma sayılmaz.
- Gerçek **PDF, Markdown, TXT ve CSV** dosyası oluşturan `gideon_document` aracı. Türkçe PDF yazı tipi paket içindedir. İstenen yeni rapor ek onay istemez; çıktı yeni dosyaya yazılır, mevcut belge değiştirilmez. Gerçek OpenClaw WebChat akışındaki PDF eki ve kimlik doğrulamalı indirme doğrulandı.
- Ayrı OpenClaw profiliyle yönetilen tarayıcı. Sayfa okuma araştırma içindir; desteklenen resmi hukuk sitelerindeki form etkileşimleri tek kullanımlık işlem onayı ister.
- Resmi `@openclaw/whatsapp` **2026.10.3** eklentisi. Kullanıcının QR kodunu okuttuğu `gideon` hesabından tek açık telefon numarasına kısa düz metin gönderilir. Alıcı ve mesajın tamamı her defasında onaylanır. Uzun metin sessizce kesilmez; ayrı onaylanacak kısa parçalara ayrılması istenir. Grup, toplu gönderim, arama, medya gönderimi ve gelen mesajlara otomatik yanıt kapalıdır.
- Yeni profillerde **`google/gemini-3.5-flash`** metin modeli. Arama/PDF işlemleri aynı Google API erişimini kullanır; mevcut kullanıcının model seçimi değiştirilmez.

## Güncelleme ve hafıza

Program dosyaları ile kişisel veri ayrıdır. Konuşmalar, hafıza notları, raporlar ve profil `%APPDATA%\GIDEON\state` içinde; Windows hesabıyla şifrelenmiş anahtar `%APPDATA%\GIDEON\credentials.bin` içinde tutulur. Yeni program sürümü için veri klasörünü silmek gerekmez. Yeni bilgi veya ayar eklemek için yeniden kurulum gerekmez; kod güncellemesi yeni kurulum dosyasıyla uygulanır. Otomatik uygulama güncelleyicisi eklenmemiştir.

0.2.3 profilinden geçiş, mevcut model seçimini, erişim token'ını ve kullanıcı verisini koruyacak şekilde hazırlanır. Eski fabrika talimatı yalnızca bilinen özgün içerikle birebir eşleşiyorsa yenilenir; değişmeden önce özel bir yedeği alınır. Kişiselleştirilmiş talimatlar üzerine yazılmaz. Güncellemeden önce önemli arşivin şifreli yedeğini alın ve aynı Windows hesabını kullanın.

OpenClaw, Google Live'ın kesinleştirdiği kullanıcı ve asistan sözlerini etkin konuşmanın SQLite kaydına işler. Arayüz sabit kayıt kimliğiyle yeniden dener ve kapatırken bekleyen kesinleşmiş kayıtları tamamlamaya çalışır. Henüz kesinleşmemiş sözler geçicidir; tek söz kaydı 8.000 karakterle sınırlıdır. Gerçek bir saatlik Gemini Live görüşmesinin tamamının uzun vadeli hafızada kalması henüz uçtan uca doğrulanmadı. Önemli bilgileri onaylı hafıza notuna dönüştürün; görüşme bitince kaydı kontrol edin.

## Bağlantı için kullanıcı adımı

Gemini için erişim yetkisi ve kotası bulunan API anahtarı gerekir. Mevcut anahtar tekrar kullanılabilir; tüketici Gemini/ChatGPT aboneliği API ücretini otomatik karşılamaz.

WhatsApp'ı bağlamak için panelde QR akışını açın; iPhone'da **WhatsApp → Ayarlar → Bağlı Cihazlar → Cihaz Bağla** seçeneğiyle okutun. Bu adım tamamlanmadan hesap bağlanmış veya mesaj gönderilmiş sayılmaz. GIDEON ve bilgisayar açık olmalıdır. Bu kanal, iPhone'un GIDEON paneline dışarıdan erişimini kendiliğinden açmaz; telefon erişimi için ayrıca güvenli HTTPS/Tailscale kurulumu ve kullanıcı girişi gerekir.

## Doğrulama durumu

**85 birim testi ve 12 entegrasyon kontrolü** temiz GitHub ortamında geçti. Gerçek SQLite deposundaki 120 mesaj, eski Windows fabrika talimatları, notlar, raporlar ve anahtar dosyası yükseltme/tekrar kurulum testleriyle korundu. Gerçek Talk kayıt yolunda 120 kesinleşmiş sentetik konuşma parçası, iki konuşmacı, tekrar denemelerde tekilleştirme, kapanış ve yeniden başlatma sonrasında doğrulandı. Bu son kontrol gerçek mikrofon veya Google ses hizmeti kullanmadı.

Gerçek Gateway/WebChat entegrasyonu yerel bir test sağlayıcısıyla doğrulandı: `chat.send`, `gideon_document` aracını çalıştırdı; PDF eki gerçek `chat.history` sonucunda yer aldı; kimlik doğrulamalı HTTP indirmesi üretilen dosyayla bayt bayt aynı çıktı. Kimlik doğrulamasız istek `401`, yanlış konuşma ve sahte ek adresleri `404` döndürdü. Gateway yeniden başlatılınca aynı adres aynı dosyayı verdi. Bu test, Windows arayüzünde indirme düğmesine tıklama veya gerçek Gemini çağrısı değildir.

**Windows yayın koşulları:** Yayın akışı, bu etiketten oluşturduğu gerçek paketi; Windows motoru, Türkçe PDF okuma/render, görünür arayüz, ikinci açılış, Windows şifreli anahtar saklama, yayımlanmış 0.2.3'ten yükseltme, bir saatlik sentetik konuşma veritabanı ve notların korunması, kaynak sağlama toplamları ve kaldırma kontrolleri geçmeden paylaşmaz. `PACKAGED-SOURCES.json` paketlenen kaynakların, `SHA256SUMS.txt` ise indirilebilir dosyaların bütünlük kaydıdır. [Yayın akışı](https://github.com/cyigitcem1/222/actions/workflows/desktop-release.yml).

Bu geliştirme ortamında gerçek Gemini yanıtı, ücretli Google Search/PDF API çağrısı, gerçek WhatsApp hesabı ve gönderimi, mikrofon, bir saatlik canlı ses veya dışarıdan iPhone bağlantısı denenmedi. Kamu hukuk sitelerine istekler kaynak sunucuya ulaşmadan bulut proxy'sinde `CONNECT 403` ile engellendi; bu durum sitelerin kendisinin erişilemez olduğunu kanıtlamaz. Canlı hukuki araştırma başarılı olarak işaretlenmez.

[Araştırma, dosyalar ve WhatsApp](ARASTIRMA-VE-BAGLANTILAR.md) · [Masaüstü kullanımı](MASAUSTU.md) · [Güvenlik](GUVENLIK.md)

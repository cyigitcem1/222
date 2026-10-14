# Teslim doğrulaması — 14 Ekim 2026

Çalıştırılan ortam: Linux x64 bulut, Node.js 24.19.0, npm 11.9.0, resmî OpenClaw 2026.10.3. Gerçek kullanıcı cihazına veya mevcut Windows OpenClaw kurulumuna erişilmedi. Test içerikleri sentetiktir.

## Geçen kontroller

- `npm ci --cache /workspace/.npm-cache --no-fund --no-audit`: kilit dosyasıyla kurulum başarılı; paket/TLS doğrulaması kapatılmadı.
- `npm run setup`: gerçek OpenClaw şemasıyla başarılı. Tekrar kurulum kişisel notları ve erişim token'ını koruyor; yabancı kurulum ve bağlantılı dosyalar reddediliyor.
- `npm test`: **55 test geçti**, sıfır başarısız veya atlanan test: 27 temel profil/izin/yedek testi, 26 masaüstü kontrolcü testi ve 2 masaüstü adres seçimi testi. Kontrolcü testlerinde güvenli saklama ve çocuk süreç adaptörleri taklit edilir; gerçek Windows DPAPI başarı kanıtı değildir. Onay politikası testleri araç çağrısı kancasında çalışır; gerçek kullanıcının onay ekranına tıklaması ayrıca test edilmelidir.
- `npm run test:integration`: **7 temel entegrasyon alt kontrolü ve 1 masaüstü motor testi geçti**; Node raporunda üst testle birlikte toplam **9 test**, sıfır başarısız veya atlanan test. Son çalışma yaklaşık 94 saniye sürdü. Resmî Gateway kullanıldı; model yanıtları taklit edilmedi ve ücretli model isteği yapılmadı.
- `npm run start:cloud`: hizmet başlatıldı; gerçek kimlik doğrulamalı sağlık kontrolü başarılı. Tekrar çalıştırıldığında mevcut hizmet kullanıldı.
- `npm run doctor`: Node, sabitlenmiş OpenClaw, yapılandırma, Gateway ve yerel hafıza başarılı. Gemini ortam anahtarı eksik; canlı API ve mikrofon test edilmedi.
- `git diff --check`: başarılı.

Masaüstü motorunun ayrı entegrasyon testi gerçek Linux Gateway'ini açtı, kimlik doğrulamalı bağlantıyı doğruladı ve özel kapanış kanalıyla hizmeti durdurdu (**1 test geçti**). Ücretli Gemini isteği yapılmadı. Chromium'da ilk açılış, anahtar kaydetme/açma, hata durumu ve anahtarı kaldırma olmak üzere **4 arayüz akışı** taklit edilmiş bağlantı durumlarıyla geçti; bu, paketlenmiş Windows uygulamasının çalıştırılması değildir.

Entegrasyon kontrolleri: şema ve gerçek `gideon-guard` yüklemesi; panelin sunulması ve yetkisiz araç çağrısının 401 ile reddi; üç gerçek oturumda sentetik metinlerin saklanması; notların ve transkriptlerin resmî FTS aramasından bulunması; resmî cron deposuna kapalı test görevi eklenmesi; yeniden başlatma sonrası bu üç transkript/not/görevin korunması; gerçek OpenClaw verilerinin şifreli yedekten doğrulanarak geri yüklenmesi.

Yedeklerde 8 MiB veritabanı boyutunda içerik, yanlış parola, bozulma, zararlı yollar ve üzerine yazma sınırları ayrıca test edildi. Gerçek SQLite dosyalarının geri yüklenmesinde bulunan büyük base64 doğrulama hatası düzeltildi; ilgili test yeniden geçti.

Resmî `security audit --json`: **0 kritik**, **1 uyarı**, **1 bilgi**. Uyarı yapılandırılmamış ters proxy güveniyle ilgili; paket yalnızca localhost'ta çalışıyor ve ters proxy yayımlaması yapılmadı. Mobil/yayımlanmış Gateway için ayrı kurulum gerekir. Bulutun dosya izleyicisi native watch yerine resmî polling davranışına geçti; hizmet hazır ve bağlantı kontrolleri başarılı.

## Canlı doğrulanmayanlar

Gemini API yanıtı, Türkçe beş dakikalık çift yönlü ses ve söz kesme, gerçek modelin kişilik/hafıza davranışı, kullanıcının onay ekranında kabul/ret akışı, zamanı gelen bildirimin gerçek kullanıcıya teslimi, Windows başlatıcısı ve mikrofonu, telefon/HTTPS erişimi, Google Calendar/e-posta, otomatik maliyet raporu ve üç yıllık işletim. Bunlar yerel test başarısıyla tamamlanmış sayılmaz; ilgili kabul adımları KABUL-TESTLERI.md içindedir.

Masaüstünün gerçek Windows arayüz açılışı, DPAPI anahtar saklama/okuma, tek pencere davranışı ve Electron mikrofon izni çalıştırılmadı. Windows 2025 üzerinde CI kontrolü çalıştırıldı: Microsoft imzaları ve VC 14.51 sürümü, uygulama klasöründeki DLL yükleme yolu, Windows yerel dosya sistemi bağlaması, gerçek Gateway açılışı, kimlik doğrulamalı bağlantı, doğal 0 çıkışı, kilit temizliği ve portun kapanması geçti. Miras alınan Node derleme önbelleği de bu kontrolde vardı. [Gerçek Windows kontrolü](https://github.com/cyigitcem1/222/actions/runs/38543158138/job/115783160761) 14 Ekim 2026 tarihinde başarılı oldu. Bu, Electron arayüzüne tıklama veya DPAPI testi değildir. Portable paket yayıncı sertifikasıyla imzalı değildir. GitHub sürüm sayfasının belgede bulunması tek başına dosyanın yayımlandığını kanıtlamaz; yayın sonucu ayrı doğrulanmalıdır.

## Kaydedilen bulut ayarları

`install_script`, `start_skill` ve `GEMINI_API_KEY` gereksinimi taslak olarak kaydedildi. Gizli değer sağlanmadı. Anahtarın HTTPS hedefi `generativelanguage.googleapis.com` erişim listesine eklendi. Bu kayıtlar scriptleri çalıştırmaz, anahtar oluşturmaz veya ortamı yayımlamaz. Ortam ayarlarında değişiklikleri inceleyip kaydetmek, anahtarı güvenli alana girmek ve bulut ortamını yayımlamak kullanıcı adımlarıdır. Yeni görevde snapshot geri yüklemesi bağımsız olarak henüz doğrulanmadı.

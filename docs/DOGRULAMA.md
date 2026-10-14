# Teslim doğrulaması — 0.2.2, 14 Ekim 2026

Çalıştırılan ortam: Linux x64 bulut, Node.js 24.19.0, npm 11.9.0, resmî OpenClaw 2026.10.3. Gerçek kullanıcı cihazına veya mevcut Windows OpenClaw kurulumuna erişilmedi. Test içerikleri sentetiktir.

## Windows açılış tanısı ve 0.2.2 dağıtımı

Windows kullanıcısı uygulamaya çift tıklandığında pencere görünmediğini bildirdi. İlk inceleme kullanıcı veri klasörü ve pencere yükleme sırasına odaklandı. Gerçek eski EXE denemesinde ilk pencere açıldığı için, kullanıcı klasörü hazırlığının eksikliği doğrulanmış kök neden olarak kabul edilmedi.

[0.2.0 gerçek Windows tanısı](https://github.com/cyigitcem1/222/actions/runs/38575800650/job/115892435787): İlk görünür pencere, welcome ekranı ve sandbox IPC **270 saniyede** doğrulandı. İkinci taşınabilir açılıştan sonra ilk çalışan uygulamanın `runtime/scripts/gideon.mjs` ve `node/node.exe` dosyalarının kaybolduğu doğrulandı; kaynak bütünlüğü kontrolü başarısız oldu. Bu, ilk pencerenin hiç açılmadığı iddiasını bu CI ortamında desteklemiyor; ikinci açılışta çalışma dosyalarının korunmadığını gösteriyor.

0.2.1, `%APPDATA%\GIDEON` klasörünü önceden hazırlama, görünür başlangıç penceresi, `loadFile` sonucunu bekleme, hazırlık görseli ve taşınabilir açılışlarda ayrı geçici klasör ayarlarını ekledi. Bu değişiklikler mevcut veriyi veya kayıtlı anahtarı silmez; ancak taşınabilir paketin tüm kabul kontrollerini geçtiği anlamına gelmez.

İlk açılış davranışı için dört regresyon testi eklendi. Linux'ta son çalışmada **59 birim ve 9 entegrasyon testinin tamamı başarılı**, sıfır başarısız veya atlanan test. Bu kontroller [4a22061 kaynak sürümünde](https://github.com/cyigitcem1/222/commit/4a22061) uygulandı.

[0.2.1 ilk Windows denemesi](https://github.com/cyigitcem1/222/actions/runs/38575800552/job/115893557361): Gerçek renderer, welcome ekranı ve sandbox köprüsü doğrulandı. Pencereyi inceleyen yardımcı komutun ilk soğuk UIAutomation çağrısı 20 saniyelik sınırı aştığı için test tamamlanamadı. Hata tanısında gerçek, görünür **1024 × 720 GIDEON penceresi** bulundu. Yardımcı kontrol normal CIM/User32 sorgusu ve 30 saniyelik sınırlı süreyle düzenlendi; ürünün GPU veya güvenlik ayarları değiştirilmedi.

Sonraki iki gerçek Windows çalışmasında **çıkarılmış uygulama EXE'sinin görünür arayüzü, ikinci açılışı, DPAPI şifreleme/okuma ve doğal kapanışı yaklaşık 38 saniyede geçti**. Taşınabilir 0.2.1 dosyasının ilk arayüzü yaklaşık **289 saniyede** göründü; ikinci başlatıcının doğal kapanışı için ayrılan **300 saniye** dolunca test onu SIGTERM ile durdurdu. Doğal kapanış kontrolü başarısız olduğu için **v0.2.1 yayın işi durdu ve paket yayımlanmadı**. Bu son hata ikinci uygulama süreci ile taşınabilir başlatıcının çıkarma/temizlik davranışını tek başına ayırmaz; kesin alt neden iddiası yapılmaz.

0.2.2 için önerilen dağıtım **GIDEON-0.2.2-Kurulum.exe** oldu. Kullanıcı hesabına bir kez kurulan NSIS paketinde sonraki masaüstü kısayolu açılışları aynı kurulu dosyaları kullanır; büyük motor arşivi her açılışta tekrar çıkarılmaz. `%APPDATA%\GIDEON` verisi korunur, kurulum yönetici yetkisi istemez.

**Beklemede:** Gerçek 0.2.2 kurulumunun çalıştırılması, masaüstü kısayolunun kurulu EXE'ye işaret etmesi, bu EXE'nin görünür arayüz/ikinci açılış/DPAPI/doğal kapanış denetimleri ve aynı değişmeyen paket içeriğinin Windows motor kontrolü. Yayın iş akışı bunların tamamı geçmeden sürümü yayımlamaz. Önceki çıkarılmış EXE veya Node/Gateway başarıları yeni kurulumun kabulü yerine geçmez.

## Geçen yerel kontroller

- `npm ci --cache /workspace/.npm-cache --no-fund --no-audit`: kilit dosyasıyla kurulum başarılı; paket/TLS doğrulaması kapatılmadı.
- `npm run setup`: gerçek OpenClaw şemasıyla başarılı. Tekrar kurulum kişisel notları ve erişim token'ını koruyor; yabancı kurulum ve bağlantılı dosyalar reddediliyor.
- `npm test`: **59 test geçti**, sıfır başarısız veya atlanan test: 27 temel profil/izin/yedek testi, 26 masaüstü kontrolcü testi, 2 masaüstü adres seçimi testi ve 4 ilk açılış regresyon testi. Kontrolcü testlerinde güvenli saklama ve çocuk süreç adaptörleri taklit edilir; gerçek Windows DPAPI başarı kanıtı değildir. Onay politikası testleri araç çağrısı kancasında çalışır; gerçek kullanıcının onay ekranına tıklaması ayrıca test edilmelidir.
- `npm run test:integration`: **7 temel entegrasyon alt kontrolü ve 1 masaüstü motor testi geçti**; Node raporunda üst testle birlikte toplam **9 test**, sıfır başarısız veya atlanan test. Son çalışma yaklaşık 93 saniye sürdü. Resmî Gateway kullanıldı; model yanıtları taklit edilmedi ve ücretli model isteği yapılmadı.
- `npm run start:cloud`: hizmet başlatıldı; gerçek kimlik doğrulamalı sağlık kontrolü başarılı. Tekrar çalıştırıldığında mevcut hizmet kullanıldı.
- `npm run doctor`: Node, sabitlenmiş OpenClaw, yapılandırma, Gateway ve yerel hafıza başarılı. Gemini ortam anahtarı eksik; canlı API ve mikrofon test edilmedi.
- `git diff --check`: başarılı.

Masaüstü motorunun ayrı entegrasyon testi gerçek Linux Gateway'ini açtı, kimlik doğrulamalı bağlantıyı doğruladı ve özel kapanış kanalıyla hizmeti durdurdu (**1 test geçti**). Ücretli Gemini isteği yapılmadı. Chromium'da ilk açılış, anahtar kaydetme/açma, hata durumu ve anahtarı kaldırma olmak üzere **4 arayüz akışı** taklit edilmiş bağlantı durumlarıyla geçti; bu, paketlenmiş Windows uygulamasının çalıştırılması değildir.

Entegrasyon kontrolleri: şema ve gerçek `gideon-guard` yüklemesi; panelin sunulması ve yetkisiz araç çağrısının 401 ile reddi; üç gerçek oturumda sentetik metinlerin saklanması; notların ve transkriptlerin resmî FTS aramasından bulunması; resmî cron deposuna kapalı test görevi eklenmesi; yeniden başlatma sonrası bu üç transkript/not/görevin korunması; gerçek OpenClaw verilerinin şifreli yedekten doğrulanarak geri yüklenmesi.

Yedeklerde 8 MiB veritabanı boyutunda içerik, yanlış parola, bozulma, zararlı yollar ve üzerine yazma sınırları ayrıca test edildi. Gerçek SQLite dosyalarının geri yüklenmesinde bulunan büyük base64 doğrulama hatası düzeltildi; ilgili test yeniden geçti.

Resmî `security audit --json`: **0 kritik**, **1 uyarı**, **1 bilgi**. Uyarı yapılandırılmamış ters proxy güveniyle ilgili; paket yalnızca localhost'ta çalışıyor ve ters proxy yayımlaması yapılmadı. Mobil/yayımlanmış Gateway için ayrı kurulum gerekir. Bulutun dosya izleyicisi native watch yerine resmî polling davranışına geçti; hizmet hazır ve bağlantı kontrolleri başarılı.

## Canlı doğrulanmayanlar

Gemini API yanıtı, Türkçe beş dakikalık çift yönlü ses ve söz kesme, gerçek modelin kişilik/hafıza davranışı, kullanıcının onay ekranında kabul/ret akışı, zamanı gelen bildirimin gerçek kullanıcıya teslimi, Windows mikrofonu, telefon/HTTPS erişimi, Google Calendar/e-posta, otomatik maliyet raporu ve üç yıllık işletim. Bunlar yerel test başarısıyla tamamlanmış sayılmaz; ilgili kabul adımları KABUL-TESTLERI.md içindedir.

0.2.2 kurulumunun tam denetimi yukarıdaki durumdadır; Electron mikrofon izni çalıştırılmadı. Önceki Windows 2025 CI kontrolünde Microsoft imzaları ve VC 14.51 sürümü, uygulama klasöründeki DLL yükleme yolu, Windows yerel dosya sistemi bağlaması, gerçek Gateway açılışı, kimlik doğrulamalı bağlantı, doğal 0 çıkışı, kilit temizliği ve portun kapanması geçti. Miras alınan Node derleme önbelleği de bu kontrolde vardı. [Önceki Windows motor kontrolü](https://github.com/cyigitcem1/222/actions/runs/38543158138/job/115783160761) 14 Ekim 2026 tarihinde başarılı oldu. Bu, yeni kurulumun arayüz veya DPAPI testi değildir. GIDEON yayıncı sertifikasıyla imzalı değildir. GitHub sürüm sayfasının belgede bulunması tek başına dosyanın yayımlandığını kanıtlamaz; yayın sonucu ayrı doğrulanmalıdır.

## Kaydedilen bulut ayarları

`install_script`, `start_skill` ve `GEMINI_API_KEY` gereksinimi taslak olarak kaydedildi. Gizli değer sağlanmadı. Anahtarın HTTPS hedefi `generativelanguage.googleapis.com` erişim listesine eklendi. Bu kayıtlar scriptleri çalıştırmaz, anahtar oluşturmaz veya ortamı yayımlamaz. Ortam ayarlarında değişiklikleri inceleyip kaydetmek, anahtarı güvenli alana girmek ve bulut ortamını yayımlamak kullanıcı adımlarıdır. Yeni görevde snapshot geri yüklemesi bağımsız olarak henüz doğrulanmadı.

# GIDEON masaüstü

Windows x64 için tek dosya: **GIDEON-0.2.1-Windows.exe**. [Yayın sayfası](https://github.com/cyigitcem1/222/releases/latest). Dosyaya çift tıklayın. Node ve OpenClaw dosyanın içindedir; komut satırı, npm paket kurulumu ve yönetici kurulumu gerekmez. Dosyaların hazırlanması bilgisayara göre birkaç dakika sürebilir; bu sırada başlangıç görseli gösterilir.

0.2.0'ın gerçek Windows denemesinde ilk pencere açıldı; ikinci tıklama açık uygulamanın motor dosyalarını kaldırdı. 0.2.1 her taşınabilir açılış için ayrı geçici klasör kullanır. GIDEON kullanıcı klasörü önce hazırlanır, başlangıç penceresi görünür açılır ve arayüz dosyasının yüklenmesi beklenir. Var olan notlar, konuşmalar ve şifreli anahtar üzerine yazılmaz; güncelleme için veri klasörünü silmeyin.

## İlk açılış

1. Dosyayı açın.
2. Gemini bağlantı anahtarınızı kutuya girin. Yoksa **Anahtar al** düğmesi Google'ın sayfasını açar.
3. **Kaydet ve aç** düğmesine basın.

Sonraki açılışlarda aynı dosyaya çift tıklamak yeterlidir. Program kendi hizmetini açar ve resmî OpenClaw sohbet penceresini getirir. Gemini/ChatGPT uygulama aboneliği API ücretini kapsadığı varsayılmaz; Google hesabınızdaki kota/ücret geçerlidir.

## Kullanım

- Yazılı sohbet için konuşma penceresindeki mesaj kutusunu kullanın.
- Ses için canlı ses bölümünü açıp mikrofon izni verin. Kamera izni kapalıdır. Windows'un mikrofon gizlilik ayarları da izin vermelidir.
- Anahtar değişikliği için üstte **GIDEON → Bağlantı ayarları** menüsünü açın.
- Programı kapatınca kendisinin başlattığı yerel hizmet durur; başka OpenClaw veya programları kapatmaz.
- İlk açılışta varsayılan adres doluysa boş bir yerel adres seçilir. Önceden kurulmuş GIDEON profilinde adres çakışırsa eski adres korunur ve hata gösterilir; başka hizmet kapatılmaz.

Programınıza ikinci kez tıklarsanız yeni bir hizmet açmak yerine mevcut pencere öne gelir. İnternet veya sağlayıcı hatası bir konuşmanın başarılı olduğu anlamına gelmez; panel hata durumunu gösterebilir. Gemini bağlantısı yalnızca gerçekten yanıt alınırsa doğrulanmış olur.

## Verileriniz

Kişisel veriler `%APPDATA%\GIDEON` klasöründe, OpenClaw notları ve konuşmaları bunun `state` alt klasöründe tutulur. Anahtar `credentials.bin` içinde Windows DPAPI ile şifrelenir; anahtar değeri ayar ekranına geri gönderilmez. Düz metin saklama alternatifi yoktur. Dosyayı farklı bir Windows hesabına veya bilgisayara taşımak, anahtarın o cihazda açılacağını garanti etmez; yeniden girmeniz gerekebilir.

Kalıcı notlar ve asıl konuşmalar resmî OpenClaw veri alanındadır. Önceki bilgisayar kurulumunun konuşmaları kendiliğinden birleştirilmez. Yıllarca saklama için düzenli yedek ve geri yükleme kontrolü hâlâ gerekir.

## Doğrulama sınırları

Linux'ta 59 birim ve 9 entegrasyon testi geçti. Arayüzün dört akışı Chromium'da taklit edilmiş bağlantı durumlarıyla; kontrolcünün anahtar/güvenlik/hata/başlatma işlemleri birim testlerinde; motorun açılışı ve düzgün kapanması gerçek OpenClaw ile Linux'ta test edildi. Sonuçların kapsamı [doğrulama raporunda](DOGRULAMA.md).

Önceki sürümün Windows 2025 CI kontrolünde Microsoft imzaları, yerel DLL yükleme, gerçek Gateway açılışı, kimlik doğrulamalı bağlantı ve düzgün kapanış geçti. 0.2.1'in gerçek Windows başlangıç arayüzü ve sandbox bağlantısı görüldü; ilk test, pencereyi denetleyen yardımcı komutun zaman aşımı nedeniyle tamamlanamadı. **Yeni taşınabilir dosyanın ikinci tıklama/kaynak bütünlüğü ve DPAPI saklama/okuma kontrolü beklemede.** Mikrofon izni, Gemini yanıtı ve kesintisiz Türkçe ses görüşmesi çalıştırılmadı. Windows ARM veya 32 bit paket sunulmaz. Telefon erişimi ve arka planda sürekli dinleme bu masaüstü dosyasının tamamlanmış özellikleri değildir.

GIDEON uygulamasının yayıncı sertifikası yoktur. Windows ek güvenlik kontrolü gösterebilir. Windows korumalarını kapatmayın; dosyanın kaynağını doğrulamadan çalıştırmayın.

Geliştiriciler için üretim komutu: `node scripts/build-desktop.mjs`. Resmî Node/Electron SHA256 manifestleri, Microsoft kaynak/hash/imza kontrolleri ve npm kilit bütünlüğü korunur. Windows derlemesi PowerShell 7 ve tam 7-Zip gerektirir; indirilen uygulama bunları gerektirmez. Varsayılan çıktı taşınabilir Windows EXE'dir; isteğe bağlı NSIS kurulum dosyası yalnızca Windows derleme ortamında üretilir. Yerel derleme dışarı yayın yapmaz; GitHub Actions sürüm etiketiyle testlerden sonra yayınlar.

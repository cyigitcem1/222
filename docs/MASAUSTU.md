# GIDEON masaüstü

[**GIDEON-0.2.3-Kurulum.exe dosyasını indir**](https://github.com/cyigitcem1/222/releases/download/v0.2.3/GIDEON-0.2.3-Kurulum.exe) · 300,8 MB · [Yayın sayfası](https://github.com/cyigitcem1/222/releases/tag/v0.2.3)

Windows x64 sürümü **yayımlandı**. Gerçek Windows kurulum denetimleri geçti; yayınlanan dosya indirilip SHA-256 bütünlüğü doğrulandı. Dosyaya çift tıklayın; program Windows hesabınıza otomatik kurulur ve açılır. Node ve OpenClaw paketin içindedir; komut satırı, npm paket kurulumu ve yönetici kurulumu gerekmez. İlk kurulum bilgisayara göre birkaç dakika sürebilir.

Kurulum sürümü, dosyaları bir kez kurup sonraki kullanımlarda doğrudan kurulu uygulamayı açar. Taşınabilir 0.2.1 ve kurulum 0.2.2 paketlerinin yayın kontrolleri başarısız olmuştu; 0.2.3'ün gerçek kurulum, kısayol ve kaldırma kontrolleri geçti. Var olan notlar, konuşmalar ve şifreli anahtar üzerine yazılmaz; güncelleme için veri klasörünü silmeyin.

## 0.2.4 kaynak sürümündeki yenilikler

Web araması, özgün sayfa/PDF okuma, yönetilen tarayıcı, kaynaklı PDF/Markdown/TXT/CSV üretimi ve onaylı kısa WhatsApp gönderimi ekleniyor. Yeni profiller Gemini 3.5 Flash ile başlar; mevcut profilinizin modeli korunur. **0.2.4 Windows kurulumunun yayın doğrulaması henüz tamamlanmadı; üstteki 0.2.3 dosyası bu özellikleri içermez.** [0.2.4 sürüm notları](RELEASE-0.2.4.md).

“Şu konuyu araştır; kararın özgün metnini ve mevzuatı oku; kaynaklı PDF ver” diyebilirsiniz. Yeni rapor üretimi ek onay istemez; araç mevcut dosyalarınızın üzerine yazmaz. Gerçek OpenClaw WebChat akışında dosya eki, kimlik doğrulamalı indirme ve yeniden başlatmadan sonra aynı dosyanın korunması test edildi; Windows yayını denetimleri bekleniyor. Kaynağa erişilemediğinde gerçek belge okunmuş gibi sonuç verilmemelidir. [Araştırma ve dosya kullanımı](ARASTIRMA-VE-BAGLANTILAR.md).

WhatsApp için panelde hesabı QR koduyla bağlayın; iPhone'da **WhatsApp → Ayarlar → Bağlı Cihazlar → Cihaz Bağla** yolunu kullanın. Bağlantıdan sonra açık telefon numarası ve tam mesajı belirtin. Alıcı ve kısa metin her gönderimde tek kullanımlık onay ister. Otomatik gelen mesaj yanıtı, grup gönderimi, arama veya başka alıcıya dosya gönderimi açık değildir. QR okutulmadan hesap bağlı sayılmaz; kurulum sizin yerinize telefondaki bu adımı tamamlayamaz.

## İlk açılış

1. Yayınlanan **GIDEON-0.2.3-Kurulum.exe** dosyasına çift tıklayıp kurulumun bitmesini bekleyin; GIDEON otomatik açılır.
2. Gemini bağlantı anahtarınızı kutuya girin. Yoksa **Anahtar al** düğmesi Google'ın sayfasını açar.
3. **Kaydet ve aç** düğmesine basın.

Sonraki açılışlarda masaüstündeki **GIDEON** simgesine çift tıklayın. Kurulum dosyasını yeniden açmanız gerekmez; büyük arşiv her kullanımda tekrar açılmaz. Program kendi hizmetini açar ve resmî OpenClaw sohbet penceresini getirir. Gemini/ChatGPT uygulama aboneliği API ücretini kapsadığı varsayılmaz; Google hesabınızdaki kota/ücret geçerlidir.

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

## Hafızayı koruyarak güncelleme

Yeni bilgi, görev veya uygulama ayarı için yeniden kurulum gerekmez. Program kodu yenilendiğinde GIDEON'u kapatıp yeni sürümün kurulum dosyasını çalıştırın; aynı Windows hesabını kullanın ve `%APPDATA%\GIDEON` klasörünü koruyun. Uygulama dosyaları yenilenirken kişisel veri klasörü ayrı kalır. Bu sürüm otomatik güncelleme indirmez.

0.2.4 geçişi eski profilin model seçimini, Gateway token'ını, notlarını, konuşma kayıtlarını ve şifreli anahtarını koruyacak şekilde hazırlanır. Yalnızca tanınan eski fabrika talimatları yenilenir; önceki hâli özel yedekte tutulur. Kendi değiştirdiğiniz talimatlar korunur. Üretim ve güncelleme denetiminin güncel durumu [sürüm notlarındadır](RELEASE-0.2.4.md).

Önemli bilgiyi “Bunu kesin hafızaya kaydet” diyerek onaylı nota dönüştürün ve yeni konuşmada kaynağıyla hatırlamasını deneyin. OpenClaw, Google Live'ın kesinleştirdiği kullanıcı ve asistan sözlerini etkin konuşmanın SQLite kaydına işler; henüz tamamlanmamış konuşma geçicidir. Bir saatlik gerçek Gemini Live görüşmesinin tüm dökümünün kalıcı kaldığı henüz uçtan uca test edilmedi; görüşme bitince kaydı kontrol edin. Uygulamayı güncellemeden önce önemli verinin şifreli yedeğini alın.

## Doğrulama sınırları

Linux'ta 59 birim ve 9 entegrasyon testi geçti. Arayüzün dört akışı Chromium'da taklit edilmiş bağlantı durumlarıyla; kontrolcünün anahtar/güvenlik/hata/başlatma işlemleri birim testlerinde; motorun açılışı ve düzgün kapanması gerçek OpenClaw ile Linux'ta test edildi. Sonuçların kapsamı [doğrulama raporunda](DOGRULAMA.md).

**0.2.3 gerçek Windows denetimleri geçti:** Kullanıcı kurulumu, kaynak manifestindeki dosyaların sağlama toplamları ve Electron/Node EXE ile runtime manifestinin uyumu, masaüstü/başlat menüsü kısayollarının kanonik hedefleri, görünür arayüz, ikinci açılış, DPAPI şifreleme/okuma ve doğal kapanış. Kaldırma uygulama klasörünü, kayıtlarını ve kısayollarını temizledi; kişisel veriyi temsil eden test kaydı korundu. Aynı paket içeriğinin Windows motor/Gateway denetimi de başarılıydı. [Yayınlanan sürümün tam test kanıtı](https://github.com/cyigitcem1/222/actions/runs/38597935731/job/115970366916). Mikrofon izni, Gemini yanıtı ve kesintisiz Türkçe ses görüşmesi çalıştırılmadı. Windows ARM veya 32 bit paket sunulmaz. Telefon erişimi ve arka planda sürekli dinleme bu masaüstü dosyasının tamamlanmış özellikleri değildir.

GIDEON uygulamasının yayıncı sertifikası yoktur. Windows ek güvenlik kontrolü gösterebilir. Windows korumalarını kapatmayın; dosyanın kaynağını doğrulamadan çalıştırmayın.

Geliştiriciler için önerilen Windows üretim komutu: `node scripts/build-desktop.mjs --installer-only`. Resmî Node/Electron SHA256 manifestleri, Microsoft kaynak/hash/imza kontrolleri ve npm kilit bütünlüğü korunur. Windows derlemesi PowerShell 7 ve tam 7-Zip gerektirir; indirilen uygulama bunları gerektirmez. Önerilen dağıtım, yalnızca kullanıcının hesabına kurulan NSIS paketidir. Yerel derleme dışarı yayın yapmaz; GitHub Actions gerçek kurulum, kurulu uygulama ve aynı paketin Windows motor denetimleri geçtikten sonra yayınlar.

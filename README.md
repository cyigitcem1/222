# GIDEON

## Windows masaüstü — bir kez kurun, simgeden açın

[**GIDEON 0.2.3 Windows kurulumunu indir**](https://github.com/cyigitcem1/222/releases/download/v0.2.3/GIDEON-0.2.3-Kurulum.exe) · 300,8 MB · [Sürüm sayfası](https://github.com/cyigitcem1/222/releases/tag/v0.2.3)

**Yayımlandı.** Gerçek Windows kurulum denetimleri geçti; yayınlanan dosya indirilip tamamının SHA-256 bütünlüğü doğrulandı.

Kurulum dosyasına çift tıklayın. Program Windows hesabınıza otomatik kurulur ve açılır; yönetici kurulumu, Node veya terminal gerekmez. İlk kurulum birkaç dakika sürebilir. GIDEON penceresinde Gemini API anahtarınızı bir kez girip **Kaydet ve aç** seçeneğine basın.

Sonraki açılışlarda masaüstündeki **GIDEON** simgesini kullanın. Uygulama kurulu dosyalarından açılır; her kullanımda büyük arşivi tekrar hazırlamaz. Önceki GIDEON notları, konuşmaları ve kayıtlı anahtar korunur; güncelleme için veri klasörünü silmeyin.

Anahtar Windows hesabınızla şifrelenir. Kişisel veriler uygulama dosyasının yanında tutulmaz; `%APPDATA%\GIDEON` altında kalır. **GIDEON → Bağlantı ayarları** menüsünden anahtarınızı değiştirebilir veya kaldırabilirsiniz. Programı kapatınca yalnızca kendisinin açtığı hizmet kapanır. İlk açılışta başka bir program aynı adresi kullanıyorsa otomatik boş adres seçilir; var olan profilin adresi sessizce değiştirilmez.

**0.2.3'ün gerçek Windows kurulumu, kısayolları, kurulu arayüzü, ikinci açılışı, DPAPI anahtar saklama/okuma ve düzgün kapanışı doğrulandı.** Kaldırma uygulama dosyalarını temizledi ve kişisel veriyi temsil eden test kaydını korudu. [Windows test kanıtı](https://github.com/cyigitcem1/222/actions/runs/38596089277/job/115963939428). Gemini ve mikrofon testi yapılmadı. Paket yayıncı sertifikasıyla imzalı değildir; Windows ek güvenlik onayı gösterebilir. [Masaüstü kullanım notları](docs/MASAUSTU.md).

GIDEON, OpenClaw üzerinde çalışan Türkçe kişisel yardımcıdır. Resmî OpenClaw panelinde yazılı sohbet ve Google Live Voice, kalıcı konuşma kayıtları, kaynaklı hafıza araması ve onaylı yerel hatırlatmalar için hazırlanmıştır. Kimliği ve davranış kuralları tek `main` ajanında tutulur; kişisel bilgiler ilk kurulumda boş bırakılır.

Bu paket OpenClaw **2026.10.3** sürümünü kullanır. Bilgisayarınızdaki mevcut OpenClaw dosyaları üzerine yazmaz. Masaüstü verisi `%APPDATA%\GIDEON\state` içindedir; aşağıdaki kaynak komutları ise proje içindeki ayrı `.gideon/` profilini ve varsayılan `127.0.0.1:18799` adresini kullanır. Mevcut `18789` kurulumu ayrı kalır. GIDEON eski konuşmalarınızı kendiliğinden içe aktarmaz.

## 0.2.4 kaynak sürümü: araştırma, gerçek dosyalar ve onaylı WhatsApp

Bu depodaki **0.2.4 değişiklikleri**, web araması, özgün sayfa/PDF okuma, yönetilen tarayıcı ve kaynaklı **PDF, Markdown, TXT, CSV** üretimini ekler. “Bu konuyu araştır; özgün Yargıtay kararını ve mevzuatı oku; kaynaklarıyla PDF olarak ver” isteği bu araçlarla yürütülür. Belge aracı gerçek bir dosya oluşturur; yalnızca PDF'ye kopyalanacak metin üretmez. İstediğiniz yeni rapor ek onay istemez, mevcut dosyalarınızın üzerine yazılmaz. Gerçek OpenClaw WebChat akışında PDF eki ve kimlik doğrulamalı indirme, yeniden başlatmadan sonra aynı dosyanın korunmasıyla birlikte test edildi; Windows yayınının denetimleri bekleniyor. [Araştırma ve dosya kullanımı](docs/ARASTIRMA-VE-BAGLANTILAR.md).

WhatsApp hesabı panelde QR koduyla bağlanır. GIDEON yalnızca açıkça belirtilen numaraya kısa metin gönderebilir; alıcı ve metnin tamamı her gönderimden önce onay kartında görünür. Gelen WhatsApp mesajlarına otomatik yanıt, grup gönderimi, arama ve başka kişiye dosya gönderme bu profilin kapsamında değildir. Gerçek hesap bağlantısı için QR kodunu telefonunuzdan okutmanız gerekir.

Yeni profillerin metin modeli **`google/gemini-3.5-flash`** olur; mevcut profilinizin model seçimi korunur. Arama ve PDF işlemleri de aynı Gemini API erişimini kullanır. Google hesabındaki model erişimi ve kota geçerli olmaya devam eder.

**0.2.4 Windows yayını henüz doğrulanmadı.** Üstteki yayımlanmış 0.2.3 dosyası bu yeni özellikleri içermez. [0.2.4 sürüm notları](docs/RELEASE-0.2.4.md), tamamlanan ve bekleyen doğrulamaları ayırır.

## Güncellemede hafızanız

Uygulama güncellemesi ile kişisel veri birbirinden ayrıdır: program dosyaları yenilenir; kayıtlı konuşmalarınız, hafıza notlarınız, raporlarınız ve anahtarınız `%APPDATA%\GIDEON` altında kalır. Güncelleme için bu klasörü silmeyin, farklı bir Windows hesabında sıfırdan profil oluşturmayın. 0.2.4 geçişi eski fabrika talimatlarını yalnızca özgün içerikle birebir eşleşiyorsa yeniler ve önceki hâlini özel bir yedekte tutar; kişiselleştirilmiş talimatlarınız üzerine yazılmaz.

Yeni bilgi, görev veya ayar eklemek için uygulamayı yeniden kurmanız gerekmez. Programın kodu değiştiğinde yeni kurulum dosyası mevcut uygulamayı günceller; kullanıcı verisi ayrı kalır. Otomatik uygulama güncelleyicisi bu sürümde yoktur.

“Yarın İzmir'e gidiyorum; bunu kesin hafızaya kaydet” gibi önemli bir bilgi için kayıt işlemini onaylayın; sonra yeni konuşmada kaynağıyla hatırlamasını isteyin. Kaydedilmiş metin konuşmaları korunur. OpenClaw, Google Live'ın kesinleştirdiği kullanıcı ve asistan sözlerini etkin konuşmanın SQLite kaydına işler; henüz tamamlanmamış konuşma geçicidir. Bir saatlik gerçek ses görüşmesinin bütünüyle saklanması henüz uçtan uca doğrulanmadı. Önemli bilgiler için onaylı hafıza notu ve düzenli şifreli yedek kullanın.

## Kaynak sürümünü geliştirmek için başlatma

Windows'ta paketi açtıktan sonra **GIDEON.cmd** dosyasına çift tıklayabilirsiniz. Gerekli paketleri kurar, GIDEON profilini hazırlar ve başlatır. Node.js'in aşağıda belirtilen sürümü önceden kurulu olmalıdır. Bu kısayol gerçek Windows cihazda henüz test edilmedi.

Windows PowerShell veya bilgisayarınızdaki terminalde bu proje klasörünü açın. Node.js **24.16 veya üzeri bir 24.x sürümü**, ya da **26.1 veya üzeri** gerekir. Windows için WSL zorunlu değildir.

```sh
npm ci
npm run setup
npm start
```

İlk başlatmada Gemini API anahtarınızı terminaldeki **gizli girişe** yapıştırın. Giriş ekranda görünmez ve dosyaya kaydedilmez; hizmet kapandığında bu geçici anahtar da kaybolur. Güvenli ortam ayarlarında bulunan `GEMINI_API_KEY` veya `GOOGLE_API_KEY` varsa doğrudan kullanılır. Anahtarı sohbete, kaynak koda veya Git'e eklemeyin. Enter ile atlayabilirsiniz; bu durumda panel açılır, Gemini yanıtı alınamaz.

Etkileşimli başlatmada panel hazır olduğunda tarayıcı otomatik açılır. İlk terminal açık kalsın. Panel açılmazsa aynı klasörde **ikinci terminal** açıp çalıştırın:

```sh
npm run dashboard
```

Resmî OpenClaw paneli koyu Phosphor temasıyla açılır. Paneli açan komut, erişim token'ını terminale yazdırmaz. Sohbette “Adın ne?” diyerek başlayın. Canlı ses için panelin Google Live Voice bölümünden mikrofon izni verip görüşmeyi başlatın. Kapatmak için hizmet terminalinde **Ctrl+C** kullanın.

Bu kaynak sürümünde yeni profillerin metin modeli `google/gemini-3.5-flash`, canlı ses modeli `gemini-3.1-flash-live-preview`, ses `Kore` olarak hazırlanır. Mevcut profilin metin modeli korunur. Google API hesabınızda bu modellere erişim ve kota bulunmalıdır. Gemini Pro veya ChatGPT Pro tüketici aboneliği API kullanımını otomatik karşılamaz; ücreti ve bütçeyi Google hesabınızdan takip edin.

## Günlük kullanım

- **Kaydetmek:** “Bunu kesin hafızaya kaydet.” GIDEON kayıt metnini gösterir; yazma işlemi için panelde çıkan tek seferlik onayı verirsiniz.
- **Hatırlamak:** “Bunu daha önce hangi tarihte konuşmuştuk?” Kayıt bulunursa kaynak ve tarih kullanılır; bulunmayan geçmişin uydurulmaması davranış kuralıdır ve gerçek modelle kabul testi gerekir.
- **Düzeltmek:** “Bu bilgi değişti…” Eski kayıt tarihçe olarak korunup yeni kayıt için onay istenir.
- **Hatırlatmak:** “Yarın 10:00 için çalışma hatırlatması oluştur.” Saat dilimi Türkiye'dir. Resmî yerel zamanlayıcı, hizmet ve bilgisayar açıkken çalışır. Telefon bildirimi veya kapalı bilgisayarda teslim garantisi yoktur.
- **Araştırmak ve belge hazırlamak:** “Kararın özgün metnini oku, karar numarasını ve kaynak bağlantısını göster, sonucu PDF yap.” Erişilemeyen veya okunmayan kaynak başarılı araştırma sayılmaz.
- **WhatsApp mesajı:** Bağlı hesapla “+90… numarasına şu metni gönder” deyin; alıcıyı ve metni kontrol edip yalnızca o gönderime izin verin.

Not yazma/düzenleme, zamanlayıcı değişiklikleri ve desteklenen WhatsApp gönderimleri `gideon-guard` eklentisiyle eylem başına **bir kez izin ver / reddet** onayına bağlıdır. İstenen yeni raporun oluşturulması ek onay istemez. Araştırma için web okuma ve yönetilen tarayıcı açılır; desteklenen tarayıcı form etkileşimleri işlem onayı gerektirir. Genel “Tam Erişim” tercihi bu denetimi kaldırmaz. Terminal çalıştırma, dosya silme ve başka ajanlar kapalıdır. [Araştırma ve bağlantı kapsamı](docs/ARASTIRMA-VE-BAGLANTILAR.md).

## Denetim ve yedek

Hizmet çalışırken, ayrı terminalde:

```sh
npm run doctor
```

Bu komut sürümü, yapılandırmayı, Gateway bağlantısını ve yerel hafızayı kontrol eder. Anahtarın yalnızca **varlığını** bildirir; değerini göstermez ve ücretli Gemini isteği yapmaz. Başlatmadaki geçici anahtar ikinci terminale aktarılmadığından, burada “EKSİK” görünmesi çalışan hizmetin anahtarsız olduğunu kanıtlamaz. Gerçek metin yanıtı ve mikrofon testi ayrı yapılır.

Kendiliğinden API çağrısı yapan heartbeat, Memory Core dreaming ve otomatik skill öğrenimi kapalıdır. Kullanıcının oluşturduğu hatırlatıcılar ve konuşmalar API kullanımına yol açabilir.

Yedek almadan önce hizmeti Ctrl+C ile durdurun:

```sh
npm run backup
```

İki kez gizli parola girilir; kişisel veri klasörü AES-256-GCM ile şifrelenerek Git'in dışında kalan `.gideon-backups/` içine yazılır. Parola en az 8 karakter olmalı; uzun ve benzersiz bir parola seçin. Parola kaybolursa yedek açılamaz. Yedekleri ayrıca güvenli bir diskte saklayın.

Geri yüklemeyi önce ayrı, boş bir klasörde deneyin:

```sh
npm run restore -- YEDEK_DOSYASI BOŞ_TEST_KLASÖRÜ
```

Komut parola ve dosya bütünlüğünü doğrular; mevcut GIDEON üzerine yazmaz. Bu bir kurtarma testidir. Yedekteki yapılandırma mutlak yollar içerir; farklı klasörde çalıştırmak için desteklenen yapılandırma komutlarıyla yolları uyarlamak gerekir. [Güvenlik belgesi](docs/GUVENLIK.md) yedeğin kapsamını ve geri dönüşü açıklar.

## Ne doğrulandı, ne tamamlanmayı bekliyor?

Yayımlanmış **0.2.3** için bulutta **59 birim testi ve 9 entegrasyon testi** geçti. Birim testleri ilk açılış, profil/izin/yedek, masaüstü anahtar ve hizmet kontrolcüsü ile yerel adres seçimini kapsar. Gerçek OpenClaw entegrasyonunda panel, üç oturumun kalıcı arşivi, yerel hafıza araması, yeniden başlatma, görev kalıcılığı ve şifreli geri yükleme doğrulandı. Masaüstü motorunun açılışı ve kapanışı Linux'ta ayrıca test edildi; dört arayüz akışı taklit edilmiş bağlantı durumlarıyla denetlendi. [Önceki doğrulama raporu](docs/DOGRULAMA.md) ve [0.2.4 doğrulama durumu](docs/RELEASE-0.2.4.md).

Yerel kurulum ve güvenlik testlerinin komutları [kabul testleri belgesindedir](docs/KABUL-TESTLERI.md). Bu teslimatta API anahtarı sağlanmadığından **gerçek Gemini yanıtı, beş dakikalık Türkçe canlı ses, persona/hafıza davranışı ve telefon erişimi canlı doğrulanmış değildir**. Bunları başarılı saymak için gerçek cihazda kabul testleri gerekir.

Hafıza resmî Memory Core ile tutulur; Markdown notları ve konuşma kayıtları aramada kullanılır. Ücretli embedding servisi gerektirmeyen yerel tam metin araması seçilmiştir. Bu arama birebir kelime ve ifadelerde uygundur; farklı sözcüklerle anlatılan aynı anlamı her zaman bulmayabilir. İkinci hafıza veritabanı kurulmaz.

Telefon için HTTPS ve kimlik doğrulamalı erişim ayrıca kurulmalıdır. Gateway şu anda yalnızca aynı bilgisayardan erişilir. Kilitli telefonda sürekli dinleme, telefon push bildirimi ve üç yıl kesintisiz saklama bu paketle garanti edilmez. Uzun süreli hafıza düzenli yedek, geri yükleme denetimi ve disk bakımına bağlıdır.

## Teknik kullanım ve kaynaklar

İleri bir denetim gerekirse `npm run openclaw -- KOMUT` resmî CLI'yi GIDEON'un ayrı profiliyle çalıştırır. Örneğin `npm run openclaw -- config validate`. `setup` kullanıcı notlarını korur; sürüm geçişinde desteklenen yeni özellikler mevcut profile eklenir. Mevcut model, Gateway token'ı ve kişisel talimatlar korunur; tanınan eski fabrika dosyalarının değişmeden önce yedeği alınır. Yeni kurulumda `GIDEON_STATE_DIR`, `GIDEON_PORT` ve `GIDEON_MODEL` kullanılabilir; var olan profilin model ve adresi bu değişkenlerle sessizce değiştirilmez.

- [OpenClaw 2026.10.3 kaynak sürümü](https://github.com/openclaw/openclaw/tree/v2026.10.3)
- [Google sağlayıcısı](https://docs.openclaw.ai/providers/google)
- [Hafıza](https://docs.openclaw.ai/concepts/memory) ve [hafıza CLI](https://docs.openclaw.ai/cli/memory)
- [Gateway güvenliği](https://docs.openclaw.ai/gateway/security)
- [Windows](https://docs.openclaw.ai/platforms/windows)

Paket kaynakları değiştirilmez. GIDEON'a özgü izin denetimi ayrı bir yerel eklentidir. Sürüm yükseltmeden önce şifreli yedek alın, ayrı profilde ilgili kabul testlerini çalıştırın ve kişisel verilerin korunduğunu doğrulayın.

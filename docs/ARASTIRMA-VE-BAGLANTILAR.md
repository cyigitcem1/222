# Araştırma, dosya ve WhatsApp kullanımı

GIDEON araştırmayı OpenClaw'ın resmi web, tarayıcı ve PDF araçlarıyla yürütür. Metin cevap, kaynak okuma, gerçek dosya oluşturma ve başka kişiye gönderme ayrı sonuçlardır; her biri kendi araç sonucuyla doğrulanır.

## Hukuki araştırma nasıl istenir?

Örneğin: “Kira tahliye davasında ihtar koşullarını olay tarihi olan 1 Mart 2025'e göre araştır. Yargıtay kararlarının özgün metnini ve ilgili kanun maddelerini aç. Esas/karar numarası, tarih, kısa alıntı ve resmi kaynak bağlantısını göster. Ardından kaynaklı PDF raporu oluştur.”

GIDEON önce kaynakları bulur, sonra özgün belgeleri okur ve sonuçlarını karşılaştırır. Yargıtay kararları için [resmi karar arama](https://karararama.yargitay.gov.tr/), mevzuat için [Mevzuat Bilgi Sistemi](https://www.mevzuat.gov.tr/) önceliklidir. Konuya göre Resmi Gazete, AYM veya Danıştay gibi diğer resmi kaynaklar da gerekir. Google aramasındaki özet veya üçüncü taraf karar alıntısı, özgün belgenin okunduğu anlamına gelmez.

Raporda mahkeme/daire, esas ve karar numarası, tarih, ilgili gerekçe, hüküm ve resmi bağlantı bulunmalıdır. Mevzuatın güncel metniyle olay tarihindeki metni ayrılmalıdır. Belgeye erişilemezse veya yalnızca bir bölümü okunursa rapor bunu belirtir; doğrulanamayan karar veya madde tamamlanmış gibi yazılmaz.

Dinamik sayfa, CAPTCHA veya kullanıcı girişi araştırmayı durdurabilir. GIDEON gerektiğinde tarayıcıyı açar ve insan müdahalesi gerektiren adımı bildirir. Kaynakların eksiksizliği ve olayınıza uygulanabilir hukuki sonuç için gerektiği ölçüde uzman incelemesi gerekir.

## Gerçek PDF ve diğer dosyalar

“Bunu PDF olarak ver”, “kaynaklı Markdown raporu hazırla” veya “tabloyu CSV yap” isteği `gideon_document` aracını kullanır. Araç gerçek bir dosya oluşturur; yalnızca ekranda PDF benzeri metin göstermez. Desteklenen biçimler PDF, Markdown, TXT ve CSV'dir.

İstediğiniz yeni raporun oluşturulması ek işlem onayı istemez; araç mevcut dosyalarınızın üzerine yazmaz. Gerçek OpenClaw WebChat akışında PDF eki, kimlik doğrulamalı indirme ve yeniden başlatmadan sonra dosyanın aynı kalması doğrulandı. Bu test yerel bir test sağlayıcısı kullanır; Gemini yanıtı veya Windows'ta arayüz düğmesine tıklama testi değildir. Dosya hazırlama sırasında kaynak metinleri kontrol edin; rapora eklenmiş bir URL, tek başına o belgenin doğrulandığını kanıtlamaz. Başarılı dosya üretimi de canlı araştırmanın veya hukuki sonucun doğruluğunun yerine geçmez.

Kullanıcıdan gelen PDF'ler veya erişilebilir PDF bağlantıları resmi `pdf` aracıyla okunabilir. Google'ın native PDF yolu dosyanın içeriğini Gemini API'ye gönderir; ayrı PDF anahtarı gerekmez. Şifreli PDF ve native modda seçilmiş sayfa aralığı desteklenmez. Büyük/kısmi dosyada araç hata veya kısmi okuma bilgisi döndürür. Özel belgelerde yalnızca işlemin gerektirdiği içeriği paylaşın.

Üretilen rapor ile kaynaktaki özgün karar/kanun dosyası farklıdır. Özgün PDF istenirse gerçek kaynak dosyasının indirme sonucu ayrıca kontrol edilmelidir.

## WhatsApp hesabını bağlama

WhatsApp desteği, resmi `@openclaw/whatsapp` **2026.10.3** eklentisine dayanır. WhatsApp Web üzerinden bağlı cihaz oturumu kullanır. Hesap, QR kodu kullanıcı tarafından okutulmadan bağlanmış sayılmaz; yeni bir WhatsApp API anahtarı gerekmez.

1. GIDEON'un panelinde **Settings → Channels → WhatsApp** bölümünü açın ve `gideon` hesabı için bağlama akışını başlatın. Bağlantı QR kodu kısa süreli olduğundan telefon hazır olmalıdır.
2. iPhone'da WhatsApp'ı açın, **Ayarlar → Bağlı Cihazlar → Cihaz Bağla** yoluyla ekrandaki QR kodunu okutun.
3. Panelde `gideon` hesabının bağlı/çalışır göründüğünü kontrol edin. Bu profil yalnızca GIDEON panelinden başlatılan onaylı gönderimler için hazırlanmıştır; gelen WhatsApp mesajlarına otomatik yanıt vermez. Gelen mesaj veya grup erişimini açmanız gerekmez.
4. Önce izin verdiğiniz bir deneme numarasına kısa, kişisel bilgi içermeyen metin isteyin. Numara ülke koduyla birlikte açık olmalıdır: örneğin `+90…`. Onay kartında alıcı ve metnin tamamını kontrol edin, yalnızca o gönderime izin verin. Gerçek cihazda mesajın durumunu inceleyin.

Gönderim yalnızca bağlı `gideon` hesabından tek açık E.164 telefon numarasına düz metin olarak desteklenir. Onay kartının açıklaması en fazla 512 karakter olduğundan mesaj sınırı alıcı/açıklama uzunluğuna bağlıdır; yaklaşık 450 karakterlik kısa parçalar gerekebilir. Her parça ayrıca onaylanır, metin sessizce kesilmez. Grup, toplu gönderim, başka hesap/kanal, dosya/medya gönderimi ve arama engellenir. Gelen DM ve grup mesajları için otomatik yanıt kapalıdır; bu profil WhatsApp üzerinden GIDEON ile sohbet etmeyi açmaz.

Bilgisayar ve GIDEON çalışmalı, WhatsApp kanal dinleyicisi bağlı olmalıdır. “Gönderim kabul edildi”, “teslim edildi” ve “okundu” farklı durumlardır. Başarısız veya sonucu belirsiz gönderim, kaydı kontrol etmeden tekrarlanmamalıdır. Hesabı kaldırmak için WhatsApp'ın **Bağlı Cihazlar** bölümünden GIDEON oturumunu çıkartabilirsiniz.

## Aynı Gemini anahtarıyla araştırma

Google eklentisi metin, arama ve PDF işlemlerinde mevcut Gemini API erişimini kullanabilir. Gemini araması için `GEMINI_API_KEY` veya `models.providers.google.apiKey` yeterlidir; ayrı Brave/Firecrawl anahtarı zorunlu değildir. Arama ve PDF API kullanımının ücret ve kota durumu Google hesabına bağlıdır.

Bu sürüm arama modelini açıkça `gemini-3.5-flash` olarak seçer. OpenClaw 2026.10.3 kataloğunda bu model bulunur ve arama sağlayıcısı açık model seçimini destekler; [Google'ın resmi Gemini CLI model tanımları](https://github.com/google-gemini/gemini-cli/blob/main/packages/core/src/config/models.ts) da bu kimliği temel Flash modeli olarak içerir. Katalog/config doğrulaması, hesabınızın bu modele eriştiğini veya canlı sorgunun başarılı olacağını tek başına kanıtlamaz. Google sağlayıcı erişimi hata döndürürse hata görünür olmalı; sonuç uydurulmamalıdır.

Google Search grounding kaynaklı bir model cevabı döndürür. `count` tam N adet karar garantisi vermez; Gemini için `country`, `language` ve `domain_filter` filtreleri desteklenmez. `site:` sorgusu yardımcıdır; sonuçta kullanılan belge ve alan adı ayrıca incelenmelidir.

## Güncellemede konuşmalar ve raporlar

Windows masaüstü sürümü konuşma deposunu, hafıza notlarını, raporları ve kişisel ayarları uygulama dosyalarından ayrı `%APPDATA%\GIDEON\state` klasöründe tutar. Normal sürüm güncellemesi yeni program dosyalarını kurar; bu kullanıcı klasörünü yeniden oluşturmaz veya temizlemez. Programın ZIP/kurulum dosyasını yenilemek ile kişisel veri klasörünü silmek farklı işlemlerdir.

Yeni bilgi, görev veya ayar eklemek için yeniden kurulum gerekmez. Kod değişikliği yeni uygulama sürümüyle uygulanır; otomatik uygulama güncelleyicisi bu pakette yoktur.

Mevcut API anahtarı, kullanıcı notları ve OpenClaw konuşma arşivleri korunmalıdır. Varsayılan talimat dosyaları yükseltilirken yalnızca tanınan eski fabrika içeriği güncellenir ve önceki sürüm özel bir yedekte tutulur; kullanıcı tarafından değiştirilmiş dosyalar üzerine yazılmaz. Kişisel veri klasörünü manuel silmeyin. Yeniden kurulumda önceki Windows hesabını/veri klasörünü kullanın ve önemli arşiv için şifreli yedeğinizi saklayın.

Geçmişin hatırlanması, gerçekten kaydedilmiş konuşmanın aranmasıyla doğrulanır. OpenClaw, Google Live'ın kesinleştirdiği kullanıcı ve asistan sözlerini etkin konuşmanın SQLite kaydına işler. Arayüz sabit kayıt kimliğiyle yeniden dener ve kapatırken bekleyen kesinleşmiş kayıtları tamamlamaya çalışır. Henüz kesinleşmemiş sözler geçicidir; tek söz kaydı 8.000 karakterle sınırlıdır. Bu akışın bulunması bir saatlik gerçek Gemini Live görüşmesinin uçtan uca test edildiği anlamına gelmez; böyle bir canlı test başarılı diye sunulmaz.

## Doğrulama sınırı ve resmi kaynaklar

Geliştirme ortamındaki kamu sitesi istekleri ağ proxy'sinde `CONNECT 403` ile, kaynak sunucuya ulaşmadan engellendi. Bu nedenle bu ortamda canlı Yargıtay/Mevzuat erişimi, CAPTCHA akışı veya örnek mevzuat PDF yolu başarılı olarak doğrulanmadı. Kullanıcının bilgisayarındaki internet erişimi ve bağlı Gemini/WhatsApp hesabıyla gerçek kabul testi gerekir. Bu engel, resmi sitelerin kendisinin 403 verdiği anlamına gelmez.

Uygulama yolu ve araç sözleşmeleri aşağıdaki resmi OpenClaw 2026.10.3 belgeleri/kaynaklarıyla doğrulanmıştır:

- [Gemini araması ve anahtar/model seçimi](https://github.com/openclaw/openclaw/blob/v2026.10.3/docs/tools/gemini-search.md)
- [Web Fetch: HTML okuma, JavaScript ve erişim sınırları](https://github.com/openclaw/openclaw/blob/v2026.10.3/docs/tools/web-fetch.md)
- [Browser kurulumu ve eklenti kontrolü](https://github.com/openclaw/openclaw/blob/v2026.10.3/docs/tools/browser/setup.md)
- [Browser araçları ve dinamik sayfalar](https://github.com/openclaw/openclaw/blob/v2026.10.3/docs/tools/browser/agent-tools.md)
- [PDF: native Google yolu, dosya biçimleri ve sınırlar](https://github.com/openclaw/openclaw/blob/v2026.10.3/docs/tools/pdf.md)
- [WhatsApp: QR, erişim listeleri ve teslim akışı](https://github.com/openclaw/openclaw/blob/v2026.10.3/docs/channels/whatsapp.md)
- [OpenClaw araç işlem onayları](https://github.com/openclaw/openclaw/blob/v2026.10.3/docs/plugins/plugin-permission-requests.md)

`gideon_document`, bu depodaki GIDEON eklentisidir; resmi OpenClaw'ın medya/araç sonucunu kullanır. API sözleşmesi `format`, `title`, `content` ve isteğe bağlı `sources` alanlarından oluşur. CSV içeriği önceden hazırlanmış metin olarak verilir; ayrı bir `rows` parametresi yoktur. Sonuçtaki gerçek dosya metadata'sı ve OpenClaw'ın yönettiği ek, üretim/indirme kanıtıdır.

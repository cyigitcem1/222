# GIDEON güvenlik ve veri yönetimi

GIDEON kişisel veriyi OpenClaw'un kendi kayıtlarında tutar. Gemini yanıtı için gerekli konuşma içeriği Google'a gönderilir; “veri diskte” ifadesi model sağlayıcısına hiç veri gönderilmediği anlamına gelmez. Gerçek müvekkil verisi, meslek sırrı veya hassas üçüncü kişi verisi kullanmadan önce uygun veri politikası ayrıca belirlenmelidir.

## Anahtarlar ve panel erişimi

- `npm start`, varsa güvenli ortam ayarlarındaki `GEMINI_API_KEY` veya `GOOGLE_API_KEY` bağını kullanır. Yoksa anahtarı gizli terminal girişinde ister; dosyaya yazmaz.
- Gizli giriş, anahtarın komut geçmişine veya ekrana yazılmasını önler. Çalışan OpenClaw süreci bu anahtara erişir; aynı bilgisayardaki yetkili süreçlerden tam izolasyon sağlamaz.
- Anahtar, token ve parola sohbet, Git, `.env` veya log dosyasına eklenmemelidir. Bu paket `.env` kullanmayı gerektirmez.
- Gateway erişim token'ı yerel `.gideon/openclaw.json` içinde bulunur. Bu klasör ve yedekler özeldir; paylaşılmaz ve Git'e alınmaz.
- `npm run dashboard`, kimlik doğrulamalı URL'yi tarayıcıya açar; token'ı terminale yazdırmaz. Adres çubuğunun ekran görüntüsünü veya tarayıcı oturumunu paylaşmayın.
- Gateway `127.0.0.1:18799` üzerinde dinler. İnternete açık erişim için HTTPS, güçlü kimlik doğrulama ve ayrı bir cihaz erişim denetimi gerekir. Bu pakette genel erişim açılmaz.

Google API kotasını ve bütçe sınırlarını kendi Google hesabınızda kontrol edin. Tüketici Gemini Pro/ChatGPT Pro üyeliği API kullanımının ücretsiz olduğu anlamına gelmez. Heartbeat ve otomatik sürüm güncellemesi kapalıdır; bu, kullanıcı sohbeti veya zamanlanmış işlerin API maliyetini ortadan kaldırmaz.

## Teknik izin sınırı

İzin politikası persona metnine ek olarak yerel `gideon-guard` eklentisiyle uygulanır. Eklenti resmî OpenClaw onay mekanizmasını kullanır. Yazma, düzenleme ve otomasyon değişikliklerinde hedef eylem için **tek seferlik izin** veya **ret** istenir. Ret veya zaman aşımı sonucunda işlem engellenir. Sürekli izin, bu profilin normal kullanım yolu değildir.

| Eylem | Bu profilde davranış |
| --- | --- |
| Kendi notlarını ve konuşmalarını okuma/arama | İzin verilen kapsam içinde ek onay gerekmez |
| Not yazma veya düzenleme | Çalışma alanı içinde, eyleme özel onay gerekir |
| Kimlik/güvenlik talimatlarını değiştirme | Ajan tarafından engellenir |
| Hatırlatıcı ekleme, değiştirme veya kaldırma | Onay gerekir; yalnızca yerel `main` systemEvent kapsamı |
| Terminal/shell çalıştırma | Kapalı |
| Dosya silme | Ajan için kapalı |
| Kaynaklı yeni PDF/Markdown/TXT/CSV raporu | İstenen yeni rapor oluşturulabilir; ek onay istemez, var olan dosya değişmez |
| Genel web araması, sayfa ve PDF okuma | Araştırma kapsamında açık; özel ağ ve kimlik bilgisi sınırları uygulanır |
| WhatsApp mesajı | Yalnızca bağlı `gideon` hesabından tek açık numaraya kısa metin; alıcı ve tam metin için her gönderimde onay |
| E-posta, grup/toplu WhatsApp, arama ve medya gönderimi | Kapalı |
| Yönetilen araştırma tarayıcısı | Ayrı `openclaw` profili; resmi hukuk sitelerinde desteklenen form işlemleri onay ister |
| Terminal, kişisel tarayıcı profili ve cihaz otomasyonu | Kapalı |
| Başka ajan oluşturma veya ajanlar arası gönderim | Kapalı |

Genel “Tam Erişim” etiketi eylem onayının yerine geçmez. Ajanın izin sınırı, bilgisayarın sahibi tarafından terminalde çalıştırılan yönetim komutları için bir işletim sistemi sandbox'ı değildir. `npm run openclaw -- …` yalnızca ileri yönetim için kullanılmalıdır; verilen komutun etkisini bilmeden çalıştırmayın.

Haricî belge, sayfa veya konuşma içindeki talimatlar kullanıcı yetkisi sayılmaz. Şüpheli içerik için davranış kuralı uygulanır; shell araçları kapalıdır, desteklenen dış gönderim ise somut alıcı ve tam mesaj için tek kullanımlık onay ister. WhatsApp gelen DM ve grup yanıtları `dmPolicy:disabled` ve `groupPolicy:disabled` ile kapalıdır; QR ile hesap bağlamak bu izinleri açmaz. Kişisel veriyi şüpheli eklentilerle paylaşmayın. OpenClaw paket kaynakları yamalanmaz; izin denetimi ayrı yerel eklentidir. [Araştırma ve bağlantı kapsamı](ARASTIRMA-VE-BAGLANTILAR.md).

## Verilerin yeri ve anlamı

| Yer | İçerik |
| --- | --- |
| `.gideon/openclaw.json` | Yerel profil ve Gateway token'ı |
| `.gideon/workspace/USER.md` | Kullanıcının doğruladığı profil bilgileri |
| `.gideon/workspace/MEMORY.md` | Onaylı önemli notlar ve tarihçe |
| `.gideon/workspace/memory/` | Tarihli notlar |
| `.gideon/workspace/reports/` | Oluşturulmuş rapor dosyaları |
| `.gideon/` altındaki OpenClaw oturum verileri | Konuşma ve oturum kayıtları |
| `.gideon/` altındaki resmî hafıza indeksi | Not ve oturumlardan türetilen arama verisi |
| `.gideon/logs/` | Yerel hizmet/audit kayıtları |
| `.gideon-backups/` | Şifreli yerel yedek arşivleri |

Markdown notu ve oturum kaydı kaynak veridir; indeks tek arşiv değildir. Resmî Memory Core'da `memory` ve `sessions` kaynaklarıyla yerel tam metin araması kullanılır. Embedding sağlayıcısı seçilmez ve ikinci bir hafıza veritabanı kurulmaz. Yerel tam metin araması anlamsal benzerlik garantisi sunmaz.

Tablodaki `.gideon/` kaynak sürümün varsayılanıdır; Windows masaüstü karşılığı `%APPDATA%\GIDEON\state` klasörüdür. Masaüstü Gemini anahtarı bunun üstündeki `%APPDATA%\GIDEON\credentials.bin` dosyasında Windows DPAPI ile şifrelenir. WhatsApp bağlı cihaz kimlik bilgileri `state\credentials\whatsapp\gideon` içinde özeldir. Bu dosyaları veya profil yedeklerini paylaşmayın.

Varsayılan kişisel profil boş bırakılır. Görev belgesindeki okul, evlilik veya iş hedefleri gerçekleşmiş kişisel bilgi olarak eklenmez. Kaynak mesajına erişim yoksa GIDEON'un kaynak ID'si uydurmaması gerekir; bunu gerçek model kabul testiyle doğrulayın.

“Unut” isteği kapsamıyla değerlendirilir. Güncel bir notun pasifleştirilmesi, eski konuşma metnini veya şifreli yedekleri yok etmez. Kullanıcı tam silme istiyorsa kaynak kayıtlar, türev indeksler ve yedekler için ayrı kapsam belirlenmelidir. Bu pakette ajan kaynak dosyası silme yetkisi taşımaz; tam silme kullanıcı yönetiminde kalır. Eski yedekler aynı bilgiyi içerebilir.

## Şifreli yedek ve kurtarma

Tutarlı yedek için önce Gateway'i Ctrl+C ile durdurun, sonra `npm run backup` çalıştırın. Özel hedef isterseniz `npm run backup -- YEDEK_DOSYASI` kullanın. Yedek parolası iki kez gizli girilir. Anahtar türetme **scrypt**, şifreleme **AES-256-GCM** kullanır; dosya içerikleri için bütünlük özeti doğrulanır. Parola arşive kaydedilmez.

Yedek GIDEON veri klasörünün anlık görüntüsüdür; konuşmaları, notları, profili ve bu klasördeki özel yapılandırmayı kapsar. Geçici başlatma anahtarı dosyaya yazılmadığından yedeğe eklenmez. Ancak kullanıcı daha sonra anahtarı bir yapılandırma dosyasına elle yazdıysa bu dosya da kapsama girebilir. Paket bağımlılıkları ve bilgisayarınızdaki diğer OpenClaw kurulumu bu yedeğin parçası değildir.

Bu ilk yedek sürümü bellekte çalışır ve kaynak toplamını **128 MiB**, arşivi **256 MiB**, dosya/dizin sayısını **25.000** ile sınırlar. Sembolik bağlantılar ve özel dosyalar kabul edilmez. Sınır aşılırsa eksik yedek başarılı sayılmaz; veri silinmeden daha büyük arşive uygun yedekleme yöntemi ayrıca geliştirilmelidir. Yıllara yayılan saklama için bu sınır düzenli izlenmelidir.

OpenClaw'ın her açılışta yeniden oluşturduğu `tmp/plugin-captures` kod önbelleği boş klasör olarak korunur; içindeki kurulu paket bağlantıları izlenmez ve yedeğe alınmaz. Bu istisna konuşma veritabanı, notlar, raporlar veya hesap dosyaları için geçerli değildir.

Geri yükleme için:

```sh
npm run restore -- YEDEK_DOSYASI BOŞ_AYRI_KLASÖR
```

Parola gizli istenir; doğrulama tamamlanmadan geçerli geri yükleme yapılmış sayılmaz. Hedef boş ve ayrı olmalıdır. Mevcut aktif veri klasörü üzerine yazma desteklenmez. Yanlış parola veya bozulmuş arşiv başarısızlık olarak döner.

Yapılandırma yedekte mutlak yollar taşır. Ayrı klasöre açmak **kurtarma testi** sağlar; buradan otomatik hizmet başlatmaz. Taşıma sırasında çalışma alanı, log ve eklenti yollarını resmî `openclaw config` yönetimiyle yeni konuma uyarlayın; profili doğrulayın. Eski ve yeni profil aynı anda aynı portu kullanamaz. Aktif veriyi değiştirmeden önce ayrı klasörde örnek kayıtları kontrol edin.

En az ayda bir geri yükleme deneyin. Şifreli yedeğin bir kopyasını ayrı, güvenli depolamada tutun; parola ayrı saklansın. Otomatik dış yedekleme ve saklama süreleri bu paket tarafından kurulmaz. Üç yıllık erişim, yeterli disk ve düzenli bakım gerektirir.

## Geri dönüş ve bakım

Bu teslimat mevcut OpenClaw kurulumunuzu taşımaz veya birleştirmez. `setup` kullanıcı dosyalarını korur; 0.2.4 geçişinde desteklenen yeni özellikleri GIDEON profiline ekler. Mevcut model, Gateway token'ı ve kişisel talimatlar korunur. Yalnızca bilinen eski fabrika dosyaları birebir içerik eşleşmesiyle yenilenir; önceki hâli veri klasöründe özel yedekte tutulur. Yedekler eski profil bilgileri taşıyabilir; Git'e yüklemeyin. GIDEON'u durdurup önceki OpenClaw uygulamanızı açarak ayrı kurulumunuzu kullanabilirsiniz. Özel verileri ne yaptığınızı bilmeden silmeyin.

Sürüm yükseltirken önce hizmeti durdurup şifreli yedek alın; ayrı test profilinde [kabul testlerini](KABUL-TESTLERI.md) tekrarlayın. Bağımlılık checksum, paket imzası ve TLS denetimlerini kapatmayın. Hatayı paylaşırken sadece gereken, sırları maskelenmiş satırları kullanın; bütün yapılandırmayı veya ortam değişkenlerini dökmeyin.

Resmî dayanak: [2026.10.3 kaynak sürümü](https://github.com/openclaw/openclaw/tree/v2026.10.3), [Gateway güvenliği](https://docs.openclaw.ai/gateway/security), [hafıza](https://docs.openclaw.ai/concepts/memory), [Google](https://docs.openclaw.ai/providers/google).

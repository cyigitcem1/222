# GIDEON 0.2.1 — Windows açılış düzeltmesi

0.2.0'ın gerçek Windows testinde ilk pencere açıldı; ikinci tıklama açık uygulamanın motor dosyalarını kaldırdı. **GIDEON-0.2.1-Windows.exe** her taşınabilir açılışta ayrı geçici klasör kullanır. Dosyalar açılırken başlangıç görseli gösterir, veri klasörünü önceden hazırlar, başlangıç penceresini görünür açar ve arayüzün yüklenmesini bekler. Mevcut konuşmalar, notlar ve Windows hesabıyla şifrelenmiş API anahtarı korunur; veri klasörünü silmeniz gerekmez.

Windows x64 için taşınabilir tek dosyadır; Node ve OpenClaw içindedir. İlk kullanımda Gemini API anahtarınızı bir kez girip **Kaydet ve aç** seçin. API erişimi ve Google kotası gerekir; tüketici Gemini/ChatGPT aboneliği API ücretini otomatik karşılamaz.

Linux'ta **59 birim ve 9 entegrasyon testi** geçti. **Bu sürüm, gerçek Windows pencere açılışı, ikinci tıklama/kaynak bütünlüğü, DPAPI şifreleme/okuma ve düzgün kapanış kontrolleri geçtikten sonra yayımlanır.** Yayın iş akışı bu kontrollerden biri başarısızsa dosyayı yayımlamaz. Önceki Windows Node/Gateway testi bu kontrollerin yerine geçmez.

Bu sürüm yayıncı sertifikasıyla imzalı değildir. Gerçek Gemini yanıtı ve mikrofon/canlı ses testi henüz yapılmadı.

[Kullanım notları](https://github.com/cyigitcem1/222/blob/main/docs/MASAUSTU.md) · [Doğrulama kapsamı](https://github.com/cyigitcem1/222/blob/main/docs/DOGRULAMA.md)

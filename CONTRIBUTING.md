# Katkı Rehberi

## Geliştirme Kurulumu

```bash
cd mcp-server
npm install
```

## Kod Stili

- ESLint + Prettier kullanılıyor
- Pre-commit hook otomatik format yapar
- `npm run lint` ile kontrol edin

## Test

```bash
npm test        # Watch modu	npm run test:run # CI için
npm run test:coverage # Coverage raporu
```

## Commit Mesajları

Format: `<type>: <description>`

Type'lar:
- `feat:` Yeni özellik
- `fix:` Bug fix
- `docs:` Dokümantasyon
- `refactor:` Kod değişikliği (davranış değişmez)
- `test:` Test ekleme/güncelleme
- `chore:` Build, config, vb.

Örnek: `feat: github plugin'e PR listeleme ekle`

## Plugin Geliştirme

1. `src/plugins/<name>/index.js` oluşturun
2. Gerekli export'ları ekleyin (name, version, register)
3. Test yazın
4. README ekleyin

## PR Süreci

1. Branch oluşturun: `git checkout -b feature/isim`
2. Değişiklikleri yapın ve commit edin
3. Test'leri çalıştırın: `npm run test:run`
4. Lint kontrolü: `npm run lint`
5. PR açın

## Sorular

Issue açın veya Discord'dan ulaşın.

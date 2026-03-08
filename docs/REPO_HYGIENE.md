# Repository Hygiene Standards

Repo temizlik ve organizasyon kuralları.

## Kök Dizin Yapısı

Kök dizinde sadece giriş kapısı dosyaları bulunur:

```
/
├── README.md           # Ana giriş (zorunlu)
├── LICENSE             # Lisans (zorunlu)
├── CHANGELOG.md        # Değişiklik logu (zorunlu)
├── .gitignore          # Git ignore (zorunlu)
├── .github/            # GitHub templates ve workflows (zorunlu)
├── docs/               # Dokümantasyon (zorunlu)
└── mcp-server/         # Ana kod (zorunlu)
```

**Kökte olmaması gerekenler:**
- ❌ Yarım/strateji dokümanları
- ❌ Eski plan dosyaları
- ❌ Blog içeriği
- ❌ Geçici dosyalar

## Docs Klasörü Yapısı

```
docs/
├── README.md           # Docs girişi
├── guides/             # Kullanım kılavuzları
│   ├── CONTRIBUTING.md
│   ├── plugin-development.md
│   ├── cursor-setup.md
│   └── claude-desktop-setup.md
├── architecture/       # Mimari dokümanlar
│   ├── ARCHITECTURE.md
│   ├── quality-standards.md
│   └── plugin-sdk-standard.md
├── security/           # Güvenlik dokümanları
│   ├── transport-auth.md
│   └── security-model.md
├── strategy/           # Strateji ve roadmap
│   ├── LAUNCH_STRATEGY.md
│   └── ROADMAP.md
├── releases/           # Sürüm notları
│   ├── v1.0.0.md
│   └── v1.1.0.md
└── blog/               # Blog içerikleri (opsiyonel)
    └── welcome.md
```

## Dosya İsimlendirme

- **Kılavuzlar:** lowercase-with-hyphens.md
- **Mimari:** UPPERCASE.md
- **Strateji:** UPPERCASE.md
- **Sürüm:** vX.Y.Z.md

## Bakım Kuralları

### Aylık Kontrol Listesi

- [ ] Eski dosyalar arşivlendi mi?
- [ ] Geçici dosyalar temizlendi mi?
- [ ] Dead link'ler kontrol edildi mi?
- [ ] Gereksiz binary'ler kaldırıldı mı?
- [ ] Cache dizinleri .gitignore'da mı?

### Stale İçerik Tespiti

```bash
# 90 günden eski değişmemiş dosyaları bul
find docs -name "*.md" -mtime +90 -type f

# Büyük binary dosyaları kontrol et
find . -type f -size +1M | grep -v node_modules | grep -v .git
```

### Temizlik Komutları

```bash
# Build artıklarını temizle
npm run clean

# Cache'i temizle
rm -rf cache/*

# Test geçici dosyaları
rm -rf coverage/*
rm -rf .nyc_output/*
```

## .gitignore Standartları

```
# Dependencies
node_modules/

# Build outputs
dist/
build/
*.tsbuildinfo

# Cache
cache/
.cache/
*.cache

# Testing
coverage/
.nyc_output/

# Logs
logs/
*.log
npm-debug.log*

# Environment
.env
.env.local
.env.*.local

# IDE
.idea/
.vscode/
*.swp
*.swo

# OS
.DS_Store
Thumbs.db

# Temporary
tmp/
temp/
*.tmp
```

## Commit Mesaj Standartları

```
type(scope): subject

body (optional)

footer (optional)
```

**Types:**
- `feat:` Yeni özellik
- `fix:` Bug fix
- `docs:` Dokümantasyon
- `style:` Format değişikliği
- `refactor:` Kod refactoring
- `test:` Test değişikliği
- `chore:` Bakım işi

**Örnekler:**
```
feat(github): add PR review tool
fix(shell): validate dangerous commands
docs(readme): add plugin maturity matrix
```

## Dizin Boyut Limitleri

| Dizin | Limit | Açıklama |
|-------|-------|----------|
| kök | < 10 dosya | Sadece giriş dosyaları |
| docs/ | < 50 dosya | Organize alt dizinlerde |
| cache/ | < 100MB | Otomatik temizlenmeli |
| node_modules/ | - | .gitignore'da |

## Yeni Dosya Kontrol Listesi

Yeni dosya eklemeden önce:

- [ ] Doğru dizinde mi?
- [ ] İsimlendirme standartına uygun mu?
- [ ] Gereksiz mi? (eskisi var mı?)
- [ ] .gitignore kontrol edildi mi?
- [ ] Link'ler çalışıyor mu?

## Arşivleme

Eski ama değerli dosyalar `docs/archive/` altına taşınır:

```
docs/archive/
├── 2024-Q1/
├── 2024-Q2/
└── README.md  # Arşiv indeksi
```

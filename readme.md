<div align="center">

# 📚 OpenLibTR

**Türkçe Light Novel Veritabanı**

Açık kaynaklı, Markdown tabanlı, topluluk destekli Türkçe light novel içerik deposu.

[![Canlı Demo](https://img.shields.io/badge/🌐_Canlı_Okuyucu-openlibtr.vercel.app-black?style=for-the-badge)](https://openlibtr.vercel.app)

[![License: MIT](https://img.shields.io/badge/Lisans-MIT-blue?style=flat-square)](LICENSE)
[![PRs Welcome](https://img.shields.io/badge/Katkı-Açık-brightgreen?style=flat-square)](CONTRIBUTING.md)
[![Issues](https://img.shields.io/github/issues/agnogad/openlibtr?style=flat-square)](https://github.com/agnogad/openlibtr/issues)

</div>

---

## 📖 Proje Hakkında

**OpenLibTR**, Türkçeye çevrilmiş veya özgün Türkçe light novel içeriklerini düzenli ve erişilebilir biçimde barındıran açık kaynak bir içerik deposudur. İçerikler sade Markdown formatında yazılır ve [Pandoc](https://pandoc.org/) uyumlu klasör yapısıyla düzenlenir. Bu sayede hem insan tarafından kolayca okunabilir hem de herhangi bir araçla HTML, EPUB veya PDF'e dönüştürülebilir.

Bu repo yalnızca **içerik deposudur**. Frontend okuyucu arayüzü ayrı bir projede geliştirilmekte olup bu veritabanını okuyarak canlıda sunmaktadır:

> 🔗 **[openlibtr.vercel.app](https://openlibtr.vercel.app)** — Canlı okuyucu arayüzü

---

## 🗂️ Klasör Yapısı

Her novel, kendi klasöründe Pandoc standardına uygun biçimde düzenlenir:

```
openlibtr/
│
├── novel-adi/                   # Novel slug (kebab-case)
│   ├── config.json              # Novel meta verisi
│   ├── cover.jpg                # Kapak görseli
│   └── chapters/                # Bölüm dosyaları
│       ├── 01-bolum-adi.md
│       ├── 02-bolum-adi.md
│       └── ...
│
├── diger-novel/
│   ├── config.json
│   ├── cover.jpg
│   └── chapters/
│       └── ...
│
└── README.md
```

---

## ✍️ Bölüm Formatı

Her bölüm dosyası standart Markdown formatında yazılır:

```markdown
# Bölüm 1: Başlangıç

Bölüm içeriği buraya gelir. Paragraflar arasında boş satır bırakılır.

Yeni bir paragraf.

---

*Bölüm sonu*
```

**Dosya adlandırma kuralı:** `ch1.md`, `ch2.md` şeklinde sayısal ön ek ile sıralı olmalıdır. Pandoc, dosyaları alfabetik sıraya göre birleştirir.

---

## ➕ Yeni Novel Eklemek

1. Bu repoyu **fork**'layın
2. Novel için bir klasör oluşturun (kebab-case, Türkçe karakter içermemeli):
   ```bash
   mkdir -p books/yeni-novel-adi/
   ```
3. `config.json` dosyasını doldurun
4. Kapak görselini (`cover.jpg`) ekleyin
5. Bölümleri `yeni-novel-adi/` klasörüne numara sırasıyla ekleyin
6. **Pull Request** açın

---

## 🔧 Pandoc ile Dışa Aktarma

Bu repo Pandoc uyumludur. Herhangi bir noveli lokal olarak farklı formatlarda derleyebilirsiniz:

**EPUB olarak:**
```bash
pandoc novel-adi/chapters/*.md \
  --metadata-file=novel-adi/metadata.yml \
  --epub-cover-image=novel-adi/cover.jpg \
  -o novel-adi.epub
```

**PDF olarak:**
```bash
pandoc novel-adi/chapters/*.md \
  --metadata-file=novel-adi/metadata.yml \
  --pdf-engine=xelatex \
  -V mainfont="DejaVu Serif" \
  -o novel-adi.pdf
```

**HTML olarak:**
```bash
pandoc books/novel-adi/*.md \
  --standalone \
  -o novel-adi.html
```

> Pandoc kurulumu için: [pandoc.org/installing.html](https://pandoc.org/installing.html)

---

## 🤝 Katkı Sağlama

Her türlü katkıya açığız:

- 📝 Yeni novel veya bölüm eklemek
- 🔤 Çeviri düzeltmeleri ve iyileştirmeler
- 🐛 Format hataları ve yazım yanlışları
- 🏷️ Metadata eksikliklerini tamamlamak

### Katkı Adımları

1. Repoyu **fork**'layın
2. Yeni bir branch oluşturun:
   ```bash
   git checkout -b icerik/novel-adi
   ```
3. Değişikliklerinizi yapın ve commit edin:
   ```bash
   git commit -m "feat: 'Novel Adı' eklendi"
   ```
4. Branch'inizi push edin:
   ```bash
   git push origin icerik/novel-adi
   ```
5. **Pull Request** açın ve açıklama yazın

### Commit Mesaj Kuralları

```
feat:    Yeni novel veya bölüm ekleme
fix:     Yazım veya format hatası düzeltme
update:  Mevcut içerik güncelleme
docs:    Dokümantasyon değişikliği
```

---

## ⚖️ İçerik

- Bu repodaki **Türkçe içerikler** lisansla sunulmaktadır.
- Katkı sağlayarak, eklediğiniz içeriklerin paylaşım haklarına sahip olduğunuzu beyan etmiş sayılırsınız.

---

## 🔗 İlgili Projeler

| Proje | Açıklama |
|---|---|
| [openlibtr.vercel.app](https://openlibtr.vercel.app) | Bu veritabanını kullanan canlı okuyucu arayüzü |
| [Pandoc](https://pandoc.org) | Markdown → EPUB / PDF / HTML dönüştürme aracı |

---

## 📜 Lisans

Bu proje **MIT Lisansı** ile lisanslanmıştır. Detaylar için [LICENSE](LICENSE) dosyasına bakın.

---

<div align="center">

Türk okuyucular için, Türk okuyucular tarafından 🇹🇷

</div>

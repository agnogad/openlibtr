# Novel Scraper Web Panel

Bu web paneli, novel scraping ve çeviri işlemlerini tarayıcı üzerinden yönetmenizi sağlar.

## Özellikler
- **Kütüphane Yönetimi**: Yerel kitaplarınızı ve ilerlemenizi görün.
- **Arama**: Farklı kaynaklar (extensions) üzerinden yeni novellar arayın.
- **Otomatik İşlem**: Bölümleri otomatik çekin ve AI ile Türkçeye çevirin.
- **Canlı Takip**: Devam eden işlemleri, ilerleme çubuklarını ve logları canlı izleyin.

## Başlatma

Aşağıdaki komut ile hem backend (API) hem de frontend (React) uygulamasını aynı anda başlatabilirsiniz:

```bash
npm run dev
```

- **Backend (API)**: http://localhost:4000
- **Frontend**: http://localhost:3000

## API Endpoints
- `GET /api/library`: Yerel kütüphaneyi listeler.
- `GET /api/extensions`: Yüklü eklentileri listeler.
- `POST /api/search`: Kaynaklarda arama yapar.
- `POST /api/process`: Çeviri işlemini başlatır.
- `GET /api/active-tasks`: Devam eden işlemleri döner.

## Notlar
- Çeviri işlemi için `.env` dosyanızda gerekli API keylerin (OpenAI, Gemini vb.) tanımlı olması gerekir.
- Termux üzerinde kullanıyorsanız bildirimler gönderilmeye devam eder.

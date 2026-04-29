/**
 * NovelTurk Downloader Library
 * novelturk.com — Blogger tabanlı, JSON Feed API kullanır
 */

import { load as parseHTML } from 'cheerio';
import { gotScraping } from 'got-scraping';

// ─── Config ───────────────────────────────────────────────────────────────────

const DEFAULT_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
};

const FEED_MAX_RESULTS = 50; // Blogger feed sayfa başı maksimum

// ─── HTTP Helper ──────────────────────────────────────────────────────────────

async function fetchApi(url, options = {}) {
  try {
    const response = await gotScraping({
      url,
      method: options.method || 'GET',
      body: options.body,
      headers: { ...DEFAULT_HEADERS, ...options.headers },
    });
    return {
      ok:         response.statusCode >= 200 && response.statusCode < 300,
      status:     response.statusCode,
      statusText: response.statusMessage,
      url:        response.url,
      text:       async () => response.body,
      json:       async () => JSON.parse(response.body),
    };
  } catch (error) {
    throw new Error(`HTTP Fetch Error (${url}): ${error.message}`);
  }
}

// ─── Main Class ───────────────────────────────────────────────────────────────

class NovelTurk {
  id      = 'novelturk';
  name    = 'NovelTurk';
  version = '1.0.0';
  site    = 'https://www.novelturk.com';

  /**
   * @param {{ hideLocked?: boolean }} options
   */
  constructor({ hideLocked = false } = {}) {
    this.hideLocked = hideLocked;
  }

  // ─── Novel Listesi ────────────────────────────────────────────────────────

  /**
   * Ana sayfa / kategori HTML'inden novel kartlarını parse et.
   * NovelTurk'te novel listesi ana sayfadan veya etiket sayfasından çekilir.
   * @param {import('cheerio').CheerioAPI} $
   * @param {boolean} isCategoryPage
   * @param {boolean} isSearchPage
   * @returns {Array<{ name, cover, path }>}
   */
  parseNovels($, isCategoryPage, isSearchPage) {
    const novels = [];

    // NovelTurk ana sayfasında romanlar genellikle .post-title veya widget listesinde
    // Etiket (label) sayfaları da aynı yapıyı kullanır
    const containerSelector = isCategoryPage || isSearchPage
      ? '.blog-posts .post'
      : '.blog-posts .post';

    $(containerSelector).each((_, ele) => {
      const name  = $(ele).find('.post-title a').text().trim()
                 || $(ele).find('h3.post-title').text().trim()
                 || 'Başlık Bulunamadı';

      const cover = $(ele).find('.post-body img').first().attr('src')
                 || $(ele).find('img').first().attr('src')
                 || '';

      const rawPath = $(ele).find('.post-title a').attr('href')
                   || $(ele).find('a').first().attr('href')
                   || '';

      // Blogger tam URL döner, path'e çevir
      const path = rawPath.startsWith(this.site)
        ? rawPath.slice(this.site.length)
        : rawPath;

      if (!path) return;
      novels.push({ name, cover, path });
    });

    return novels;
  }

  // ─── Popüler / Filtrelenmiş Novellar ──────────────────────────────────────

  /**
   * NovelTurk etiket (label) sayfasından novel listesini çeker.
   * Blogger etiket sayfası: /search/label/RomanAdı
   * @param {number} pageNo
   * @param {{ showLatestNovels?: boolean, filters?: object }} options
   * @returns {Promise<Array>}
   */
  async popularNovels(pageNo = 1, { showLatestNovels = false, filters = {} } = {}) {
    // Fanfic / label arama filtresi varsa yönlendir
    if (filters?.label_search?.value) {
      return this.getLabelNovels(filters.label_search.value, pageNo);
    }

    // Blogger sayfalama: updatedmax parametresiyle yapılır, basit yöntem olarak
    // /search?updated-max ile sayfalama desteklenir; başlangıçta ana sayfa yeterli
    const params = new URLSearchParams();

    if (showLatestNovels) {
      params.append('orderby', 'published');
    } else {
      // Blogger varsayılanı published'a göre sıralar
      params.append('orderby', filters.sort?.value ?? 'published');
    }

    // Blogger sayfalama için max-results
    params.append('max-results', String(FEED_MAX_RESULTS));

    // Sayfa 1 dışı için startPage index hesapla (yaklaşık)
    if (pageNo > 1) {
      params.append('start-index', String((pageNo - 1) * FEED_MAX_RESULTS + 1));
    }

    const url  = `${this.site}/?${params}`;
    const body = await fetchApi(url).then(r => r.text());
    return this.parseNovels(parseHTML(body), true, false);
  }

  // ─── Etiket Sayfasından Novel Listesi ────────────────────────────────────

  /**
   * Belirli bir Blogger etiketine ait yazıları listeler.
   * @param {string} labelName  — roman serisi adı (örn. "A Regressors Tale of Cultivation")
   * @param {number} pageNo
   * @returns {Promise<Array<{ name, cover, path }>>}
   */
  async getLabelNovels(labelName, pageNo = 1) {
    const encoded = encodeURIComponent(labelName);
    const startIndex = (pageNo - 1) * FEED_MAX_RESULTS + 1;
    const url = `${this.site}/search/label/${encoded}?start-index=${startIndex}&max-results=${FEED_MAX_RESULTS}`;
    const body = await fetchApi(url).then(r => r.text());
    return this.parseNovels(parseHTML(body), true, false);
  }

  // ─── Bölüm Listesi (Blogger JSON Feed) ───────────────────────────────────

  /**
   * Blogger JSON feed API'sinden tüm bölümleri çeker ve tarihe göre sıralar.
   * novelPath burada roman etiket adı olarak kullanılır.
   * Örn. novelPath = "/label/A%20Regressors%20Tale%20of%20Cultivation"
   *
   * @param {string} novelPath  — "/label/EtiketAdı" formatında
   * @returns {Promise<Array<{ name, path }>>}
   */
  async parseChapters(novelPath) {
    // novelPath formatı: "/label/Roman Adı"
    const labelName = decodeURIComponent(
      novelPath.replace(/^\/label\//, '')
    );

    let allChapters = [];
    let startIndex  = 1;
    let hasMore     = true;

    while (hasMore) {
      const feedUrl =
        `${this.site}/feeds/posts/summary/-/${encodeURIComponent(labelName)}` +
        `?alt=json&start-index=${startIndex}&max-results=${FEED_MAX_RESULTS}`;

      const data    = await fetchApi(feedUrl).then(r => r.json());
      const entries = data?.feed?.entry || [];

      if (entries.length === 0) {
        hasMore = false;
        break;
      }

      const batch = entries.map(entry => {
        const fullUrl = entry.link?.find(l => l.rel === 'alternate')?.href || '';
        const path    = fullUrl.startsWith(this.site)
          ? fullUrl.slice(this.site.length)
          : fullUrl;

        return {
          name:      entry.title?.$t?.trim() || 'Başlıksız Bölüm',
          path,
          published: entry.published?.$t || '',
        };
      });

      allChapters = allChapters.concat(batch);
      startIndex += entries.length;

      // Son sayfaya ulaşıldıysa dur
      if (entries.length < FEED_MAX_RESULTS) hasMore = false;
    }

    // Yayın tarihine göre artan sırala (eski → yeni)
    allChapters.sort((a, b) => new Date(a.published) - new Date(b.published));

    // published alanı dışarıya gerek yok, temizle
    return allChapters.map(({ name, path }) => ({ name, path }));
  }

  // ─── Novel Detayları ──────────────────────────────────────────────────────

  /**
   * Novel ana sayfasından meta bilgilerini ve bölüm listesini döner.
   * novelPath = "/label/Roman Adı" — Blogger etiket sayfası
   *
   * @param {string} novelPath  — "/label/EtiketAdı" formatında
   * @returns {Promise<object>}
   */
  async parseNovel(novelPath) {
    const labelName = decodeURIComponent(
      novelPath.replace(/^\/label\//, '')
    );

    const url  = `${this.site}/search/label/${encodeURIComponent(labelName)}`;
    const body = await fetchApi(url).then(r => r.text());
    const $    = parseHTML(body);

    // İlk bölüm yazısından kapak resmini al
    const cover = $('.post-body img').first().attr('src') || '';

    // Etiket sayfasında sidebar'da ya da ilk yazıda açıklama olabilir
    // Blogger'da özet genellikle yoktur, ilk yazı giriş sayılır
    const firstPostSummary = $('.post-body').first().text().trim().slice(0, 500) || 'Özet bulunamadı.';

    const novel = {
      path:     novelPath,
      name:     labelName,
      cover,
      genres:   '',           // Blogger etiket sayfasında tür bilgisi yok
      summary:  firstPostSummary,
      author:   $('.post-author a').first().text().trim() || 'Yazar Bilinmiyor',
      status:   'Devam Ediyor', // NovelTurk'te durum bilgisi sayfadan çekilemiyor
      chapters: await this.parseChapters(novelPath),
    };

    return novel;
  }

  // ─── Bölüm İçeriği ───────────────────────────────────────────────────────

  /**
   * Bölüm sayfasını parse ederek temiz metin/HTML döner.
   * @param {string} chapterPath  — örn. "/2024/01/bolum-adi.html"
   * @returns {Promise<string>} HTML string
   */
  async parseChapter(chapterPath) {
    const url  = this.site + chapterPath;
    const body = await fetchApi(url).then(r => r.text());
    const $    = parseHTML(body);

    const postBody = $('.post-body');

    // Gereksiz elementleri temizle
    postBody.find(
      '.ads, .social-share, script, style, .separator, ' +
      '.item-control, .post-share-buttons, .related-posts, iframe'
    ).remove();

    // <br> → paragraf boşluğu
    postBody.find('br').replaceWith('<br>');

    // Başlık ve içerik
    const title   = $('h3.post-title').html()
                 || $('.post-title').html()
                 || '';
    const content = postBody.html() || '';

    return `<h2>${title}</h2>` + content;
  }

  // ─── Arama ───────────────────────────────────────────────────────────────

  /**
   * Girilen terimi doğrudan Blogger JSON feed'inde etiket olarak sorgular.
   * Feed'den en az 1 entry dönerse → roman bulundu, tek kart döner.
   * Hiç entry gelmezse → boş array döner.
   *
   * NovelTurk'te roman adı = Blogger etiketi olduğundan ayrı bir
   * arama sayfasına gerek yoktur.
   *
   * @param {string} searchTerm  — roman serisi adı (örn. "A Regressors Tale of Cultivation")
   * @param {number} pageNo      — kullanılmıyor, uyumluluk için var
   * @returns {Promise<Array<{ name, cover, path }>>}
   */
  async searchNovels(searchTerm, pageNo = 1) {
    const feedUrl =
      `${this.site}/feeds/posts/summary/-/${encodeURIComponent(searchTerm)}` +
      `?alt=json&start-index=1&max-results=1`;

    try {
      const data    = await fetchApi(feedUrl).then(r => r.json());
      const entries = data?.feed?.entry || [];

      if (entries.length === 0) return []; // Bu isimde etiket yok

      // İlk entry'den kapak resmini almak için bölüm sayfasını çek
      const firstUrl  = entries[0].link?.find(l => l.rel === 'alternate')?.href || '';
      const firstPath = firstUrl.startsWith(this.site)
        ? firstUrl.slice(this.site.length)
        : firstUrl;

      let cover = '';
      if (firstPath) {
        try {
          const chapterBody = await fetchApi(this.site + firstPath).then(r => r.text());
          cover = parseHTML(chapterBody)('.post-body img').first().attr('src') || '';
        } catch { /* kapak alınamazsa boş bırak */ }
      }

      return [{
        name:  searchTerm,
        cover,
        path:  `/label/${encodeURIComponent(searchTerm)}`,
      }];

    } catch {
      return []; // Feed hatası
    }
  }
}

// ─── Filter Definitions ───────────────────────────────────────────────────────

export const filters = {
  sort: {
    label: 'Sıralama', value: 'published', type: 'Picker',
    options: [
      { label: 'En Yeni',   value: 'published' },
      { label: 'En Eski',   value: 'updated'   },
    ],
  },
  label_search: {
    label: 'Roman Adına Göre Etiket',
    value: '',
    type:  'TextInput',
    // Kullanım: Blogger etiket adını gir (örn. "A Regressors Tale of Cultivation")
    // popularNovels() bu değeri getLabelNovels()'e yönlendirir
  },
};

export default NovelTurk;

/**
 * WTR-LAB Downloader Library
 * wtr-lab.com için novel indirme eklentisi
 */

import { load as parseHTML } from 'cheerio';
import { gotScraping } from 'got-scraping';

// ─── Config ───────────────────────────────────────────────────────────────────

const DEFAULT_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
};

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

// ─── AES-GCM Decrypt Yardımcı ─────────────────────────────────────────────────
// Not: Bu fonksiyon @libs/aes gcm modülünün JS eşdeğeridir.
// Eğer ortamınızda WebCrypto mevcutsa aşağıdaki crypto.subtle bloğunu açın.

async function decrypt(encrypted, encKey) {
  try {
    let isArray = false;
    let u = encrypted;

    if (encrypted.startsWith('arr:')) {
      isArray = true;
      u = encrypted.substring(4);
    } else if (encrypted.startsWith('str:')) {
      u = encrypted.substring(4);
    }

    const parts = u.split(':');
    if (parts.length !== 3) throw new Error('Invalid encrypted data format');

    const [iv, tag, ciphertext] = parts.map(part =>
      Uint8Array.from(atob(part), c => c.charCodeAt(0)),
    );

    const combined = new Uint8Array(ciphertext.length + tag.length);
    combined.set(ciphertext);
    combined.set(tag, ciphertext.length);

    const keyBytes = new TextEncoder().encode(encKey.slice(0, 32));

    // WebCrypto ile AES-GCM şifre çözme
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      keyBytes,
      { name: 'AES-GCM' },
      false,
      ['decrypt'],
    );

    const decryptedBuffer = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      cryptoKey,
      combined,
    );

    const m = new TextDecoder().decode(decryptedBuffer);

    if (isArray) return JSON.parse(m);
    return m;
  } catch (error) {
    console.error('Şifre çözme hatası:', error);
    return { error: `<p>Şifre çözme hatası:</p>${error}` };
  }
}

// ─── Şifreleme Anahtarı Çekme ─────────────────────────────────────────────────

async function getKey($) {
  const searchKey = 'TextEncoder().encode("';
  const URLs = [];
  let code;
  let index = -1;

  const scripts = $('head').find('script').toArray();
  for (const el of scripts) {
    const src = $(el).attr('src');
    if (!src || URLs.includes(src)) continue;
    URLs.push(src);
  }

  for (const src of URLs) {
    const script = await fetchApi(`https://wtr-lab.com${src}`);
    const raw = await script.text();
    index = raw.indexOf(searchKey);
    if (index >= 0) {
      code = raw;
      break;
    }
  }

  if (!code) throw new Error('Şifreleme anahtarı bulunamadı');

  return code.substring(index + 22, index + 54);
}

// ─── Google Translate Yardımcı ────────────────────────────────────────────────

async function translate(data) {
  const contained = data.map((line, i) => `<a i=${i}>${line}</a>`);

  const response = await fetchApi(
    'https://translate-pa.googleapis.com/v1/translateHtml',
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json+protobuf',
        'X-Goog-API-Key': 'AIzaSyATBXajvzQLTDHEQbcpq0Ihe0vWDHmO520',
        'Referer': 'https://wtr-lab.com/',
      },
      body: `[[${JSON.stringify(contained)},"zh-CN","en"],"te_lib"]`,
    },
  );

  const json = await response.json();
  return (json && json[0]) ? json[0] : [];
}

// ─── Main Class ───────────────────────────────────────────────────────────────

class WTRLab {
  id         = 'wtrlab';
  name       = 'WTR-LAB';
  version    = '1.0.0';
  site       = 'https://wtr-lab.com';
  sourceLang = 'en/';

  /**
   * @param {{ hideLocked?: boolean }} options
   */
  constructor({ hideLocked = false } = {}) {
    this.hideLocked = hideLocked;
  }

  // ─── Novel Listesi ────────────────────────────────────────────────────────

  /**
   * JSON yanıtından novel listesi oluşturur (showLatestNovels modu).
   * @param {Array} data  — API'den gelen datum dizisi
   * @returns {Array<{ name, cover, path }>}
   */
  parseNovelsFromJson(data) {
    return data.map(datum => ({
      name:  datum.serie.data.title || datum.serie.slug || '',
      cover: datum.serie.data.image || '',
      path:  `${this.sourceLang}serie-${datum.serie.raw_id}/${datum.serie.slug}`,
    }));
  }

  /**
   * Novel finder JSON yanıtından novel listesi oluşturur.
   * @param {Array} series
   * @returns {Array<{ name, cover, path }>}
   */
  parseNovelsFromFinder(series) {
    const seenIds = new Set();
    return series
      .filter(novel => {
        if (seenIds.has(novel.raw_id)) return false;
        seenIds.add(novel.raw_id);
        return true;
      })
      .map(novel => ({
        name:  novel.data.title,
        cover: novel.data.image,
        path:  `${this.sourceLang}serie-${novel.raw_id}/${novel.slug}`,
      }));
  }

  // ─── Popüler / Filtrelenmiş Novellar ──────────────────────────────────────

  /**
   * @param {number} pageNo
   * @param {{ showLatestNovels?: boolean, filters?: object }} options
   * @returns {Promise<Array>}
   */
  async popularNovels(pageNo = 1, { showLatestNovels = false, filters = {} } = {}) {
    // Son eklenen noveller — /api/home/recent endpoint'i
    if (showLatestNovels) {
      const response = await fetchApi(`${this.site}/api/home/recent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ page: pageNo }),
      });
      const json = await response.json();
      return this.parseNovelsFromJson(json.data || []);
    }

    // Novel finder — Next.js data API üzerinden
    const params = new URLSearchParams();
    params.append('orderBy',        filters.orderBy?.value        ?? 'update');
    params.append('order',          filters.order?.value          ?? 'desc');
    params.append('status',         filters.status?.value         ?? 'all');
    params.append('release_status', filters.release_status?.value ?? 'all');
    params.append('addition_age',   filters.addition_age?.value   ?? 'all');
    params.append('page',           String(pageNo));

    if (filters.search?.value) {
      params.append('text', filters.search.value);
    }

    // Genre dahil / hariç
    const genreInclude = filters.genres?.value?.include;
    const genreExclude = filters.genres?.value?.exclude;
    if (genreInclude && genreInclude.length > 0) {
      params.append('gi', genreInclude.join(','));
      params.append('gc', filters.genre_operator?.value ?? 'and');
    }
    if (genreExclude && genreExclude.length > 0) {
      params.append('ge', genreExclude.join(','));
    }

    // Tag dahil / hariç
    const tagInclude = filters.tags?.value?.include;
    const tagExclude = filters.tags?.value?.exclude;
    if (tagInclude && tagInclude.length > 0) {
      params.append('ti', tagInclude.join(','));
      params.append('tc', filters.tag_operator?.value ?? 'and');
    }
    if (tagExclude && tagExclude.length > 0) {
      params.append('te', tagExclude.join(','));
    }

    // Kütüphane filtreleri
    if (filters.folders?.value)         params.append('folders', filters.folders.value);
    if (filters.library_exclude?.value) params.append('le', filters.library_exclude.value);

    // Minimum değer filtreleri
    if (filters.min_chapters?.value)     params.append('minc',  filters.min_chapters.value);
    if (filters.min_rating?.value)       params.append('minr',  filters.min_rating.value);
    if (filters.min_review_count?.value) params.append('minrc', filters.min_review_count.value);

    // buildId'yi novel-finder sayfasından al
    const finderPage = await fetchApi(`${this.site}/en/novel-finder`).then(r => r.text());
    const $finder    = parseHTML(finderPage);
    const nextData   = $finder('#__NEXT_DATA__').html();

    if (!nextData) throw new Error('__NEXT_DATA__ bulunamadı (novel-finder)');

    const buildId = JSON.parse(nextData).buildId;
    const apiUrl  = `${this.site}/_next/data/${buildId}/en/novel-finder.json?${params.toString()}`;

    const response = await fetchApi(apiUrl);
    const json     = await response.json();

    return this.parseNovelsFromFinder(json.pageProps?.series || []);
  }

  // ─── Bölüm Listesi ────────────────────────────────────────────────────────

  /**
   * Ham ID ve slug'dan tüm bölümleri batch halinde çeker.
   * @param {number} rawId
   * @param {number} totalChapters
   * @param {string} slug
   * @returns {Promise<Array<{ name, path, releaseTime, chapterNumber }>>}
   */
  async fetchAllChapters(rawId, totalChapters, slug) {
    const allChapters = [];
    const batchSize   = 250;

    for (let start = 1; start <= totalChapters; start += batchSize) {
      const end = Math.min(start + batchSize - 1, totalChapters);

      try {
        const response = await fetchApi(
          `${this.site}/api/chapters/${rawId}?start=${start}&end=${end}`,
        );
        const data = await response.json();

        if (Array.isArray(data.chapters)) {
          const batch = data.chapters.map(ch => ({
            name:          ch.title,
            path:          `${this.sourceLang}serie-${rawId}/${slug}/chapter-${ch.order}`,
            releaseTime:   ch.updated_at?.substring(0, 10),
            chapterNumber: ch.order,
          }));
          allChapters.push(...batch);
        }

        if (!data.chapters || data.chapters.length < batchSize) break;
      } catch (error) {
        console.error(`Bölümler ${start}-${end} alınamadı:`, error);
      }
    }

    return allChapters.sort((a, b) => (a.chapterNumber || 0) - (b.chapterNumber || 0));
  }

  /**
   * Novel path'inden bölüm listesini döndürür.
   * @param {string} novelPath  e.g. "en/serie-12345/novel-slug"
   * @returns {Promise<Array<{ name, path }>>}
   */
  async parseChapters(novelPath) {
    // rawId ve slug'u URL'den çıkar
    const urlMatch = novelPath.match(/serie-(\d+)\/([^/]+)/);
    if (!urlMatch) return [];

    const rawId = parseInt(urlMatch[1]);
    const slug  = urlMatch[2];

    // Bölüm sayısını novel sayfasından al
    const url  = `${this.site}/${novelPath}`;
    const body = await fetchApi(url).then(r => r.text());
    const $    = parseHTML(body);

    const chapterCountText  = $('div:contains("Chapters")').text();
    const chapterCountMatch = chapterCountText.match(/(\d+)\s+Chapters?/i);
    const totalChapters     = chapterCountMatch ? parseInt(chapterCountMatch[1]) : 0;

    if (!totalChapters) return [];

    return this.fetchAllChapters(rawId, totalChapters, slug);
  }

  // ─── Novel Detayları ──────────────────────────────────────────────────────

  /**
   * @param {string} novelPath  e.g. "en/serie-12345/novel-slug"
   * @returns {Promise<object>}
   */
  async parseNovel(novelPath) {
    const url  = `${this.site}/${novelPath}`;
    const body = await fetchApi(url).then(r => r.text());
    const $    = parseHTML(body);

    const nextDataText = $('#__NEXT_DATA__').html();

    let rawId         = null;
    let slug          = null;
    let chapterCount  = 0;

    const novel = {
      path:    novelPath,
      name:    '',
      cover:   '',
      summary: '',
      author:  '',
      status:  'Unknown',
      genres:  '',
      chapters: [],
    };

    // __NEXT_DATA__ öncelikli kaynak
    if (nextDataText) {
      try {
        const jsonData  = JSON.parse(nextDataText);
        const serieData = jsonData?.props?.pageProps?.serie?.serie_data;

        if (serieData) {
          novel.name    = serieData.data?.title       || '';
          novel.cover   = serieData.data?.image       || '';
          novel.summary = serieData.data?.description || '';
          novel.author  = serieData.data?.author      || '';
          rawId         = serieData.raw_id  || null;
          slug          = serieData.slug    || null;

          switch (serieData.status) {
            case 0: novel.status = 'Ongoing';   break;
            case 1: novel.status = 'Completed'; break;
            default: novel.status = 'Unknown';
          }
        }
      } catch (err) {
        console.error('__NEXT_DATA__ parse hatası:', err);
      }
    }

    // Fallback: HTML'den çek
    if (!novel.name) {
      novel.name =
        $('h1.text-uppercase').text().trim() ||
        $('h1.long-title').text().trim()     ||
        $('.title-wrap h1').text().trim()    ||
        'No Title Found';
    }

    if (!novel.cover) {
      novel.cover =
        $('.image-wrap img').attr('src') ||
        $('.img-wrap > img').attr('src') || '';
    }

    if (!novel.summary) {
      novel.summary =
        $('.description').text().trim()           ||
        $('.desc-wrap .description').text().trim() ||
        $('.lead').text().trim()                   ||
        'No Summary Found';
    }

    // Genre
    const genres = $('td:contains("Genre")').next().find('a')
      .map((_, el) => $(el).text().replace(/<!--.*?-->/g, '').trim())
      .get()
      .filter(Boolean);

    if (genres.length > 0) {
      novel.genres = genres.map(g => g.replace(/,$/, '').trim()).join(', ');
    }

    // Tags → genres'e ekle
    const tags = $('td:contains("Tags")').next().find('a')
      .map((_, el) => $(el).text().replace(/<!--.*?-->/g, '').replace(/,$/, '').trim())
      .get()
      .filter(Boolean);

    if (tags.length > 0) {
      const existing = novel.genres ? novel.genres.split(', ') : [];
      const combined = [...existing, ...tags].filter(Boolean);
      const unique   = combined.filter((g, i) => combined.indexOf(g) === i);
      novel.genres   = unique.join(', ');
    }

    // Author fallback
    if (!novel.author) {
      novel.author =
        $('td:contains("Author")').next().text().replace(/[\t\n]/g, '').trim() || 'No Author Found';
    }

    // Status fallback
    if (!novel.status || novel.status === 'Unknown') {
      novel.status =
        $('td:contains("Status")').next().text().replace(/[\t\n]/g, '').trim() || 'Unknown';
    }

    // URL'den rawId / slug çıkar (önce __NEXT_DATA__ yoksa)
    if (!rawId || !slug) {
      const m = novelPath.match(/serie-(\d+)\/([^/]+)/);
      if (m) {
        rawId = parseInt(m[1]);
        slug  = m[2];
      }
    }

    // Bölüm sayısı
    const chapterText  = $('div:contains("Chapters")').text();
    const chapterMatch = chapterText.match(/(\d+)\s+Chapters?/i);
    if (chapterMatch) chapterCount = parseInt(chapterMatch[1]);

    // Bölümleri API'den çek
    if (rawId && slug && chapterCount > 0) {
      try {
        novel.chapters = await this.fetchAllChapters(rawId, chapterCount, slug);
      } catch (err) {
        console.error('Bölümler alınamadı:', err);
        novel.chapters = [];
      }
    }

    return novel;
  }

  // ─── Bölüm İçeriği ───────────────────────────────────────────────────────

  /**
   * @param {string} chapterPath  e.g. "en/serie-12345/novel-slug/chapter-1"
   * @returns {Promise<string>} HTML string
   */
  async parseChapter(chapterPath) {
    const url = `${this.site}/${chapterPath}`;

    // rawId ve chapterNo'yu URL'den çek
    const urlMatch = chapterPath.match(/serie-(\d+)\/[^/]+\/chapter-(\d+)/);
    let rawId     = urlMatch ? parseInt(urlMatch[1], 10)  : null;
    let chapterNo = urlMatch ? parseInt(urlMatch[2], 10)  : null;
    let $         = null;

    // URL'den alınamazsa sayfayı parse et
    if (!rawId || !chapterNo) {
      const body    = await fetchApi(url).then(r => r.text());
      $             = parseHTML(body);
      const jsonStr = $('#__NEXT_DATA__').html() || '{}';
      const json    = JSON.parse(jsonStr);
      rawId         = json?.props?.pageProps?.serie?.chapter?.raw_id   || null;
      chapterNo     = json?.props?.pageProps?.serie?.chapter?.order    || null;
    }

    if (!rawId || !chapterNo) {
      throw new Error(`Geçersiz bölüm parametreleri: ${chapterPath}`);
    }

    // AI veya web çevirisi dene
    const translationTypes = ['ai', 'web'];
    let parsedJson;
    let lastError = '';

    for (const type of translationTypes) {
      const apiResponse = await fetchApi(`${this.site}/api/reader/get`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept':       'application/json',
          'Referer':      url,
        },
        body: JSON.stringify({
          translate:    type,
          language:     this.sourceLang.replace('/', ''),
          raw_id:       rawId,
          chapter_no:   chapterNo,
          retry:        false,
          force_retry:  false,
        }),
      });

      parsedJson = await apiResponse.json();

      if (apiResponse.ok && !parsedJson.error) break;
      if (parsedJson.error) lastError = parsedJson.error;
    }

    if (parsedJson.success === false) {
      throw new Error(parsedJson.message || 'Bölüm alınamadı');
    }

    let chapterContent  = parsedJson.data.data.body;
    const chapterGlossary = parsedJson.data.data.glossary_data || {};

    let htmlString = '';

    // Şifreli içerik varsa çöz + Google Translate ile çevir
    if (
      chapterContent.toString().startsWith('arr:') ||
      chapterContent.toString().startsWith('str:')
    ) {
      if (!$) {
        const body = await fetchApi(url).then(r => r.text());
        $          = parseHTML(body);
      }

      const encKey = await getKey($);
      chapterContent = await decrypt(chapterContent, encKey);

      if (chapterContent?.error) {
        htmlString += `<p>${chapterContent.error}</p>`;
        return htmlString;
      }

      chapterContent = await translate(chapterContent);
      htmlString += `<p><small>Cihazınızda Google Translate ile çevrildi (kaynak yöntemi) — Yapay zeka çevirisi için web görünümünden giriş yapın.</small></p>`;
    }

    if (lastError) {
      htmlString += `<p style="color:darkred;">${lastError}</p>`;
    }

    // Sözlük değiştirme
    let dictionary = {};
    if (chapterGlossary?.terms) {
      dictionary = Object.fromEntries(
        chapterGlossary.terms.map((definition, index) => [
          `※${index}⛬`,
          definition[0],
        ]),
      );
    }

    for (let text of chapterContent) {
      if (Object.keys(dictionary).length > 0) {
        text = text.replaceAll(/※[0-9]+⛬/g, m => dictionary[m] || m);
      }
      htmlString += `<p>${text}</p>`;
    }

    return htmlString;
  }

  // ─── Arama ───────────────────────────────────────────────────────────────

  /**
   * @param {string} searchTerm
   * @param {number} pageNo
   * @returns {Promise<Array>}
   */
  async searchNovels(searchTerm, pageNo = 1) {
    const searchFilters = { ...this.filters };
    searchFilters.search = { ...searchFilters.search, value: searchTerm };
    return this.popularNovels(pageNo, { showLatestNovels: false, filters: searchFilters });
  }
}

// ─── Filter Definitions ───────────────────────────────────────────────────────

export const filters = {
  search: {
    label: 'Search',
    value: '',
    type:  'TextInput',
  },
  orderBy: {
    label: 'Order By',
    value: 'update',
    type:  'Picker',
    options: [
      { label: 'Update Date',    value: 'update'       },
      { label: 'Addition Date',  value: 'date'         },
      { label: 'Random',         value: 'random'       },
      { label: 'Weekly View',    value: 'weekly_rank'  },
      { label: 'Monthly View',   value: 'monthly_rank' },
      { label: 'All-Time View',  value: 'view'         },
      { label: 'Name',           value: 'name'         },
      { label: 'Reader',         value: 'reader'       },
      { label: 'Chapter',        value: 'chapter'      },
      { label: 'Rating',         value: 'rating'       },
      { label: 'Review Count',   value: 'total_rate'   },
      { label: 'Vote Count',     value: 'vote'         },
    ],
  },
  order: {
    label: 'Order',
    value: 'desc',
    type:  'Picker',
    options: [
      { label: 'Descending', value: 'desc' },
      { label: 'Ascending',  value: 'asc'  },
    ],
  },
  status: {
    label: 'Status',
    value: 'all',
    type:  'Picker',
    options: [
      { label: 'All',       value: 'all'       },
      { label: 'Ongoing',   value: 'ongoing'   },
      { label: 'Completed', value: 'completed' },
      { label: 'Hiatus',    value: 'hiatus'    },
      { label: 'Dropped',   value: 'dropped'   },
    ],
  },
  release_status: {
    label: 'Release Status',
    value: 'all',
    type:  'Picker',
    options: [
      { label: 'All',       value: 'all'      },
      { label: 'Released',  value: 'released' },
      { label: 'On Voting', value: 'voting'   },
    ],
  },
  addition_age: {
    label: 'Addition Age',
    value: 'all',
    type:  'Picker',
    options: [
      { label: 'All',         value: 'all'   },
      { label: '< 2 Days',    value: 'day'   },
      { label: '< 1 Week',    value: 'week'  },
      { label: '< 1 Month',   value: 'month' },
    ],
  },
  min_chapters: {
    label: 'Minimum Chapters',
    value: '',
    type:  'TextInput',
  },
  min_rating: {
    label: 'Minimum Rating (0.0-5.0)',
    value: '',
    type:  'TextInput',
  },
  min_review_count: {
    label: 'Minimum Review Count',
    value: '',
    type:  'TextInput',
  },
  genre_operator: {
    label: 'Genre (And/Or)',
    value: 'and',
    type:  'Picker',
    options: [
      { label: 'And', value: 'and' },
      { label: 'Or',  value: 'or'  },
    ],
  },
  genres: {
    label: 'Genres',
    value: { include: [], exclude: [] },
    type:  'ExcludableCheckboxGroup',
    options: [
      { label: 'Male Protagonist',            value: '417' },
      { label: 'Transmigration',              value: '717' },
      { label: 'System',                      value: '696' },
      { label: 'Cultivation',                 value: '169' },
      { label: 'Special Abilities',           value: '667' },
      { label: 'Female Protagonist',          value: '275' },
      { label: 'Fanfiction',                  value: '263' },
      { label: 'Weak to Strong',              value: '750' },
      { label: 'Handsome Male Lead',          value: '327' },
      { label: 'Beautiful Female Lead',       value: '81'  },
      { label: 'Game Elements',               value: '297' },
      { label: 'Cheats',                      value: '122' },
      { label: 'Genius Protagonist',          value: '306' },
      { label: 'Reincarnation',               value: '578' },
      { label: 'Harem-seeking Protagonist',   value: '329' },
      { label: 'Time Travel',                 value: '710' },
      { label: 'Overpowered Protagonist',     value: '506' },
      { label: 'Modern Day',                  value: '446' },
      { label: 'Business Management',         value: '108' },
      { label: 'Calm Protagonist',            value: '111' },
      { label: 'Magic',                       value: '410' },
      { label: 'Immortals',                   value: '357' },
      { label: 'Clever Protagonist',          value: '134' },
      { label: 'Ruthless Protagonist',        value: '595' },
      { label: 'Apocalypse',                  value: '47'  },
      { label: 'World Hopping',               value: '756' },
      { label: 'Poor to Rich',                value: '540' },
      { label: 'Farming',                     value: '266' },
      { label: 'Fantasy World',               value: '265' },
      { label: 'Kingdom Building',            value: '379' },
      { label: 'Fast Cultivation',            value: '267' },
      { label: 'Cultivation Genius',          value: '560' },
      { label: 'Cunning Protagonist',         value: '171' },
      { label: 'Schemes And Conspiracies',    value: '601' },
      { label: 'Survival',                    value: '692' },
      { label: 'Post-apocalyptic',            value: '544' },
      { label: 'Hard-Working Protagonist',    value: '328' },
      { label: 'Showbiz',                     value: '640' },
      { label: 'Unlimited Flow',              value: '735' },
      { label: 'Demons',                      value: '191' },
      { label: 'Monsters',                    value: '452' },
      { label: 'Dragons',                     value: '216' },
      { label: 'Romantic Subplot',            value: '592' },
      { label: 'Polygamy',                    value: '538' },
      { label: 'Evolution',                   value: '248' },
      { label: 'Leadership',                  value: '388' },
      { label: 'Alternate World',             value: '30'  },
      { label: 'Alchemy',                     value: '27'  },
      { label: 'Arrogant Characters',         value: '56'  },
      { label: 'Multiple Realms',             value: '459' },
      { label: 'Army Building',               value: '54'  },
      { label: 'Revenge',                     value: '585' },
      { label: 'Second Chance',               value: '606' },
      { label: 'Ancient China',               value: '34'  },
      { label: 'Academy',                     value: '5'   },
      { label: 'Mythology',                   value: '473' },
      { label: 'Gods',                        value: '316' },
      { label: 'Futuristic Setting',          value: '294' },
      { label: 'Parallel Worlds',             value: '510' },
      { label: 'Level System',                value: '390' },
      { label: 'Virtual Reality',             value: '742' },
      { label: 'Medical Knowledge',           value: '433' },
      { label: 'Apocalypse',                  value: '47'  },
    ],
  },
  tag_operator: {
    label: 'Tag (And/Or)',
    value: 'and',
    type:  'Picker',
    options: [
      { label: 'And', value: 'and' },
      { label: 'Or',  value: 'or'  },
    ],
  },
  tags: {
    label: 'Tags',
    value: { include: [], exclude: [] },
    type:  'ExcludableCheckboxGroup',
    options: [
      { label: 'Male Protagonist',          value: '417' },
      { label: 'Transmigration',            value: '717' },
      { label: 'System',                    value: '696' },
      { label: 'Cultivation',               value: '169' },
      { label: 'Special Abilities',         value: '667' },
      { label: 'Female Protagonist',        value: '275' },
      { label: 'Fanfiction',                value: '263' },
      { label: 'Weak to Strong',            value: '750' },
      { label: 'Game Elements',             value: '297' },
      { label: 'Genius Protagonist',        value: '306' },
      { label: 'Reincarnation',             value: '578' },
      { label: 'Time Travel',               value: '710' },
      { label: 'Overpowered Protagonist',   value: '506' },
      { label: 'Magic',                     value: '410' },
      { label: 'Apocalypse',                value: '47'  },
      { label: 'World Hopping',             value: '756' },
      { label: 'Farming',                   value: '266' },
      { label: 'Fantasy World',             value: '265' },
      { label: 'Kingdom Building',          value: '379' },
      { label: 'Demons',                    value: '191' },
      { label: 'Unlimited Flow',            value: '735' },
      { label: 'Post-apocalyptic',          value: '544' },
      { label: 'Showbiz',                   value: '640' },
    ],
  },
  folders: {
    label: 'Library Folders',
    value: '',
    type:  'Picker',
    options: [
      { label: 'No Filter',  value: ''  },
      { label: 'Reading',    value: '1' },
      { label: 'Read Later', value: '2' },
      { label: 'Completed',  value: '3' },
      { label: 'Trash',      value: '5' },
    ],
  },
  library_exclude: {
    label: 'Library Exclude',
    value: '',
    type:  'Picker',
    options: [
      { label: 'None',                   value: ''           },
      { label: 'Exclude All',            value: 'history'    },
      { label: 'Exclude Trash',          value: 'trash'      },
      { label: 'Exclude Library & Trash',value: 'in_library' },
    ],
  },
};

export default WTRLab;

/**
 * Webnovel.com Downloader Library
 * Node.js ESM port of the Webnovel plugin (v1.0.3)
 * Usage: import Webnovel from './webnovel/index.js'
 */

import { load as parseHTML } from 'cheerio';
import fetch from 'node-fetch';
import { gotScraping } from 'got-scraping';
// ─── Helpers ──────────────────────────────────────────────────────────────────

const DEFAULT_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
};

async function fetchApi(url, options = {}) {
  try {
    const response = await gotScraping({
      url,
      method: options.method || 'GET',
      body: options.body,
      headers: { ...DEFAULT_HEADERS, ...options.headers },
      // gotScraping arka planda tarayc TLS parmak izini otomatik taklit eder
    });
    
    // Mevcut kodunun (response.text(), response.json() vb.) krlmamas i�in
    // d�nen objeyi fetch API'sine benzer bir yapya b�r�nd�r�yoruz:
    return {
      ok: response.statusCode >= 200 && response.statusCode < 300,
      status: response.statusCode,
      statusText: response.statusMessage,
      url: response.url,
      text: async () => response.body,
      json: async () => JSON.parse(response.body),
    };
  } catch (error) {
    throw new Error(`HTTP Fetch Hatas (${url}): ${error.message}`);
  }
}

// ─── Main Class ───────────────────────────────────────────────────────────────

class Webnovel {
  id      = 'webnovel';
  name    = 'Webnovel';
  version = '1.0.3';
  site    = 'https://www.webnovel.com';

  /**
   * @param {{ hideLocked?: boolean }} options
   *   hideLocked — kilitli bölümleri liste dışı bırak (varsayılan: false)
   */
  constructor({ hideLocked = false } = {}) {
    this.hideLocked = hideLocked;
  }

  // ─── Novel listesi ────────────────────────────────────────────────────────

  /**
   * @param {import('cheerio').CheerioAPI} $
   * @param {boolean} isCategoryPage
   * @param {boolean} isSearchPage
   * @returns {Array}
   */
  parseNovels($, isCategoryPage, isSearchPage) {
    const selector  = isCategoryPage ? '.j_category_wrapper' : isSearchPage ? '.j_list_container' : '';
    const attribute = isCategoryPage ? 'data-original'       : isSearchPage ? 'src'              : '';

    return $(`${selector} li`)
      .map((_, ele) => {
        const name  = $(ele).find('.g_thumb').attr('title') || 'No Title Found';
        const cover = $(ele).find('.g_thumb > img').attr(attribute);
        const path  = $(ele).find('.g_thumb').attr('href');
        if (!path) return null;
        return { name, cover: cover ? 'https:' + cover : '', path };
      })
      .get()
      .filter(Boolean);
  }

  // ─── Popüler / filtrelenmiş novellar ──────────────────────────────────────

  /**
   * @param {number} pageNo
   * @param {{ showLatestNovels?: boolean, filters?: object }} options
   * @returns {Promise<Array>}
   */
  async popularNovels(pageNo = 1, { showLatestNovels = false, filters = {} } = {}) {
    // Fanfic araması filtreden geliyorsa
    if (filters?.fanfic_search?.value) {
      return this.searchNovelsInternal(filters.fanfic_search.value, pageNo, 'fanfic');
    }

    let url = this.site + '/stories/';
    const params = new URLSearchParams();

    if (showLatestNovels) {
      url += `novel?orderBy=5&pageIndex=${pageNo}`;
    } else if (Object.keys(filters).length > 0) {
      const gender = filters.genres_gender?.value;

      if (gender === '1') {
        const maleSel = filters.genres_male?.value;
        if (maleSel && maleSel !== '1') url += maleSel;
        else { url += 'novel'; params.append('gender', '1'); }
      } else if (gender === '2') {
        const femaleSel = filters.genres_female?.value;
        if (femaleSel && femaleSel !== '2') url += femaleSel;
        else { url += 'novel'; params.append('gender', '2'); }
      } else {
        url += 'novel';
      }

      const typeVal = filters.type?.value ?? '0';
      if (typeVal !== '3') {
        params.append('sourceType', typeVal);
      } else {
        params.append('translateMode', '3');
        params.append('sourceType', '1');
      }

      params.append('bookStatus', filters.status?.value ?? '0');
      params.append('orderBy',    filters.sort?.value   ?? '1');
      params.append('pageIndex',  String(pageNo));

      url += '?' + params.toString();
    } else {
      url += `novel?orderBy=1&pageIndex=${pageNo}`;
    }

    const body = await fetchApi(url).then(r => r.text());
    return this.parseNovels(parseHTML(body), true, false);
  }

  // ─── Bölüm listesi ────────────────────────────────────────────────────────

  /**
   * @param {string} novelPath  e.g. "/book/12345/novel-title"
   * @returns {Promise<Array>}
   */
  async parseChapters(novelPath) {
    const url  = this.site + novelPath + '/catalog';
    const body = await fetchApi(url).then(r => r.text());
    const $    = parseHTML(body);
    const chapters = [];

    $('.volume-item').each((_, eleV) => {
      const rawVolName = $(eleV).first().text().trim();
      const volMatch   = rawVolName.match(/Volume\s(\d+)/);
      const volumeName = volMatch ? `Volume ${volMatch[1]}` : 'Unknown Volume';

      $(eleV).find('li').each((_, eleC) => {
        const title  = $(eleC).find('a').attr('title')?.trim() || 'No Title Found';
        const path   = $(eleC).find('a').attr('href');
        const locked = $(eleC).find('svg').length > 0;

        if (!path) return;
        if (locked && this.hideLocked) return;

        chapters.push({
          name: locked ? `${volumeName}: ${title} 🔒` : `${volumeName}: ${title}`,
          path,
        });
      });
    });

    return chapters;
  }

  // ─── Novel detayları ──────────────────────────────────────────────────────

  /**
   * @param {string} novelPath  e.g. "/book/12345/novel-title"
   * @returns {Promise<object>}
   */
  async parseNovel(novelPath) {
    const url  = this.site + novelPath;
    const body = await fetchApi(url).then(r => r.text());
    const $    = parseHTML(body);

    // br → \n
    $('.j_synopsis > p').find('br').replaceWith('\n');

    const novel = {
      path:    novelPath,
      name:    $('.g_thumb > img').attr('alt')  || 'No Title Found',
      cover:   'https:' + ($('.g_thumb > img').attr('src') || ''),
      genres:  $('.det-hd-detail > .det-hd-tag').attr('title') || '',
      summary: $('.j_synopsis > p').text().trim() || 'No Summary Found',
      author:  $('.det-info .c_s')
                 .filter((_, el) => $(el).text().trim() === 'Author:')
                 .next()
                 .text()
                 .trim() || 'No Author Found',
      status:  $('.det-hd-detail svg')
                 .filter((_, el) => $(el).attr('title') === 'Status')
                 .next()
                 .text()
                 .trim() || 'Unknown Status',
      chapters: await this.parseChapters(novelPath),
    };

    return novel;
  }

  // ─── Bölüm içeriği ───────────────────────────────────────────────────────

  /**
   * @param {string} chapterPath  e.g. "/book/12345/novel-title/chapter/123456"
   * @returns {Promise<string>} HTML string
   */
  async parseChapter(chapterPath) {
    const url  = this.site + chapterPath;
    const body = await fetchApi(url).then(r => r.text());
    const $    = parseHTML(body);

    $('.para-comment').remove();

    const title   = $('.cha-tit').html()   || '';
    const content = $('.cha-words').html() || '';

    return title + content;
  }

  // ─── Arama ───────────────────────────────────────────────────────────────

  /**
   * @param {string} searchTerm
   * @param {number} pageNo
   * @returns {Promise<Array>}
   */
  async searchNovels(searchTerm, pageNo = 1) {
    return this.searchNovelsInternal(searchTerm, pageNo);
  }

  async searchNovelsInternal(searchTerm, pageNo = 1, type = '') {
    const term = encodeURIComponent(searchTerm.replace(/\s+/g, '+'));
    const url  = `${this.site}/search?keywords=${term}&pageIndex=${pageNo}${type ? `&type=${type}` : ''}`;
    const body = await fetchApi(url).then(r => r.text());
    return this.parseNovels(parseHTML(body), false, true);
  }
}

// ─── Filter definitions ───────────────────────────────────────────────────────

export const filters = {
  sort: {
    label: 'Sort Results By', value: '1', type: 'Picker',
    options: [
      { label: 'Popular',          value: '1' },
      { label: 'Recommended',      value: '2' },
      { label: 'Most Collections', value: '3' },
      { label: 'Rating',           value: '4' },
      { label: 'Time Updated',     value: '5' },
    ],
  },
  status: {
    label: 'Content Status', value: '0', type: 'Picker',
    options: [
      { label: 'All',       value: '0' },
      { label: 'Completed', value: '2' },
      { label: 'Ongoing',   value: '1' },
    ],
  },
  genres_gender: {
    label: 'Genres (Male/Female)', value: '1', type: 'Picker',
    options: [
      { label: 'Male',   value: '1' },
      { label: 'Female', value: '2' },
    ],
  },
  genres_male: {
    label: 'Male Genres', value: '1', type: 'Picker',
    options: [
      { label: 'All',                          value: '1'                    },
      { label: 'Action',                       value: 'novel-action-male'    },
      { label: 'Animation, Comics, Games',     value: 'novel-acg-male'       },
      { label: 'Eastern',                      value: 'novel-eastern-male'   },
      { label: 'Fantasy',                      value: 'novel-fantasy-male'   },
      { label: 'Games',                        value: 'novel-games-male'     },
      { label: 'History',                      value: 'novel-history-male'   },
      { label: 'Horror',                       value: 'novel-horror-male'    },
      { label: 'Realistic',                    value: 'novel-realistic-male' },
      { label: 'Sci-fi',                       value: 'novel-scifi-male'     },
      { label: 'Sports',                       value: 'novel-sports-male'    },
      { label: 'Urban',                        value: 'novel-urban-male'     },
      { label: 'War',                          value: 'novel-war-male'       },
    ],
  },
  genres_female: {
    label: 'Female Genres', value: '2', type: 'Picker',
    options: [
      { label: 'All',     value: '2'                     },
      { label: 'Fantasy', value: 'novel-fantasy-female'  },
      { label: 'General', value: 'novel-general-female'  },
      { label: 'History', value: 'novel-history-female'  },
      { label: 'LGBT+',   value: 'novel-lgbt-female'     },
      { label: 'Sci-fi',  value: 'novel-scifi-female'    },
      { label: 'Teen',    value: 'novel-teen-female'     },
      { label: 'Urban',   value: 'novel-urban-female'    },
    ],
  },
  type: {
    label: 'Content Type', value: '0', type: 'Picker',
    options: [
      { label: 'All',                       value: '0' },
      { label: 'Translate',                 value: '1' },
      { label: 'Original',                  value: '2' },
      { label: 'MTL (Machine Translation)', value: '3' },
    ],
  },
  fanfic_search: {
    label: 'Search fanfics (Overrides other filters)',
    value: '',
    type:  'TextInput',
  },
};

export default Webnovel;


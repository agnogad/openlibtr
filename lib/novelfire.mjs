/**
 * Novel Fire Downloader Library
 * Node.js ESM port of the NovelFire plugin
 */

import { load as parseHTML } from 'cheerio';
import { gotScraping } from 'got-scraping';

// ─── Config ───────────────────────────────────────────────────────────────────

const DEFAULT_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
};

const DEFAULT_COVER = 'https://via.placeholder.com/300x450?text=No+Cover';

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

// ─── In-Memory Storage ────────────────────────────────────────────────────────

const storage = new Map();

// ─── Main Class ───────────────────────────────────────────────────────────────

class NovelFire {
  id      = 'novelfire';
  name    = 'Novel Fire';
  version = '1.3.0';
  site    = 'https://novelfire.net/';

  constructor() {
    this.novelList = [];
    this.draw = 0;
  }

  // ─── Cheerio Parser ───────────────────────────────────────────────────────

  async getCheerio(url, search = false) {
    const r = await fetchApi(url);
    if (!r.ok && !search)
      throw new Error(
        'Could not reach site (' + r.status + ') try to open in webview.',
      );
    const $ = parseHTML(await r.text());

    if ($('title').text().includes('Cloudflare')) {
      throw new Error('Cloudflare is blocking requests. Try again later.');
    }

    return $;
  }

  // ─── Novel Listesi ────────────────────────────────────────────────────────

  parseNovels($, selector = '.novel-item') {
    const novels = [];

    $(selector).each((_, el) => {
      const $el = $(el);
      const titleElement = $el.find('.novel-title > a');
      const fallbackElement = $el.find('a');

      const novelName =
        titleElement.text() ||
        fallbackElement.attr('title') ||
        'No Title Found';

      const imgElement = $el.find('.novel-cover > img');
      const rawSrc = imgElement.attr('data-src') ?? imgElement.attr('src');
      const novelCover = rawSrc
        ? new URL(rawSrc, this.site).href
        : DEFAULT_COVER;

      const novelPath =
        titleElement.attr('href') || fallbackElement.attr('href');

      if (!novelPath) return;

      const novel = {
        name: novelName,
        cover: novelCover,
        path: new URL(novelPath, this.site).pathname.substring(1),
      };

      if (this.novelList.includes(novel.path)) return;
      this.novelList.push(novel.path);
      novels.push(novel);
    });

    return novels;
  }

  // ─── Popüler / Filtrelenmiş Novellar ──────────────────────────────────────

  /**
   * @param {number} pageNo
   * @param {{ showLatestNovels?: boolean, filters?: object }} options
   * @returns {Promise<Array>}
   */
  async popularNovels(pageNo = 1, { showLatestNovels = false, filters = {} } = {}) {
    if (pageNo === 1) {
      this.novelList = [];
      this.draw = 0;
    }

    const url = this.site + 'search-adv';
    const params = new URLSearchParams();

    if (filters?.language?.value) {
      for (const lang of filters.language.value) {
        params.append('country_id[]', lang);
      }
    }
    if (filters?.genre_operator?.value) {
      params.append('ctgcon', filters.genre_operator.value);
    }
    if (filters?.genres?.value) {
      for (const genre of filters.genres.value) {
        params.append('categories[]', genre);
      }
    }
    if (filters?.chapters?.value) {
      params.append('totalchapter', filters.chapters.value);
    }
    if (filters?.rating_operator?.value) {
      params.append('ratcon', filters.rating_operator.value);
    }
    if (filters?.rating?.value) {
      params.append('rating', filters.rating.value);
    }
    if (filters?.status?.value) {
      params.append('status', filters.status.value);
    }

    params.append('sort', showLatestNovels ? 'date' : (filters?.sort?.value ?? 'rank-top'));
    params.append('tagcon', 'and');
    params.append('page', pageNo.toString());

    const $ = await this.getCheerio(`${url}?${params.toString()}`, false);
    return this.parseNovels($);
  }

  // ─── Bölüm Listesi (AJAX) ─────────────────────────────────────────────────

  async getAllChapters(novelPath, postId, page) {
    const url = `${this.site}ajax/listChapterDataAjax`;
    this.draw++;

    const params = new URLSearchParams({
      draw: this.draw.toString(),
      'columns[0][data]': 'n_sort',
      'columns[0][name]': 'cmm_posts_detail.n_sort',
      'columns[0][searchable]': 'true',
      'columns[0][orderable]': 'true',
      'columns[0][search][value]': '',
      'columns[0][search][regex]': 'false',
      'columns[1][data]': 'bookmark_created_at',
      'columns[1][name]': 'bookmark_chapters.created_at',
      'columns[1][searchable]': 'false',
      'columns[1][orderable]': 'true',
      'columns[1][search][value]': '',
      'columns[1][search][regex]': 'false',
      'order[0][column]': '0',
      'order[0][dir]': 'asc',
      'order[0][name]': 'cmm_posts_detail.n_sort',
      start: '0',
      length: '-1',
      'search[value]': '',
      'search[regex]': 'false',
      post_id: postId,
      only_bookmark: 'false',
      _: Date.now().toString(),
    });

    const result = await fetchApi(`${url}?${params.toString()}`);
    if (result.status === 429) throw new Error('Novel Fire is rate limiting requests');

    const body = await result.text();

    if (body.includes('You are being rate limited')) {
      throw new Error('Novel Fire is rate limiting requests');
    }

    if (body.includes('Page Not Found 404')) {
      throw new Error('Novel Fire Ajax interface not found');
    }

    const json = JSON.parse(body);
    const chapters = (json.data || [])
      .map(index => {
        const chapterName = parseHTML(index.title || index.slug).text();
        const chapterPath = `${novelPath}/chapter-${index.n_sort}`;

        if (!chapterPath) return null;

        return {
          name: chapterName,
          path: chapterPath,
          chapterNumber: Number(index.n_sort),
        };
      })
      .filter(chapter => chapter !== null);

    return chapters.sort((a, b) => (a.chapterNumber || 0) - (b.chapterNumber || 0));
  }

  // ─── Sayfa Bazlı Bölüm Parse (Fallback) ───────────────────────────────────

  async parsePage(novelPath, page) {
    const postId = storage.get(`novelfire_postid_${novelPath}`);

    if (postId && !isNaN(Number(postId))) {
      try {
        const chapters = await this.getAllChapters(novelPath, postId, page);
        return { chapters };
      } catch (e) {
        // Fallback to scraping if AJAX fails
      }
    }

    const url = `${this.site}${novelPath}/chapters?page=${page}`;
    const result = await fetchApi(url);
    const body = await result.text();
    const $ = parseHTML(body);

    const chapters = $('.chapter-list li')
      .map((_, ele) => {
        const chapterName = $(ele).find('a').attr('title') || 'No Title Found';
        const chapterPath = $(ele).find('a').attr('href');

        if (!chapterPath) return null;

        return {
          name: chapterName,
          path: new URL(chapterPath, this.site).pathname.substring(1),
        };
      })
      .get()
      .filter(chapter => chapter !== null);

    return { chapters };
  }

  // ─── Novel Detayları ──────────────────────────────────────────────────────

  /**
   * @param {string} novelPath  e.g. "novel/novel-title"
   * @returns {Promise<object>}
   */
  async parseNovel(novelPath) {
    this.draw = 0;
    const $ = await this.getCheerio(this.site + novelPath, false);

    const postId = $('#novel-report').attr('report-post_id');
    if (postId) {
      storage.set(`novelfire_postid_${novelPath}`, postId);
    }

    const novel = {
      path: novelPath,
    };

    novel.name =
      $('.novel-title').text().trim() ||
      $('.cover > img').attr('alt') ||
      'No Title Found';

    const coverUrl =
      $('.cover > img').attr('data-src') ?? $('.cover > img').attr('src');
    novel.cover = coverUrl ? new URL(coverUrl, this.site).href : DEFAULT_COVER;

    novel.genres = $('.categories .property-item')
      .map((i, el) => $(el).text())
      .toArray()
      .join(',');

    const summary = $('.summary .content');
    summary.find('.expand').remove();
    summary.find('br').replaceWith('\n');
    summary.find('p').before('\n').after('\n\n');

    novel.summary =
      summary
        .text()
        .split('\n')
        .map(line => line.trim())
        .join('\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim() || 'Summary Not Found';

    novel.author = $('.author .property-item > span').text();

    const rawStatus =
      $('.header-stats .ongoing').text() ||
      $('.header-stats .completed').text() ||
      'Unknown';

    const statusMap = {
      ongoing: 'Ongoing',
      hiatus: 'OnHiatus',
      dropped: 'Cancelled',
      cancelled: 'Cancelled',
      completed: 'Completed',
      unknown: 'Unknown',
    };
    novel.status = statusMap[rawStatus.toLowerCase()] || 'Unknown';

    novel.rating = parseFloat($('.nub').text().trim()) || 0;

    // Chapters
    const chaptersResult = await this.parsePage(novelPath, 1);
    novel.chapters = chaptersResult.chapters || [];

    return novel;
  }

  // ─── Bölüm İçeriği ───────────────────────────────────────────────────────

  /**
   * @param {string} chapterPath  e.g. "novel/novel-title/chapter-1"
   * @returns {Promise<string>} HTML string
   */
  async parseChapter(chapterPath) {
    const url = this.site + chapterPath;
    const $ = await this.getCheerio(url, false);

    const chapterText = $('#content');

    // Remove novel-fire specific anti-scraping elements
    chapterText.find(
      ':not(p, h1, span, i, b, u, img, a, div, strong)',
    ).each((_, ele) => {
      const tag = ele.name.toString();
      if (tag.length > 5 && tag.substring(0, 2) === 'nf') {
        $(ele).remove();
      }
    });

    return (chapterText.html() || '').replace(/&nbsp;/g, ' ');
  }

  // ─── Arama ───────────────────────────────────────────────────────────────

  /**
   * @param {string} searchTerm
   * @param {number} page
   * @returns {Promise<Array>}
   */
  async searchNovels(searchTerm, page = 1) {
    if (page === 1) {
      this.novelList = [];
      this.draw = 0;
    }

    const params = new URLSearchParams();
    params.append('keyword', searchTerm);
    params.append('page', page.toString());

    const url = `${this.site}search?${params.toString()}`;
    const result = await fetchApi(url);
    const body = await result.text();
    const $ = parseHTML(body);

    return this.parseNovels($, '.novel-list.chapters .novel-item');
  }
}

// ─── Filter Definitions ───────────────────────────────────────────────────────

export const filters = {
  sort: {
    label: 'Sort Results By', value: 'rank-top', type: 'Picker',
    options: [
      { label: 'Rank (Top)',             value: 'rank-top'            },
      { label: 'Rating Score (Top)',     value: 'rating-score-top'    },
      { label: 'Review Count (Most)',    value: 'review'              },
      { label: 'Comment Count (Most)',   value: 'comment'             },
      { label: 'Bookmark Count (Most)',  value: 'bookmark'            },
      { label: 'Today Views (Most)',     value: 'today-view'          },
      { label: 'Monthly Views (Most)',   value: 'monthly-view'        },
      { label: 'Total Views (Most)',     value: 'total-view'          },
      { label: 'Title (A>Z)',            value: 'abc'                 },
      { label: 'Title (Z>A)',            value: 'cba'                 },
      { label: 'Last Updated (Newest)',  value: 'date'                },
      { label: 'Chapter Count (Most)',   value: 'chapter-count-most'  },
    ],
  },
  status: {
    label: 'Translation Status', value: '-1', type: 'Picker',
    options: [
      { label: 'All',       value: '-1' },
      { label: 'Completed', value: '1'  },
      { label: 'Ongoing',   value: '0'  },
    ],
  },
  genre_operator: {
    label: 'Genres (And/Or/Exclude)', value: 'and', type: 'Picker',
    options: [
      { label: 'AND',     value: 'and'     },
      { label: 'OR',      value: 'or'      },
      { label: 'EXCLUDE', value: 'exclude' },
    ],
  },
  genres: {
    label: 'Genres', value: [], type: 'CheckboxGroup',
    options: [
      { label: 'Action',           value: '3'  },
      { label: 'Adult',            value: '28' },
      { label: 'Adventure',        value: '4'  },
      { label: 'Anime',            value: '46' },
      { label: 'Arts',             value: '47' },
      { label: 'Comedy',           value: '5'  },
      { label: 'Drama',            value: '24' },
      { label: 'Eastern',          value: '44' },
      { label: 'Ecchi',            value: '26' },
      { label: 'Fan-fiction',      value: '48' },
      { label: 'Fantasy',          value: '6'  },
      { label: 'Game',             value: '19' },
      { label: 'Gender Bender',    value: '25' },
      { label: 'Harem',            value: '7'  },
      { label: 'Historical',       value: '12' },
      { label: 'Horror',           value: '37' },
      { label: 'Isekai',           value: '49' },
      { label: 'Josei',            value: '2'  },
      { label: 'Lgbt+',            value: '45' },
      { label: 'Magic',            value: '50' },
      { label: 'Magical Realism',  value: '51' },
      { label: 'Manhua',           value: '52' },
      { label: 'Martial Arts',     value: '15' },
      { label: 'Mature',           value: '8'  },
      { label: 'Mecha',            value: '34' },
      { label: 'Military',         value: '53' },
      { label: 'Modern Life',      value: '54' },
      { label: 'Movies',           value: '55' },
      { label: 'Mystery',          value: '16' },
      { label: 'Other',            value: '64' },
      { label: 'Psychological',    value: '9'  },
      { label: 'Realistic Fiction',value: '56' },
      { label: 'Reincarnation',    value: '43' },
      { label: 'Romance',          value: '1'  },
      { label: 'School Life',      value: '21' },
      { label: 'Sci-fi',           value: '20' },
      { label: 'Seinen',           value: '10' },
      { label: 'Shoujo',           value: '38' },
      { label: 'Shoujo Ai',        value: '57' },
      { label: 'Shounen',          value: '17' },
      { label: 'Shounen Ai',       value: '39' },
      { label: 'Slice of Life',    value: '13' },
      { label: 'Smut',             value: '29' },
      { label: 'Sports',           value: '42' },
      { label: 'Supernatural',     value: '18' },
      { label: 'System',           value: '58' },
      { label: 'Tragedy',          value: '32' },
      { label: 'Urban',            value: '63' },
      { label: 'Urban Life',       value: '59' },
      { label: 'Video Games',      value: '60' },
      { label: 'War',              value: '61' },
      { label: 'Wuxia',            value: '31' },
      { label: 'Xianxia',          value: '23' },
      { label: 'Xuanhuan',         value: '22' },
      { label: 'Yaoi',             value: '14' },
      { label: 'Yuri',             value: '62' },
    ],
  },
  language: {
    label: 'Language', value: [], type: 'CheckboxGroup',
    options: [
      { label: 'Chinese',  value: '1' },
      { label: 'Korean',   value: '2' },
      { label: 'Japanese', value: '3' },
      { label: 'English',  value: '4' },
    ],
  },
  rating_operator: {
    label: 'Rating (Min/Max)', value: 'min', type: 'Picker',
    options: [
      { label: 'Min', value: 'min' },
      { label: 'Max', value: 'max' },
    ],
  },
  rating: {
    label: 'Rating', value: '0', type: 'Picker',
    options: [
      { label: 'All', value: '0' },
      { label: '1',   value: '1' },
      { label: '2',   value: '2' },
      { label: '3',   value: '3' },
      { label: '4',   value: '4' },
      { label: '5',   value: '5' },
    ],
  },
  chapters: {
    label: 'Chapters', value: '0', type: 'Picker',
    options: [
      { label: 'All',      value: '0'           },
      { label: '<50',      value: '1,49'        },
      { label: '50-100',   value: '50,100'      },
      { label: '100-200',  value: '100,200'     },
      { label: '200-500',  value: '200,500'     },
      { label: '500-1000', value: '500,1000'    },
      { label: '>1000',    value: '1001,1000000'},
    ],
  },
};

export default NovelFire;

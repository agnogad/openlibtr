/**
 * Scribble Hub Downloader Library
 * Node.js ESM port of the ScribbleHub plugin
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

// ─── Date Helper ──────────────────────────────────────────────────────────────

function parseRelativeDate(dateStr) {
  if (!dateStr || !dateStr.includes('ago')) return null;

  const now = new Date();
  const match = dateStr.match(/(\d+)/);
  if (!match) return null;

  const value = parseInt(match[0], 10);

  if (dateStr.includes('hours ago') || dateStr.includes('hour ago')) {
    now.setHours(now.getHours() - value);
  } else if (dateStr.includes('days ago') || dateStr.includes('day ago')) {
    now.setDate(now.getDate() - value);
  } else if (dateStr.includes('months ago') || dateStr.includes('month ago')) {
    now.setMonth(now.getMonth() - value);
  } else {
    return null;
  }

  return now.toISOString();
}

// ─── Main Class ───────────────────────────────────────────────────────────────

class ScribbleHub {
  id      = 'scribblehub';
  name    = 'Scribble Hub';
  version = '1.0.2';
  site    = 'https://www.scribblehub.com/';

  // ─── Novel Listesi ────────────────────────────────────────────────────────

  parseNovels($) {
    const novels = [];

    $('.search_main_box').each((_, el) => {
      const novelName = $(el).find('.search_title > a').text();
      const novelCover = $(el).find('.search_img > img').attr('src');
      const novelUrl = $(el).find('.search_title > a').attr('href');

      if (!novelUrl) return;

      novels.push({
        name: novelName,
        cover: novelCover,
        path: novelUrl.replace(this.site, ''),
      });
    });

    return novels;
  }

  // ─── Popüler / Filtrelenmiş Novellar ──────────────────────────────────────

  /**
   * @param {number} page
   * @param {{ showLatestNovels?: boolean, filters?: object }} options
   * @returns {Promise<Array>}
   */
  async popularNovels(page = 1, { showLatestNovels = false, filters = {} } = {}) {
    let url = this.site;

    if (showLatestNovels) {
      url += `latest-series/?pg=${page}`;
    } else if (Object.keys(filters).length > 0) {
      const params = new URLSearchParams();

      if (filters?.genres?.value?.include?.length) {
        params.append('gi', filters.genres.value.include.join(','));
      }
      if (
        filters?.genres?.value?.include?.length ||
        filters?.genres?.value?.exclude?.length
      ) {
        params.append('mgi', filters.genre_operator?.value ?? 'and');
      }
      if (filters?.genres?.value?.exclude?.length) {
        params.append('ge', filters.genres.value.exclude.join(','));
      }
      if (filters?.content_warning?.value?.include?.length) {
        params.append('cti', filters.content_warning.value.include.join(','));
      }
      if (
        filters?.content_warning?.value?.include?.length ||
        filters?.content_warning?.value?.exclude?.length
      ) {
        params.append('mct', filters.content_warning_operator?.value ?? 'and');
      }
      if (filters?.content_warning?.value?.exclude?.length) {
        params.append('cte', filters.content_warning.value.exclude.join(','));
      }

      params.append('cp', filters.storyStatus?.value ?? 'all');
      params.append('sort', filters.sort?.value ?? 'ratings');
      params.append('order', filters.order?.value ?? 'desc');
      params.append('pg', page.toString());

      url += `series-finder/?sf=1&${params.toString()}`;
    } else {
      url += `series-finder/?sf=1&sort=ratings&order=desc&pg=${page}`;
    }

    const body = await fetchApi(url).then(r => r.text());
    return this.parseNovels(parseHTML(body));
  }

  // ─── Novel Detayları ──────────────────────────────────────────────────────

  /**
   * @param {string} novelPath  e.g. "series/12345/novel-title"
   * @returns {Promise<object>}
   */
  async parseNovel(novelPath) {
    const body = await fetchApi(this.site + novelPath).then(r => r.text());
    let $ = parseHTML(body);

    const novel = {
      path: novelPath,
      name: $('.fic_title').text().trim() || 'Untitled',
      cover: $('.fic_image > img').attr('src'),
      summary: $('.wi_fic_desc').text().trim(),
      author: $('.auth_name_fic').text().trim(),
      chapters: [],
    };

    novel.genres = $('.fic_genre')
      .map((i, el) => $(el).text().trim())
      .toArray()
      .join(',');

    novel.status = $('.rnd_stats').next().text().trim().includes('Ongoing')
      ? 'Ongoing'
      : 'Completed';

    // Fetch chapter list via WordPress AJAX
    const novelId = novelPath.split('/')[1];
    const formData = new URLSearchParams();
    formData.append('action', 'wi_getreleases_pagination');
    formData.append('pagenum', '-1');
    formData.append('mypostid', novelId);

    const chapBody = await fetchApi(`${this.site}wp-admin/admin-ajax.php`, {
      method: 'POST',
      body: formData.toString(),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    }).then(r => r.text());

    $ = parseHTML(chapBody);

    const chapters = [];

    $('.toc_w').each((_, el) => {
      const chapterName = $(el).find('.toc_a').text().trim();
      const releaseDate = $(el).find('.fic_date_pub').text().trim();
      const chapterUrl = $(el).find('a').attr('href');

      if (!chapterUrl) return;

      chapters.push({
        name: chapterName,
        releaseTime: parseRelativeDate(releaseDate),
        path: chapterUrl.replace(this.site, ''),
      });
    });

    novel.chapters = chapters.reverse();

    return novel;
  }

  // ─── Bölüm İçeriği ───────────────────────────────────────────────────────

  /**
   * @param {string} chapterPath  e.g. "series/12345/novel-title/chapter/12345"
   * @returns {Promise<string>} HTML string
   */
  async parseChapter(chapterPath) {
    const body = await fetchApi(this.site + chapterPath).then(r => r.text());
    const $ = parseHTML(body);

    return $('div.chp_raw').html() || '';
  }

  // ─── Arama ───────────────────────────────────────────────────────────────

  /**
   * @param {string} searchTerm
   * @param {number} page
   * @returns {Promise<Array>}
   */
  async searchNovels(searchTerm, page = 1) {
    const url = `${this.site}?s=${encodeURIComponent(searchTerm)}&post_type=fictionposts`;
    const body = await fetchApi(url).then(r => r.text());
    return this.parseNovels(parseHTML(body));
  }
}

// ─── Filter Definitions ───────────────────────────────────────────────────────

export const filters = {
  sort: {
    label: 'Sort Results By', value: 'ratings', type: 'Picker',
    options: [
      { label: 'Chapters',          value: 'chapters'       },
      { label: 'Chapters per Week', value: 'frequency'      },
      { label: 'Date Added',        value: 'dateadded'      },
      { label: 'Favorites',         value: 'favorites'      },
      { label: 'Last Updated',      value: 'lastchdate'     },
      { label: 'Number of Ratings', value: 'numofrate'      },
      { label: 'Pages',             value: 'pages'          },
      { label: 'Pageviews',         value: 'pageviews'      },
      { label: 'Ratings',           value: 'ratings'        },
      { label: 'Readers',           value: 'readers'        },
      { label: 'Reviews',           value: 'reviews'        },
      { label: 'Total Words',       value: 'totalwords'     },
    ],
  },
  order: {
    label: 'Order By', value: 'desc', type: 'Picker',
    options: [
      { label: 'Descending', value: 'desc' },
      { label: 'Ascending',  value: 'asc'  },
    ],
  },
  storyStatus: {
    label: 'Story Status', value: 'all', type: 'Picker',
    options: [
      { label: 'All',       value: 'all'       },
      { label: 'Completed', value: 'completed' },
      { label: 'Ongoing',   value: 'ongoing'   },
      { label: 'Hiatus',    value: 'hiatus'    },
    ],
  },
  genre_operator: {
    label: 'Genres (And/Or)', value: 'and', type: 'Picker',
    options: [
      { label: 'And', value: 'and' },
      { label: 'Or',  value: 'or'  },
    ],
  },
  genres: {
    label: 'Genres', value: { include: [], exclude: [] }, type: 'ExcludableCheckboxGroup',
    options: [
      { label: 'Action',       value: '9'    },
      { label: 'Adult',        value: '902'  },
      { label: 'Adventure',    value: '8'    },
      { label: 'Boys Love',    value: '891'  },
      { label: 'Comedy',       value: '7'    },
      { label: 'Drama',        value: '903'  },
      { label: 'Ecchi',        value: '904'  },
      { label: 'Fanfiction',   value: '38'   },
      { label: 'Fantasy',      value: '19'   },
      { label: 'Gender Bender',value: '905'  },
      { label: 'Girls Love',   value: '892'  },
      { label: 'Harem',        value: '1015' },
      { label: 'Historical',   value: '21'   },
      { label: 'Horror',       value: '22'   },
      { label: 'Isekai',       value: '37'   },
      { label: 'Josei',        value: '906'  },
      { label: 'LitRPG',       value: '1180' },
      { label: 'Martial Arts', value: '907'  },
      { label: 'Mature',       value: '20'   },
      { label: 'Mecha',        value: '908'  },
      { label: 'Mystery',      value: '909'  },
      { label: 'Psychological',value: '910'  },
      { label: 'Romance',      value: '6'    },
      { label: 'School Life',  value: '911'  },
      { label: 'Sci-fi',       value: '912'  },
      { label: 'Seinen',       value: '913'  },
      { label: 'Slice of Life',value: '914'  },
      { label: 'Smut',         value: '915'  },
      { label: 'Sports',       value: '916'  },
      { label: 'Supernatural', value: '5'    },
      { label: 'Tragedy',      value: '901'  },
    ],
  },
  content_warning_operator: {
    label: 'Mature Content (And/Or)', value: 'and', type: 'Picker',
    options: [
      { label: 'And', value: 'and' },
      { label: 'Or',  value: 'or'  },
    ],
  },
  content_warning: {
    label: 'Mature Content', value: { include: [], exclude: [] }, type: 'ExcludableCheckboxGroup',
    options: [
      { label: 'Gore',             value: '48' },
      { label: 'Sexual Content',   value: '50' },
      { label: 'Strong Language',  value: '49' },
    ],
  },
};

export default ScribbleHub;

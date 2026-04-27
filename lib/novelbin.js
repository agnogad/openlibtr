/**
 * NovelBin Downloader Library with Cookie Bridge
 */

import { load as parseHTML } from 'cheerio';
import { gotScraping } from 'got-scraping';
import CookieBridge from './cookie-bridge.js';

// ─── HTTP Helper ──────────────────────────────────────────────────────────────

async function fetchApi(url, options = {}) {
  const bridgeData = await CookieBridge.getSavedData();
  
  const headers = {
    'User-Agent': bridgeData?.ua || 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
    'Cookie': bridgeData?.cookies || '',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7',
    'Cache-Control': 'max-age=0',
    'Sec-Ch-Ua': '"Not_A Brand";v="8", "Chromium";v="120"',
    'Sec-Ch-Ua-Mobile': '?1',
    'Sec-Ch-Ua-Platform': '"Android"',
    'Upgrade-Insecure-Requests': '1',
    ...options.headers,
  };

  try {
    const response = await gotScraping({
      url,
      method: options.method || 'GET',
      body: options.body,
      headers,
      retry: { limit: 0 },
      throwHttpErrors: false,
      // Bazı durumlarda HTTP/2 sorun yaratabiliyor, kapatıp deneyebiliriz
      http2: false 
    });

    const body = response.body || '';

    // Cloudflare tespiti
    if (response.statusCode === 403 || body.includes('Just a moment...') || body.includes('cloudflare-static') || body.includes('challenge-platform')) {
      console.error(`\n⚠️  Hâlâ Cloudflare Engeli Var: ${url}`);
      
      if (bridgeData?.cookies) {
        console.log('🧐 Mevcut çerezler yetersiz kalıyor olabilir.');
        // Çerezlerde cf_clearance var mı kontrol et (loglamadan sadece varlığını kontrol edelim)
        if (!bridgeData.cookies.includes('cf_clearance')) {
          console.log('❌ HATA: Çerezler arasında "cf_clearance" bulunamadı! Bu çerez genellikle HttpOnly olduğu için otomatik butonla alınamaz.');
        }
      }

      console.log('🌐 [Bridge] Bridge sunucusu çerezlerinizi bekliyor...');
      await CookieBridge.waitForCookies(3000);
      
      return fetchApi(url, options);
    }

    return {
      ok:         response.statusCode >= 200 && response.statusCode < 300,
      status:     response.statusCode,
      statusText: response.statusMessage,
      url:        response.url,
      text:       async () => body,
      json:       async () => JSON.parse(body),
    };
  } catch (error) {
    throw new Error(`HTTP Fetch Error (${url}): ${error.message}`);
  }
}

// ─── Main Class ───────────────────────────────────────────────────────────────

class SiteTemplate {
  id      = 'novelbin';
  name    = 'NovelBin';
  version = '1.2.0';
  site    = 'https://novelbin.com/';

  constructor({ hideLocked = false } = {}) {
    this.hideLocked = hideLocked;
  }

  // ─── Novel Listesi ────────────────────────────────────────────────────────

  parseNovels($, isCategoryPage, isSearchPage) {
    const containerSelector = '.list-novel';

    return $(`${containerSelector} .row`)
      .map((_, ele) => {
        const name  = $(ele).find('.novel-title a').text().trim() || 'No Title Found';
        let cover   = $(ele).find('.novel-cover img').attr('data-src')
                   || $(ele).find('.novel-cover img').attr('src')
                   || '';
        const path  = $(ele).find('.novel-title a').attr('href') || '';

        if (cover.startsWith('//')) cover = 'https:' + cover;
        if (!path) return null;

        const relativePath = path.replace(this.site, '').replace(/^https?:\/\/novelbin\.com\//, '');
        return { name, cover, path: relativePath };
      })
      .get()
      .filter(Boolean);
  }

  async popularNovels(pageNo = 1, { showLatestNovels = false, filters = {} } = {}) {
    let url;
    if (showLatestNovels) {
      url = `${this.site.replace(/\/$/, '')}/sort/latest-release?page=${pageNo}`;
    } else {
      const sort   = filters.sort?.value   ?? 'popular';
      const status = filters.status?.value ?? '';
      const sortPath = {
        popular:    'sort/top-viewed',
        latest:     'sort/latest-release',
        rating:     'sort/top-rating',
        new:        'sort/new-novel',
      }[sort] ?? 'sort/top-viewed';

      url = `${this.site.replace(/\/$/, '')}/${sortPath}?page=${pageNo}`;
      if (status) url += `&status=${status}`;
    }

    const body = await fetchApi(url).then(r => r.text());
    return this.parseNovels(parseHTML(body), true, false);
  }

  _extractNovelId(novelPath) {
    return novelPath.replace(/^(\/)?b\//, '').replace(/\/$/, '');
  }

  async parseChapters(novelPath, overrideId = null) {
    const novelId = overrideId || this._extractNovelId(novelPath);
    const url  = `${this.site.replace(/\/$/, '')}/ajax/chapter-archive?novelId=${novelId}`;
    
    const IS_DEBUG = process.argv.includes('--debug') || process.env.DEBUG;
    if (IS_DEBUG) console.log(`[DEBUG] Fetching chapters from: ${url}`);

    const body = await fetchApi(url).then(r => r.text());
    const $    = parseHTML(body);
    const chapters = [];
    const seen = new Set();

    $('a').each((_, el) => {
      const href = $(el).attr('href') || '';
      if (!href.includes('/chapter-')) return;
      if (seen.has(href)) return;
      seen.add(href);

      const title = $(el).text().trim() || href.split('/').pop();
      const siteUrl = this.site.replace(/\/$/, '');
      const relativePath = href.startsWith('http') ? href.replace(siteUrl, '') : href;
      chapters.push({ name: title, path: relativePath });
    });

    if (chapters.length === 0 && IS_DEBUG) {
      console.log(`[DEBUG] No chapters found. Body length: ${body.length}`);
      console.log(body)
    }

    chapters.sort((a, b) => {
      const num = s => parseInt(s.path.match(/chapter-(\d+)/)?.[1] ?? 0);
      return num(a) - num(b);
    });

    return chapters;
  }

  async parseNovel(novelPath) {
    const url  = this.site.replace(/\/$/, '') + '/' + novelPath.replace(/^\//, '');
    const IS_DEBUG = process.argv.includes('--debug') || process.env.DEBUG;
    
    const body = await fetchApi(url).then(r => r.text());
    const $    = parseHTML(body);

    $('.desc-text').find('br').replaceWith('\n');

    let cover = $('.book img').attr('data-src') || $('.book img').attr('src') || '';
    if (cover.startsWith('//')) cover = 'https:' + cover;

    const genres = $('.categories ul li a').map((_, el) => $(el).text().trim()).get().join(', ');

    const numericId = $('#rating').attr('data-novel-id') || $('input#novelId').val() || $('input#id_novel').val();

    const novel = {
      path:    novelPath,
      name:    $('.title').first().text().trim()     || 'No Title Found',
      cover,
      genres,
      summary: $('.desc-text').text().trim()         || 'No Summary Found',
      author:  $('.author a').text().trim() || $('.info .author').text().trim() || 'No Author Found',
      status:  $('.info .status').text().trim() || 'Unknown',
      chapters: await this.parseChapters(novelPath, numericId),
    };

    return novel;
  }

  async parseChapter(chapterPath) {
    const url  = this.site.replace(/\/$/, '') + '/' + chapterPath.replace(/^\//, '');
    const body = await fetchApi(url).then(r => r.text());
    const $    = parseHTML(body);

    $('.ads-holder, .ad-container, #ads, .chapter-nav, script').remove();

    const title   = $('.chr-title').html() || $('.title').first().html() || '';
    const content = $('#chr-content').html() || $('.chr-c').html() || $('.chapter-content').html() || '';

    return title + content;
  }

  async searchNovels(searchTerm, pageNo = 1) {
    return this.searchNovelsInternal(searchTerm, pageNo);
  }

  async searchNovelsInternal(searchTerm, pageNo = 1, type = '') {
    const term = encodeURIComponent(searchTerm.replace(/\s+/g, '+'));
    const url  = `${this.site.replace(/\/$/, '')}/search?keyword=${term}&page=${pageNo}${type ? `&type=${type}` : ''}`;
    const body = await fetchApi(url).then(r => r.text());
    return this.parseNovels(parseHTML(body), false, true);
  }
}

export const filters = {
  sort: {
    label: 'Sort By', value: 'popular', type: 'Picker',
    options: [
      { label: 'Most Viewed', value: 'popular' },
      { label: 'Latest Release', value: 'latest' },
      { label: 'Top Rating',  value: 'rating'  },
      { label: 'New Novel',   value: 'new'      },
    ],
  },
  status: {
    label: 'Status', value: '', type: 'Picker',
    options: [
      { label: 'All',       value: ''  },
      { label: 'Ongoing',   value: 'ongoing'   },
      { label: 'Completed', value: 'completed' },
    ],
  },
};

export default SiteTemplate;

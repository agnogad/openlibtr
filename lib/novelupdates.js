/**
 * Novel Updates Downloader Library
 * Node.js ESM port of the NovelUpdates plugin (v0.9.8)
 * Usage: import NovelUpdates from './novelupdates/index.js'
 */

import { load as parseHTML } from 'cheerio';
import { gotScraping } from 'got-scraping';
import fetch from 'node-fetch';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const DEFAULT_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
};

async function fetchApi(url, options = {}) {
  try {
    const response = await gotScraping({
      url,
      method: options.method || 'GET',
      body: options.body,
      headers: { ...DEFAULT_HEADERS, ...options.headers },
      // gotScraping arka planda tarayıcı TLS parmak izini otomatik taklit eder
    });
    
    // Mevcut kodunun (response.text(), response.json() vb.) kırılmaması için
    // dönen objeyi fetch API'sine benzer bir yapıya büründürüyoruz:
    return {
      ok: response.statusCode >= 200 && response.statusCode < 300,
      status: response.statusCode,
      statusText: response.statusMessage,
      url: response.url,
      text: async () => response.body,
      json: async () => JSON.parse(response.body),
    };
  } catch (error) {
    throw new Error(`HTTP Fetch Hatası (${url}): ${error.message}`);
  }
}
function getLocation(href) {
  const match = href.match(
    /^(https?:)\/\/(([^:/?#]*)(?::([0-9]+))?)([/]{0,1}[^?#]*)(\?[^#]*|)(#.*|)$/,
  );
  return match ? `${match[1]}//${match[3]}` : null;
}

// ─── Main Class ───────────────────────────────────────────────────────────────

class NovelUpdates {
  id = 'novelupdates';
  name = 'Novel Updates';
  version = '0.9.8';
  site = 'https://www.novelupdates.com/';

  // ─── Parse novel list ──────────────────────────────────────────────────────

  parseNovels($) {
    const novels = [];
    $('div.search_main_box_nu').each((_, el) => {
      const novelUrl = $(el).find('.search_title > a').attr('href');
      if (!novelUrl) return;
      novels.push({
        name:  $(el).find('.search_title > a').text().trim(),
        cover: $(el).find('img').attr('src'),
        path:  novelUrl.replace(this.site, ''),
      });
    });
    return novels;
  }

  // ─── Popular / filtered novels ─────────────────────────────────────────────

  /**
   * @param {number} page
   * @param {{ showLatestNovels?: boolean, filters?: object }} options
   * @returns {Promise<Array>}
   */
  async popularNovels(page = 1, { showLatestNovels = false, filters = {} } = {}) {
    let url = this.site;

    if (showLatestNovels) {
      url += 'series-finder/?sf=1&sort=sdate&order=desc';
    } else if (
      filters?.sort?.value === 'popmonth' ||
      filters?.sort?.value === 'popular'
    ) {
      url += 'series-ranking/?rank=' + filters.sort.value;
    } else {
      url += 'series-finder/?sf=1';
      if (
        filters?.genres?.value?.include?.length ||
        filters?.genres?.value?.exclude?.length
      ) {
        url += '&mgi=' + (filters?.genre_operator?.value ?? 'and');
      }
      if (filters?.novelType?.value?.length) {
        url += '&nt=' + filters.novelType.value.join(',');
      }
      if (filters?.reading_lists?.value?.length) {
        url += '&hd=' + filters.reading_lists.value.join(',');
        url += '&mRLi=' + (filters?.reading_list_operator?.value ?? 'include');
      }
      url += '&sort=' + (filters?.sort?.value ?? 'srank');
      url += '&order=' + (filters?.order?.value ?? 'desc');
    }

    if (filters?.language?.value?.length)
      url += '&org=' + filters.language.value.join(',');
    if (filters?.genres?.value?.include?.length)
      url += '&gi=' + filters.genres.value.include.join(',');
    if (filters?.genres?.value?.exclude?.length)
      url += '&ge=' + filters.genres.value.exclude.join(',');
    if (filters?.storyStatus?.value)
      url += '&ss=' + filters.storyStatus.value;

    url += '&pg=' + page;

    const body = await fetchApi(url).then(r => r.text());
    return this.parseNovels(parseHTML(body));
  }

  // ─── Novel metadata + chapter list ────────────────────────────────────────

  /**
   * @param {string} novelPath  e.g. "series/my-novel/"
   * @returns {Promise<object>}
   */
  async parseNovel(novelPath) {
    const url = this.site + novelPath;
    const body = await fetchApi(url).then(r => r.text());
    const $ = parseHTML(body);

    const novel = {
      path:     novelPath,
      name:     $('.seriestitlenu').text().trim() || 'Untitled',
      cover:    $('.wpb_wrapper img').attr('src'),
      chapters: [],
    };

    novel.author = $('#authtag')
      .map((_, el) => $(el).text().trim())
      .toArray()
      .join(', ');

    novel.genres = $('#seriesgenre')
      .children('a')
      .map((_, el) => $(el).text())
      .toArray()
      .join(', ');

    novel.status = $('#editstatus').text().includes('Ongoing')
      ? 'Ongoing'
      : 'Completed';

    const type    = $('#showtype').text().trim();
    const summary = $('#editdescription').text().trim();
    novel.summary = summary + `\n\nType: ${type}`;

    const ratingMatch = $('.seriesother .uvotes').text().match(/(\d+\.\d+) \/ \d+\.\d+/);
    if (ratingMatch) novel.rating = parseFloat(ratingMatch[1]);

    // Fetch chapter list via AJAX
    const novelId = $('input#mypostid').attr('value');
    if (!novelId) return novel;

    const formData = new URLSearchParams();
    formData.append('action', 'nd_getchapters');
    formData.append('mygrr', '0');
    formData.append('mypostid', novelId);

    const chapHtml = await fetchApi(`${this.site}wp-admin/admin-ajax.php`, {
      method: 'POST',
      body:   formData.toString(),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    }).then(r => r.text());

    const $ch = parseHTML(chapHtml);
    const chapters = [];

    $ch('li.sp_li_chp').each((_, el) => {
      const name = $ch(el)
        .text()
        .replace('v', 'volume ')
        .replace('c', ' chapter ')
        .replace('part', 'part ')
        .replace('ss', 'SS')
        .replace(/\b\w/g, l => l.toUpperCase())
        .trim();

      const href = $ch(el).find('a').first().next().attr('href');
      if (!href) return;

      const chapterPath = ('https:' + href).replace(this.site, '');
      chapters.push({ name, path: chapterPath });
    });

    novel.chapters = chapters.reverse();
    return novel;
  }

  // ─── Chapter content ───────────────────────────────────────────────────────

  /**
   * Fetches and extracts chapter HTML from the external translator site.
   * @param {string} chapterPath  Full URL or path stored in chapter.path
   * @returns {Promise<string>} HTML string
   */
  async parseChapter(chapterPath) {
    // chapterPath may already be a full URL (stored without site prefix)
    const url = chapterPath.startsWith('http')
      ? chapterPath
      : this.site + chapterPath;

    const response = await fetchApi(url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}: ${url}`);
    }

    const body      = await response.text();
    const finalUrl  = response.url;
    const $ = parseHTML(body);

    // CAPTCHA / block detection
    const blockedTitles = [
      'bot verification', 'just a moment...', 'redirecting...',
      'un instant...', 'you are being redirected...',
    ];
    const pageTitle = $('title').text().trim().toLowerCase();
    if (blockedTitles.includes(pageTitle)) {
      throw new Error('Captcha detected. Open in browser.');
    }

    const domainParts = finalUrl.toLowerCase().split('/')[2].split('.');

    // Helper
    const matches = (selector, attr, regex) => {
      let found = false;
      $(selector).each((_, el) => {
        const val = attr ? $(el).attr(attr) : ($(el).html() || $(el).text());
        if (val && regex.test(val.toLowerCase())) { found = true; return false; }
      });
      return found;
    };

    let isWordPress = [
      matches('meta[name="generator"]', 'content', /wordpress|site kit/i),
      matches('link, script, img', 'src', /\/wp-content\/|\/wp-includes\//i),
      matches('link', 'href', /\/wp-content\/|\/wp-includes\//i),
      matches('link[rel="https://api.w.org/"]', 'href', /.*/),
      matches('link[rel="EditURI"]', 'href', /xmlrpc\.php/i),
      matches('body', 'class', /wp-admin|wp-custom-logo|logged-in/i),
      matches('script', null, /wp-embed|wp-emoji|wp-block/i),
    ].some(Boolean);

    let isBlogspot = [
      matches('meta[name="generator"]', 'content', /blogger/i),
      matches('meta[name="google-adsense-platform-domain"]', 'content', /blogspot/i),
      matches('link[rel="alternate"]', 'href', /blogger\.com\/feeds|blogspot\.com\/feeds/i),
      matches('link', 'href', /www\.blogger\.com\/static|www\.blogger\.com\/dyn-css/i),
      matches('script', null, /_WidgetManager\._Init|_WidgetManager\._RegisterWidget/i),
    ].some(Boolean);

    // Outlier overrides
    const outliers = [
      'asuratls','fictionread','hiraethtranslation','infinitenoveltranslations',
      'leafstudio','machineslicedbread','mirilu','novelworldtranslations',
      'sacredtexttranslations','stabbingwithasyringe','tinytranslation','vampiramtl',
    ];
    if (domainParts.some(d => outliers.includes(d))) {
      isWordPress = false;
      isBlogspot  = false;
    }

    let chapterText = '';

    if (!isWordPress && !isBlogspot) {
      chapterText = await this._getChapterBody($, domainParts, url, finalUrl, response);
    } else {
      const cfg = isWordPress ? PLATFORM_CONFIG.wordpress : PLATFORM_CONFIG.blogspot;

      cfg.bloat.forEach(sel => $(sel).remove());

      let chapterTitle = cfg.title
        .map(sel => $(sel).first().text().trim())
        .find(t => t.length > 0) || '';

      const chapterSubtitle =
        $('.cat-series').first().text() ||
        $('h1.leading-none ~ span').first().text() ||
        $('.breadcrumb .active').first().text();

      if (chapterSubtitle) chapterTitle = chapterSubtitle;

      const chapterContent = cfg.content
        .map(sel => {
          const el = $(sel).first();
          return el.text().trim().length > 50 ? el.html() : null;
        })
        .find(h => h) || '';

      chapterText = chapterTitle && chapterContent
        ? `<h2>${chapterTitle}</h2><hr><br>${chapterContent}`
        : chapterContent;
    }

    // Fallback
    if (!chapterText) {
      ['nav','header','footer','.hidden'].forEach(t => $(t).remove());
      chapterText = $('body').html() || '';
    }

    // Fix relative URLs
    const origin = getLocation(finalUrl);
    if (origin) {
      chapterText = chapterText.replace(/href="\//g, `href="${origin}/`);
    }

    // Fix lazy-loaded images
    const $c = parseHTML(chapterText);
    $c('noscript').remove();
    $c('img').each((_, el) => {
      const $el = $c(el);
      if ($el.attr('data-lazy-src')) $el.attr('src', $el.attr('data-lazy-src'));
      if ($el.attr('data-lazy-srcset')) $el.attr('srcset', $el.attr('data-lazy-srcset'));
      if ($el.hasClass('lazyloaded')) $el.removeClass('lazyloaded');
    });

    return $c.html() || '';
  }

  // ─── Per-domain chapter extractor ──────────────────────────────────────────

  async _getChapterBody($in, domain, chapterUrl, finalUrl, origResponse) {
    let $      = $in;
    let chapterTitle   = '';
    let chapterContent = '';
    let chapterText    = '';
    const unwanted     = ['app','blogspot','casper','wordpress','www'];
    const target       = domain.find(d => !unwanted.includes(d));

    switch (target) {
      case 'akutranslations': {
        const apiUrl = chapterUrl.replace('/novel', '/api/novel');
        const json   = await fetchApi(apiUrl).then(r => r.json());
        if (!json?.content) throw new Error('Invalid API response (akutranslations)');
        chapterContent = json.content.trim().split(/\n+/)
          .map(p => p.trim()).filter(p => p.length)
          .map(p => `<p>${p}</p>`).join('\n');
        break;
      }
      case 'asuratls': {
        const titleEl = $('.post-body div b').first();
        chapterTitle  = titleEl.text();
        titleEl.remove();
        chapterContent = $('.post-body').html() || '';
        break;
      }
      case 'brightnovels': {
        ['.ad-container','script','style'].forEach(t => $(t).remove());
        const dataPage = $('#app').attr('data-page');
        if (!dataPage) throw new Error('data-page not found (brightnovels)');
        const pageData = JSON.parse(dataPage);
        chapterTitle   = pageData.props.chapter.title;
        const $c       = parseHTML(pageData.props.chapter.content);
        $c('script, style').remove();
        chapterContent = $c.html() || '';
        break;
      }
      case 'canonstory': {
        const parts      = chapterUrl.split('/');
        const novelSlug  = parts[4];
        const chapSlug   = parts[6];
        const apiUrl     = `${parts[0]}//${parts[2]}/api/public/chapter-by-slug/${novelSlug}/${chapSlug}`;
        const json       = await fetchApi(apiUrl).then(r => r.json());
        if (!json?.data?.currentChapter) throw new Error('Invalid API response (canonstory)');
        const { chapterNumber, title, content } = json.data.currentChapter;
        chapterTitle   = title ? `Chapter ${chapterNumber} - ${title}` : `Chapter ${chapterNumber}`;
        chapterContent = content.replace(/\n/g, '<br>');
        break;
      }
      case 'daoist': {
        chapterTitle = $('.chapter__title').first().text();
        $('span.patreon-lock-icon').remove();
        $('img[data-src]').each((_, el) => {
          const $el = $(el);
          const src = $el.attr('data-src');
          if (src) { $el.attr('src', src); $el.removeAttr('data-src'); }
        });
        chapterContent = $('.chapter__content').html() || '';
        break;
      }
      case 'dreamy-translations': {
        chapterTitle = $('h1 > span').first().text();
        const content = $('.chapter-content > div').first();
        content.children('em').wrap('<p></p>');
        chapterContent = content.html() || '';
        break;
      }
      case 'fictionread': {
        ['.content > style','.highlight-ad-container','.meaning','.word']
          .forEach(t => $(t).remove());
        chapterTitle = $('.title-image span').first().text();
        $('.content').children().each((_, el) => {
          if ($(el).attr('id')?.includes('Chaptertitle-info')) { $(el).remove(); return false; }
        });
        chapterContent = $('.content').html() || '';
        break;
      }
      case 'genesistudio': {
        const apiUrl = `${chapterUrl}/__data.json?x-sveltekit-invalidated=001`;
        const json   = await fetchApi(apiUrl).then(r => r.json());
        const data   = json.nodes.filter(n => n.type === 'data').map(n => n.data)[0];
        for (const key in data) {
          const m = data[key];
          if (m && typeof m === 'object' && 'content' in m && 'notes' in m && 'footnotes' in m) {
            chapterText =
              data[m.content] +
              (data[m.notes]     ? `<h2>Notes</h2><br>${data[m.notes]}`     : '') +
              (data[m.footnotes] ? data[m.footnotes] : '');
            break;
          }
        }
        break;
      }
      case 'greenz': {
        const slug   = chapterUrl.split('/').pop();
        const json   = await fetchApi(`https://greenz.com/api/chapters/slug/${slug}`).then(r => r.json());
        chapterTitle   = `Chapter ${json.data.chapterNumber} - ${json.data.name}`;
        chapterContent = parseHTML(json.data.content).html() || '';
        break;
      }
      case 'hiraethtranslation': {
        chapterTitle   = $('li.active').first().text();
        chapterContent = $('.text-left').html() || '';
        break;
      }
      case 'hostednovel': {
        chapterTitle   = $('#chapter-title').first().text();
        chapterContent = $('#chapter-content').html() || '';
        break;
      }
      case 'infinitenoveltranslations': {
        const nextUrl = $('article > p > a').first().attr('href');
        if (nextUrl) {
          const body2 = await fetchApi(nextUrl).then(r => r.text());
          $ = parseHTML(body2);
        }
        chapterTitle   = $('.entry-title').text();
        chapterContent = $('.entry-content').html() || '';
        break;
      }
      case 'inoveltranslation': {
        ['header','section'].forEach(t => $(t).remove());
        chapterText = $('.styles_content__JHK8G').html() || '';
        break;
      }
      case 'isotls': {
        ['footer','header','nav'].forEach(t => $(t).remove());
        chapterTitle   = $('h1').first().text();
        chapterContent = $('.entry-content').html() || '';
        break;
      }
      case 'mirilu': {
        $('#jp-post-flair').remove();
        const titleEl = $('.entry-content p strong').first();
        chapterTitle  = titleEl.text();
        titleEl.remove();
        chapterContent = $('.entry-content').html() || '';
        break;
      }
      case 'novelplex': {
        $('.passingthrough_adreminder').remove();
        chapterTitle   = $('.halChap--jud').first().text();
        chapterContent = $('.halChap--kontenInner').html() || '';
        break;
      }
      case 'novelshub': {
        const segs      = chapterUrl.split('/');
        const novSlug   = segs[segs.length - 2];
        const chapSlug  = segs[segs.length - 1];
        const json      = await fetchApi(`https://api.novelshub.org/api/chapter?mangaslug=${novSlug}&chapterslug=${chapSlug}`).then(r => r.json());
        chapterTitle    = `Chapter ${json.chapter.number}`;
        chapterContent  = parseHTML(json.chapter.content).html() || '';
        break;
      }
      case 'novelworldtranslations': {
        $('.separator img').remove();
        $('.entry-content a').filter((_, el) =>
          $(el).attr('href')?.includes('https://novelworldtranslations.blogspot.com')
        ).each((_, el) => $(el).parent().remove());
        chapterTitle   = $('.entry-title').first().text();
        chapterContent = ($('.entry-content').html() || '').replace(/&nbsp;/g,'').replace(/\n/g,'<br>');
        const $c2 = parseHTML(chapterContent);
        $c2('span, p, div').each((_, el) => { if ($c2(el).text().trim() === '') $c2(el).remove(); });
        chapterContent = $c2.html() || '';
        break;
      }
      case 'patreon': {
        $('#track-click,[class*="hidden "]').remove();
        chapterTitle   = $('h1[data-tag="post-title"]').text();
        chapterContent = $('[data-tag="post-card"] [class*="PaddingTop"]').html() || '';
        break;
      }
      case 'r-p-d': {
        let parts = chapterUrl.split('/');
        const resolveRes  = await fetchApi(`${parts[0]}//${parts[2]}/resolve?p=/${parts.slice(3).join('/')}`);
        const { location } = await resolveRes.json();
        parts             = location.split('/');
        const base        = `${parts[0]}//${parts[2]}`;
        const meta        = await fetchApi(`${base}/api/chapter-meta?seriesSlug=${parts[4]}&chapterSlug=${parts[5]}`).then(r => r.json());
        const id          = meta.chapter.id;
        const { token }   = await fetchApi(`${base}/api/chapters/${id}/parts-token`).then(r => r.json());
        let total = 1;
        for (let i = 1; i <= total; i++) {
          const part = await fetchApi(`${base}/api/chapters/${id}/parts?index=${i}&token=${token}`).then(r => r.json());
          chapterText += '<p>' + part.markdown.replace(/\n\n/g, '</p><p>') + '</p>';
          total = part.total;
        }
        break;
      }
      case 'raeitranslations': {
        const parts = chapterUrl.split('/');
        const json  = await fetchApi(`${parts[0]}//api.${parts[2]}/api/chapters/single?id=${parts[3]}&num=${parts[4]}`).then(r => r.json());
        const tag   = `Chapter ${json.currentChapter.chapTag}`;
        chapterTitle   = json.currentChapter.chapTitle ? `${tag} - ${json.currentChapter.chapTitle}` : tag;
        chapterContent = [
          json.novelHead, '<br><hr><br>', json.currentChapter.body,
          '<br><hr><br>Translator\'s Note:<br>', json.currentChapter.note,
        ].join('').replace(/\n/g, '<br>');
        break;
      }
      case 'rainofsnow': {
        const displayed = $('.bb-item').filter(function () { return $(this).css('display') === 'block'; });
        const $snow     = parseHTML(displayed.html() || '');
        ['.responsivevoice-button','.zoomdesc-cont p img','.zoomdesc-cont p noscript']
          .forEach(t => $snow(t).remove());
        chapterContent  = $snow('.zoomdesc-cont').html() || '';
        const titleEl   = $snow('.scroller h2').first();
        if (titleEl.length) { chapterTitle = titleEl.text(); titleEl.remove(); chapterContent = $snow('.zoomdesc-cont').html() || ''; }
        break;
      }
      case 'readingpia': {
        ['.ezoic-ad','.ezoic-adpicker-ad','.ez-video-wrap'].forEach(t => $(t).remove());
        chapterText = $('.chapter-body').html() || '';
        break;
      }
      case 'redoxtranslation': {
        const chapId  = chapterUrl.split('/').pop();
        chapterTitle  = `Chapter ${chapId}`;
        const txtUrl  = `${chapterUrl.split('chapter')[0]}txt/${chapId}.txt`;
        const text    = await fetchApi(txtUrl).then(r => r.text());
        chapterContent = text.split('\n').map(s => {
          if (s.includes('{break}')) return '<br><p>****</p>';
          s = s.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
          s = s.replace(/\+\+(.*?)\+\+/g, '<em>$1</em>');
          return s;
        }).join('<br>');
        break;
      }
      case 'sacredtexttranslations': {
        ['.entry-content blockquote','.entry-content div','.reaction-buttons'].forEach(t => $(t).remove());
        chapterTitle   = $('.entry-title').first().text();
        chapterContent = $('.entry-content').html() || '';
        break;
      }
      case 'scribblehub': {
        $('.wi_authornotes').remove();
        chapterTitle   = $('.chapter-title').first().text();
        chapterContent = $('.chp_raw').html() || '';
        break;
      }
      case 'skydemonorder': {
        if ($('main').text().toLowerCase().includes('age verification required'))
          throw new Error('Age verification required.');
        chapterTitle   = $('header .font-medium.text-sm').first().text().trim();
        chapterContent = $('#chapter-body').html() || '';
        break;
      }
      case 'stabbingwithasyringe': {
        const nextUrl = $('.entry-content a').attr('href');
        if (nextUrl) { const b = await fetchApi(nextUrl).then(r => r.text()); $ = parseHTML(b); }
        ['.has-inline-color','.wp-block-buttons','.wpcnt','#jp-post-flair'].forEach(t => $(t).remove());
        chapterContent = $('.entry-content').html() || '';
        const titleEl  = $('.entry-content h3').first();
        if (titleEl.length) { chapterTitle = titleEl.text(); titleEl.remove(); chapterContent = $('.entry-content').html() || ''; }
        break;
      }
      case 'tinytranslation': {
        ['.content noscript','.google_translate_element','.navigate','.post-views','br'].forEach(t => $(t).remove());
        chapterTitle = $('.title-content').first().text();
        $('.title-content').first().remove();
        chapterContent = $('.content').html() || '';
        break;
      }
      case 'tumblr': {
        chapterText = $('.post').html() || '';
        break;
      }
      case 'vampiramtl': {
        const nextUrl = $('.entry-content a').attr('href');
        if (nextUrl) { const b = await fetchApi(chapterUrl + nextUrl).then(r => r.text()); $ = parseHTML(b); }
        chapterTitle   = $('.entry-title').first().text();
        chapterContent = $('.entry-content').html() || '';
        break;
      }
      case 'wattpad': {
        chapterTitle   = $('.h2').first().text();
        chapterContent = $('.part-content pre').html() || '';
        break;
      }
      case 'webnovel': {
        chapterTitle   = $('.cha-tit .pr .dib').first().text();
        chapterContent = $('.cha-words').html() || $('._content').html() || '';
        break;
      }
      case 'wetriedtls': {
        const sc = $('script:contains("p dir=")').html() || $('script:contains("u003c")').html();
        if (sc) {
          const jsonStr = sc.slice(sc.indexOf('.push(') + '.push('.length, sc.lastIndexOf(')'));
          chapterText   = JSON.parse(jsonStr)[1];
        }
        break;
      }
      case 'wuxiaworld': {
        $('.MuiLink-root').remove();
        chapterTitle   = $('h4 span').first().text();
        chapterContent = $('.chapter-content').html() || '';
        break;
      }
      case 'yoru': {
        const chapId  = chapterUrl.split('/').pop();
        const jsonUrl = await fetchApi(`https://pxp-main-531j.onrender.com/api/v1/book_chapters/${chapId}/content`).then(r => r.json());
        chapterText   = await fetchApi(jsonUrl).then(r => r.text());
        break;
      }
      default: {
        // Generic fallback for unknown domains
        chapterText = $('.chapter-content, .entry-content, #chapter-content, .text-left, article').first().html() || '';
        break;
      }
    }

    if (!chapterText) {
      chapterText = chapterTitle
        ? `<h2>${chapterTitle}</h2><hr><br>${chapterContent}`
        : chapterContent;
    }
    return chapterText;
  }

  // ─── Search ────────────────────────────────────────────────────────────────

  /**
   * @param {string} searchTerm
   * @param {number} page
   * @returns {Promise<Array>}
   */
  async searchNovels(searchTerm, page = 1) {
    const splits = searchTerm.split('*');
    const longest = splits.reduce((a, b) => (a.length > b.length ? a : b), '');
    const term = longest.replace(/['']/g, "'").replace(/\s+/g, '+');
    const url  = `${this.site}series-finder/?sf=1&sh=${term}&sort=srank&order=asc&pg=${page}`;
    const body = await fetchApi(url).then(r => r.text());
    return this.parseNovels(parseHTML(body));
  }
}

// ─── Platform configs (shared) ────────────────────────────────────────────────

const PLATFORM_CONFIG = {
  wordpress: {
    bloat: [
      '.ad','.author-avatar','.chapter-warning','.entry-meta','.ezoic-ad',
      '.mb-center','.modern-footnotes-footnote__note','.patreon-widget',
      '.post-cats','.pre-bar','.sharedaddy','.sidebar','.swg-button-v2-light',
      '.wp-block-buttons','.wp-dark-mode-switcher','.wp-next-post-navi',
      '#hpk','#jp-post-flair','#textbox',
    ],
    title: [
      '.entry-title','.chapter__title','.title-content','.wp-block-post-title',
      '.title_story','#chapter-heading','.chapter-title','head title',
      'h1:first-of-type','h2:first-of-type','.active',
    ],
    content: [
      '.chapter__content','.entry-content','.text_story','.post-content',
      '.contenta','.single_post','.main-content','.reader-content',
      '#content','#the-content','article.post','.chp_raw',
    ],
  },
  blogspot: {
    bloat: ['.button-container','.ChapterNav','.ch-bottom','.separator'],
    title: ['.entry-title','.post-title','head title'],
    content: ['.content-post','.entry-content','.post-body'],
  },
};

// ─── Filter definitions ───────────────────────────────────────────────────────

export const filters = {
  sort: {
    label: 'Sort Results By', value: 'popmonth', type: 'Picker',
    options: [
      { label: 'Popular (Month)', value: 'popmonth' },
      { label: 'Popular (All)',   value: 'popular'  },
      { label: 'Last Updated',   value: 'sdate'    },
      { label: 'Rating',         value: 'srate'    },
      { label: 'Rank',           value: 'srank'    },
      { label: 'Reviews',        value: 'sreview'  },
      { label: 'Chapters',       value: 'srel'     },
      { label: 'Title',          value: 'abc'      },
      { label: 'Readers',        value: 'sread'    },
      { label: 'Frequency',      value: 'sfrel'    },
    ],
  },
  order: {
    label: 'Order', value: 'desc', type: 'Picker',
    options: [{ label: 'Descending', value: 'desc' }, { label: 'Ascending', value: 'asc' }],
  },
  storyStatus: {
    label: 'Story Status', value: '', type: 'Picker',
    options: [
      { label: 'All',       value: ''  },
      { label: 'Completed', value: '2' },
      { label: 'Ongoing',   value: '3' },
      { label: 'Hiatus',    value: '4' },
    ],
  },
  genre_operator: {
    label: 'Genre Operator', value: 'and', type: 'Picker',
    options: [{ label: 'And', value: 'and' }, { label: 'Or', value: 'or' }],
  },
  genres: {
    label: 'Genres', type: 'ExcludableCheckboxGroup', value: { include: [], exclude: [] },
    options: [
      { label: 'Action',       value: '8'    }, { label: 'Adult',        value: '280'  },
      { label: 'Adventure',    value: '13'   }, { label: 'Comedy',       value: '17'   },
      { label: 'Drama',        value: '9'    }, { label: 'Ecchi',        value: '292'  },
      { label: 'Fantasy',      value: '5'    }, { label: 'Gender Bender',value: '168'  },
      { label: 'Harem',        value: '3'    }, { label: 'Historical',   value: '330'  },
      { label: 'Horror',       value: '343'  }, { label: 'Josei',        value: '324'  },
      { label: 'Martial Arts', value: '14'   }, { label: 'Mature',       value: '4'    },
      { label: 'Mecha',        value: '10'   }, { label: 'Mystery',      value: '245'  },
      { label: 'Romance',      value: '15'   }, { label: 'School Life',  value: '6'    },
      { label: 'Sci-fi',       value: '11'   }, { label: 'Seinen',       value: '18'   },
      { label: 'Shoujo',       value: '157'  }, { label: 'Shounen',      value: '12'   },
      { label: 'Slice of Life',value: '7'    }, { label: 'Smut',         value: '281'  },
      { label: 'Sports',       value: '1357' }, { label: 'Supernatural', value: '16'   },
      { label: 'Tragedy',      value: '132'  }, { label: 'Wuxia',        value: '479'  },
      { label: 'Xianxia',      value: '480'  }, { label: 'Xuanhuan',     value: '3954' },
      { label: 'Yaoi',         value: '560'  }, { label: 'Yuri',         value: '922'  },
    ],
  },
  language: {
    label: 'Language', value: [], type: 'CheckboxGroup',
    options: [
      { label: 'Chinese',    value: '495'   }, { label: 'Filipino',   value: '9181'  },
      { label: 'Indonesian', value: '9179'  }, { label: 'Japanese',   value: '496'   },
      { label: 'Khmer',      value: '18657' }, { label: 'Korean',     value: '497'   },
      { label: 'Malaysian',  value: '9183'  }, { label: 'Thai',       value: '9954'  },
      { label: 'Vietnamese', value: '9177'  },
    ],
  },
  novelType: {
    label: 'Novel Type', value: [], type: 'CheckboxGroup',
    options: [
      { label: 'Light Novel',    value: '2443'  },
      { label: 'Published Novel',value: '26874' },
      { label: 'Web Novel',      value: '2444'  },
    ],
  },
  reading_list_operator: {
    label: 'Reading List Operator', value: 'include', type: 'Picker',
    options: [{ label: 'Include', value: 'include' }, { label: 'Exclude', value: 'exclude' }],
  },
  reading_lists: {
    label: 'Reading Lists', value: [], type: 'CheckboxGroup',
    options: [{ label: 'All Reading Lists', value: '-1' }],
  },
};

export default NovelUpdates;

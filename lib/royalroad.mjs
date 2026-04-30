/**
 * Royal Road Novel Downloader Library
 * Node.js ESM port of the RoyalRoad plugin
 * Usage: import RoyalRoad from './index.js'
 */

import { Parser } from 'htmlparser2';
import fetch from 'node-fetch';

// ─── Enums ────────────────────────────────────────────────────────────────────

const NovelStatus = {
  Ongoing: 'Ongoing',
  OnHiatus: 'OnHiatus',
  Completed: 'Completed',
  Unknown: 'Unknown',
};

const ParsingState = {
  Idle: 0,
  InTitle: 1,
  InAuthor: 2,
  InDescription: 3,
  InTags: 4,
  InTagLink: 5,
  InStatusSpan: 6,
  InScript: 7,
  InNote: 8,
  InChapter: 9,
  InHidden: 10,
  Novel: 11,
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isUrlAbsolute(url) {
  return /^https?:\/\//i.test(url);
}

async function fetchApi(url, options = {}) {
  const headers = {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    ...options.headers,
  };
  return fetch(url, { ...options, headers });
}

// ─── Main Class ───────────────────────────────────────────────────────────────

class RoyalRoad {
  id = 'royalroad';
  name = 'Royal Road';
  version = '2.3.0';
  site = 'https://www.royalroad.com/';

  /** @param {boolean} enableVol - Enable volume/pagination grouping */
  constructor({ enableVol = false } = {}) {
    this.enableVol = enableVol;
  }

  // ─── Parse novel list from HTML ─────────────────────────────────────────────

  parseNovels(html) {
    const baseUrl = this.site;
    const novels = [];
    let tempNovel = {};
    let state = ParsingState.Idle;

    const parser = new Parser({
      onopentag(name, attribs) {
        if (attribs['class']?.includes('fiction-list-item')) {
          state = ParsingState.Novel;
        }
        if (state !== ParsingState.Novel) return;

        if (name === 'a' && attribs['href']) {
          tempNovel.path = attribs['href'].split('/').slice(1, 3).join('/');
        }
        if (name === 'img' && attribs['src']) {
          tempNovel.name = attribs['alt'] || '';
          tempNovel.cover = isUrlAbsolute(attribs['src'])
            ? attribs['src']
            : baseUrl + attribs['src'].slice(1);
        }
      },
      onclosetag(name) {
        if (name === 'figure') {
          if (tempNovel.path && tempNovel.name) {
            novels.push({ ...tempNovel });
            tempNovel = {};
          }
          state = ParsingState.Idle;
        }
      },
    });

    parser.write(html);
    parser.end();
    return novels;
  }

  // ─── Popular / search novels ─────────────────────────────────────────────────

  /**
   * Fetch popular novels with optional filters.
   * @param {number} page
   * @param {{ showLatestNovels?: boolean, filters?: object }} options
   * @returns {Promise<Array>}
   */
  async popularNovels(page = 1, { filters = {}, showLatestNovels = false } = {}) {
    const params = new URLSearchParams({ page: String(page) });

    if (showLatestNovels) params.append('orderBy', 'last_update');

    for (const key in filters) {
      const val = filters[key]?.value;
      if (val === '' || val == null) continue;

      if (['genres', 'tags', 'content_warnings'].includes(key)) {
        for (const inc of val.include ?? []) params.append('tagsAdd', inc);
        for (const exc of val.exclude ?? []) params.append('tagsRemove', exc);
      } else {
        params.append(key, String(val));
      }
    }

    const url = `${this.site}fictions/search?${params}`;
    const body = await fetchApi(url).then(r => r.text());
    return this.parseNovels(body);
  }

  /**
   * Search novels by title.
   * @param {string} searchTerm
   * @param {number} page
   * @returns {Promise<Array>}
   */
  async searchNovels(searchTerm, page = 1) {
    const params = new URLSearchParams({
      page: String(page),
      title: searchTerm,
      globalFilters: 'true',
    });
    const body = await fetchApi(`${this.site}fictions/search?${params}`).then(r => r.text());
    return this.parseNovels(body);
  }

  // ─── Parse novel metadata + chapter list ────────────────────────────────────

  /**
   * Fetch novel details and chapter list.
   * @param {string} novelPath  e.g. "fiction/12345/my-novel"
   * @returns {Promise<object>}
   */
  async parseNovel(novelPath) {
    const html = await fetchApi(this.site + novelPath).then(r => r.text());
    const novel = { path: novelPath };
    const baseUrl = this.site;
    const enableVolume = this.enableVol;

    let state = ParsingState.Idle;
    let statusText = '';
    let statusSpanCounter = 0;

    const nameParts = [];
    const summaryParts = [];
    const scriptContentParts = [];
    const genreArray = [];
    let chapterJson = [];
    let volumeJson = [];

    const parser = new Parser({
      onopentag(name, attribs) {
        switch (name) {
          case 'h1':
            state = ParsingState.InTitle;
            break;
          case 'a':
            if (attribs['href']?.startsWith('/profile/') && !novel.author) {
              state = ParsingState.InAuthor;
            } else if (state === ParsingState.InTags) {
              state = ParsingState.InTagLink;
            }
            break;
          case 'div':
            if (attribs['class'] === 'description') state = ParsingState.InDescription;
            break;
          case 'hr':
            if (state === ParsingState.InDescription) summaryParts.push('\n\n---\n\n');
            break;
          case 'br':
            if (state === ParsingState.InDescription) summaryParts.push('\n\n');
            break;
          case 'span':
            if (attribs['class']?.includes('tags')) {
              state = ParsingState.InTags;
            } else if (attribs['class']?.includes('label-sm')) {
              statusSpanCounter++;
              if (statusSpanCounter === 2) {
                state = ParsingState.InStatusSpan;
                statusText = '';
              }
            }
            break;
          case 'img':
            if (attribs['class']?.includes('thumbnail')) {
              novel.cover = attribs['src'];
              if (novel.cover && !isUrlAbsolute(novel.cover)) {
                novel.cover = baseUrl + novel.cover.slice(1);
              }
            }
            break;
          case 'script':
            state = ParsingState.InScript;
            break;
        }
      },
      ontext(text) {
        const t = text.trim();
        if (!t && state !== ParsingState.InScript) return;
        switch (state) {
          case ParsingState.InTitle:       nameParts.push(text); break;
          case ParsingState.InAuthor:      novel.author = t; break;
          case ParsingState.InDescription: summaryParts.push(text); break;
          case ParsingState.InStatusSpan:  statusText = t; break;
          case ParsingState.InTagLink:     genreArray.push(t); break;
          case ParsingState.InScript:      scriptContentParts.push(text); break;
        }
      },
      onclosetag(name) {
        switch (name) {
          case 'h1':
            if (state === ParsingState.InTitle) {
              novel.name = nameParts.join('').trim();
              state = ParsingState.Idle;
            }
            break;
          case 'a':
            if (state === ParsingState.InTagLink) state = ParsingState.InTags;
            else if (state === ParsingState.InAuthor) state = ParsingState.Idle;
            break;
          case 'p':
            if (state === ParsingState.InDescription) summaryParts.push('\n\n');
            break;
          case 'div':
            if (state === ParsingState.InDescription) {
              novel.summary = summaryParts.join('')
                .replace(/&nbsp;/g, ' ')
                .replace(/\n{3,}/g, '\n\n')
                .trim();
              summaryParts.length = 0;
              state = ParsingState.Idle;
            }
            break;
          case 'span':
            if (state === ParsingState.InTags) {
              novel.genres = genreArray.join(', ');
              state = ParsingState.Idle;
            } else if (state === ParsingState.InStatusSpan) {
              state = ParsingState.Idle;
            }
            break;
          case 'script':
            if (state === ParsingState.InScript) {
              state = ParsingState.Idle;
              const src = scriptContentParts.join('');
              const chM = src.match(/window\.chapters\s*=\s*(\[.*?\]);/);
              const volM = src.match(/window\.volumes\s*=\s*(\[.*?\]);/);
              if (chM?.[1]) chapterJson = JSON.parse(chM[1]);
              if (volM?.[1] && enableVolume) volumeJson = JSON.parse(volM[1]);
            }
            break;
        }
      },
      onend() {
        switch (statusText) {
          case 'ONGOING':    novel.status = NovelStatus.Ongoing;    break;
          case 'HIATUS':     novel.status = NovelStatus.OnHiatus;   break;
          case 'COMPLETED':  novel.status = NovelStatus.Completed;  break;
          default:           novel.status = NovelStatus.Unknown;
        }

        novel.chapters = chapterJson.map(ch => {
          const vol = volumeJson.find(v => v.id === ch.volumeId);
          const parts = ch.url.split('/');
          return {
            name:          ch.title,
            path:          `${parts[1]}/${parts[2]}/${parts[4]}/${parts[5]}`,
            releaseTime:   ch.date,
            chapterNumber: ch.order,
            page:          vol?.title,
          };
        });
      },
    });

    parser.write(html);
    parser.end();
    return novel;
  }

  // ─── Parse chapter content ───────────────────────────────────────────────────

  /**
   * Fetch and extract chapter HTML content.
   * @param {string} chapterPath  e.g. "fiction/12345/my-novel/chapter/67890/chapter-title"
   * @returns {Promise<string>} HTML string
   */
  async parseChapter(chapterPath) {
    const html = await fetchApi(this.site + chapterPath).then(r => r.text());

    let state = ParsingState.Idle;
    let stateDepth = 0;
    let depth = 0;

    const chapterHtmlParts = [];
    const notesHtmlParts = [];
    const beforeNotesParts = [];
    const afterNotesParts = [];
    let isBeforeChapter = true;

    const match = html.match(/<style>\n\s+\.(.+?){[^{]+?display: none;/);
    const hiddenClass = match?.[1]?.trim();
    let stateBeforeHidden = null;

    const escapeRegex = /[&<>"']/g;
    const escapeMap = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    const escapeHtml = text =>
      escapeRegex.test(text)
        ? ((escapeRegex.lastIndex = 0), text.replace(escapeRegex, c => escapeMap[c]))
        : text;

    // Void elements that don't need closing tags
    const voidElements = new Set([
      'area','base','br','col','embed','hr','img','input',
      'link','meta','param','source','track','wbr',
    ]);

    const parser = new Parser({
      onopentag(name, attribs) {
        depth++;
        const classes = attribs['class'] || '';

        if (state !== ParsingState.InHidden && hiddenClass && classes.includes(hiddenClass)) {
          stateBeforeHidden = { state, depth: stateDepth };
          state = ParsingState.InHidden;
          stateDepth = depth;
          return;
        }

        if (state === ParsingState.InHidden) return;

        if (state === ParsingState.Idle) {
          if (classes.includes('chapter-content')) {
            state = ParsingState.InChapter;
            stateDepth = depth;
            isBeforeChapter = false;
          } else if (classes.includes('author-note-portlet')) {
            state = ParsingState.InNote;
            stateDepth = depth;
          }
        }

        if (state === ParsingState.InChapter || state === ParsingState.InNote) {
          let tag = `<${name}`;
          for (const attr in attribs) {
            tag += ` ${attr}="${attribs[attr].replace(/"/g, '&quot;')}"`;
          }
          tag += '>';
          (state === ParsingState.InChapter ? chapterHtmlParts : notesHtmlParts).push(tag);
        }
      },

      ontext(text) {
        if (state === ParsingState.InChapter) chapterHtmlParts.push(escapeHtml(text));
        else if (state === ParsingState.InNote) notesHtmlParts.push(escapeHtml(text));
      },

      onclosetag(name) {
        if (depth === stateDepth) {
          if (state === ParsingState.InHidden) {
            if (!stateBeforeHidden) { state = ParsingState.Idle; stateDepth = 0; }
            else { state = stateBeforeHidden.state; stateDepth = stateBeforeHidden.depth; stateBeforeHidden = null; }
            depth--;
            return;
          }
          if (state === ParsingState.InChapter) {
            chapterHtmlParts.push('</div>');
            state = ParsingState.Idle; stateDepth = 0;
            depth--; return;
          }
          if (state === ParsingState.InNote) {
            const noteClass = `author-note-${isBeforeChapter ? 'before' : 'after'}`;
            const fullNote = `<div class="${noteClass}">${notesHtmlParts.join('').trim()}</div>`;
            (isBeforeChapter ? beforeNotesParts : afterNotesParts).push(fullNote);
            notesHtmlParts.length = 0;
            state = ParsingState.Idle; stateDepth = 0;
            depth--; return;
          }
        } else if (state === ParsingState.InChapter || state === ParsingState.InNote) {
          if (!voidElements.has(name)) {
            (state === ParsingState.InChapter ? chapterHtmlParts : notesHtmlParts).push(`</${name}>`);
          }
        }
        depth--;
      },
    });

    parser.write(html);
    parser.end();

    return [
      beforeNotesParts.length ? beforeNotesParts.join('') : null,
      chapterHtmlParts.length ? chapterHtmlParts.join('').trim() : null,
      afterNotesParts.length ? afterNotesParts.join('') : null,
    ]
      .filter(Boolean)
      .join('\n<hr class="notes-separator">\n');
  }
}

// ─── Filter definitions (exported for reference / UI building) ────────────────

export const filters = {
  keyword:          { label: 'Keyword (title or description)', type: 'TextInput', value: '' },
  author:           { label: 'Author',                          type: 'TextInput', value: '' },
  minPages:         { label: 'Min Pages',                       type: 'TextInput', value: '0' },
  maxPages:         { label: 'Max Pages',                       type: 'TextInput', value: '20000' },
  minRating:        { label: 'Min Rating (0.0 - 5.0)',          type: 'TextInput', value: '0.0' },
  maxRating:        { label: 'Max Rating (0.0 - 5.0)',          type: 'TextInput', value: '5.0' },
  status: {
    label: 'Status', type: 'Picker', value: 'ALL',
    options: ['ALL','COMPLETED','DROPPED','ONGOING','HIATUS','STUB'].map(v => ({ label: v, value: v })),
  },
  orderBy: {
    label: 'Order by', type: 'Picker', value: 'relevance',
    options: [
      { label: 'Relevance',       value: 'relevance' },
      { label: 'Popularity',      value: 'popularity' },
      { label: 'Average Rating',  value: 'rating' },
      { label: 'Last Update',     value: 'last_update' },
      { label: 'Release Date',    value: 'release_date' },
      { label: 'Followers',       value: 'followers' },
      { label: 'Pages',           value: 'length' },
      { label: 'Views',           value: 'views' },
      { label: 'Title',           value: 'title' },
      { label: 'Author',          value: 'author' },
    ],
  },
  dir: {
    label: 'Direction', type: 'Picker', value: 'desc',
    options: [{ label: 'Ascending', value: 'asc' }, { label: 'Descending', value: 'desc' }],
  },
  type: {
    label: 'Type', type: 'Picker', value: 'ALL',
    options: [{ label: 'All', value: 'ALL' }, { label: 'Fan Fiction', value: 'fanfiction' }, { label: 'Original', value: 'original' }],
  },
  genres: {
    label: 'Genres', type: 'ExcludableCheckboxGroup', value: { include: [], exclude: [] },
    options: ['action','adventure','comedy','contemporary','drama','fantasy','historical',
              'horror','mystery','psychological','romance','satire','sci_fi','one_shot','tragedy']
      .map(v => ({ label: v.replace(/_/g,' '), value: v })),
  },
  tags: {
    label: 'Tags', type: 'ExcludableCheckboxGroup', value: { include: [], exclude: [] },
    options: [
      { label: 'Anti-Hero Lead',       value: 'anti-hero_lead' },
      { label: 'Artificial Intelligence', value: 'artificial_intelligence' },
      { label: 'Attractive Lead',      value: 'attractive_lead' },
      { label: 'Cyberpunk',            value: 'cyberpunk' },
      { label: 'Dungeon',              value: 'dungeon' },
      { label: 'Dystopia',             value: 'dystopia' },
      { label: 'Female Lead',          value: 'female_lead' },
      { label: 'GameLit',              value: 'gamelit' },
      { label: 'Gender Bender',        value: 'gender_bender' },
      { label: 'Grimdark',             value: 'grimdark' },
      { label: 'Harem',                value: 'harem' },
      { label: 'High Fantasy',         value: 'high_fantasy' },
      { label: 'LitRPG',               value: 'litrpg' },
      { label: 'Magic',                value: 'magic' },
      { label: 'Male Lead',            value: 'male_lead' },
      { label: 'Martial Arts',         value: 'martial_arts' },
      { label: 'Non-Human Lead',       value: 'non-human_lead' },
      { label: 'Portal Fantasy / Isekai', value: 'summoned_hero' },
      { label: 'Post Apocalyptic',     value: 'post_apocalyptic' },
      { label: 'Progression',          value: 'progression' },
      { label: 'Reincarnation',        value: 'reincarnation' },
      { label: 'Slice of Life',        value: 'slice_of_life' },
      { label: 'Space Opera',          value: 'space_opera' },
      { label: 'Steampunk',            value: 'steampunk' },
      { label: 'Super Heroes',         value: 'super_heroes' },
      { label: 'Time Loop',            value: 'loop' },
      { label: 'Time Travel',          value: 'time_travel' },
      { label: 'Urban Fantasy',        value: 'urban_fantasy' },
      { label: 'Villainous Lead',      value: 'villainous_lead' },
      { label: 'Virtual Reality',      value: 'virtual_reality' },
      { label: 'War and Military',     value: 'war_and_military' },
      { label: 'Wuxia',                value: 'wuxia' },
      { label: 'Xianxia',              value: 'xianxia' },
    ],
  },
  content_warnings: {
    label: 'Content Warnings', type: 'ExcludableCheckboxGroup', value: { include: [], exclude: [] },
    options: [
      { label: 'Profanity',             value: 'profanity' },
      { label: 'Sexual Content',        value: 'sexuality' },
      { label: 'Graphic Violence',      value: 'graphic_violence' },
      { label: 'Sensitive Content',     value: 'sensitive' },
      { label: 'AI-Assisted Content',   value: 'ai_assisted' },
      { label: 'AI-Generated Content',  value: 'ai_generated' },
    ],
  },
};

export { NovelStatus };
export default RoyalRoad;


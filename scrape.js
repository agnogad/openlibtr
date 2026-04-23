'use strict';

const aisdk      = require('./aisdk.js');
const fs         = require('fs-extra');
const path       = require('path');
const { execSync, spawnSync } = require('child_process');
const cheerio    = require('cheerio');
const inquirer   = require('inquirer');

require('dotenv').config();

// ─────────────────────────────────────────────
//  CONSTANTS & CONFIG
// ─────────────────────────────────────────────
const BOOKS_DIR        = path.join(__dirname, 'books');
const USER_AGENT       = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const NOVELBIN_BASE    = 'https://novelbin.com';
const PUSH_EVERY_N     = 10;   // Auto-push to GitHub every N chapters

const client = new aisdk.PiAiClient({
  accounts: [aisdk.AccountPresets.geminiCli()],
});

// ─────────────────────────────────────────────
//  LOGGER  (structured, emoji-tagged output)
// ─────────────────────────────────────────────
const log = {
  info  : (...a) => console.log('ℹ️ ', ...a),
  ok    : (...a) => console.log('✅', ...a),
  warn  : (...a) => console.warn('⚠️ ', ...a),
  error : (...a) => console.error('❌', ...a),
  step  : (...a) => console.log('\n───', ...a, '───'),
  debug : (...a) => process.env.DEBUG && console.log('🐛', ...a),
};

// ─────────────────────────────────────────────
//  TERMUX NOTIFICATION
// ─────────────────────────────────────────────
function sendTermuxNotification(current, total, status = 'progress') {
  try {
    const id = 'novelbin_dl';

    if (status === 'success') {
      execSync(
        `termux-notification -i "${id}" -t "Çeviri Tamamlandı 🎉" -c "${total}/${total} bölüm kaydedildi." --icon "check_circle" --led-color "00FF00"`,
      );
      return;
    }

    const filled = Math.round((current / total) * 10);
    const bar    = `${'█'.repeat(filled)}${'░'.repeat(10 - filled)}`;

    execSync(
      `termux-notification -i "${id}" -t "Bölümler Çevriliyor" -c "[${bar}] ${current}/${total}" --icon "sync" --priority high`,
    );
  } catch {
    log.warn('Termux bildirimi gönderilemedi (Termux:API kurulu/aktif olmayabilir).');
  }
}

// ─────────────────────────────────────────────
//  GITHUB AUTO-PUSH
// ─────────────────────────────────────────────
/**
 * Checks whether the current working directory is a git repo with a remote.
 */
function isGitRepo() {
  const result = spawnSync('git', ['rev-parse', '--is-inside-work-tree'], { encoding: 'utf-8' });
  return result.status === 0;
}

/**
 * Stages, commits and pushes all changes inside `books/<novelName>/`.
 * Returns true on success, false on failure.
 *
 * @param {string} novelName
 * @param {number[]} chapters  - chapter numbers included in this push
 */
function gitPush(novelName, chapters) {
  if (!isGitRepo()) {
    log.warn('Bu dizin bir Git deposu değil. GitHub push atlandı.');
    return false;
  }

  try {
    const relPath = path.join('books', novelName);
    const range   = chapters.length === 1
      ? `Bölüm ${chapters[0]}`
      : `Bölüm ${chapters[0]}–${chapters[chapters.length - 1]}`;

    log.step(`GitHub push başlatılıyor (${range})`);

    // Stage only this novel's directory
    execSync(`git add "${relPath}"`, { stdio: 'inherit' });

    // Skip if nothing to commit
    const status = execSync('git status --porcelain', { encoding: 'utf-8' }).trim();
    if (!status) {
      log.info('Değişiklik yok, push atlandı.');
      return true;
    }

    const message = `[${novelName}] ${range} eklendi (${new Date().toISOString().slice(0, 10)})`;
    execSync(`git commit -m "${message}"`, { stdio: 'inherit' });
    execSync('git push',                   { stdio: 'inherit' });

    log.ok(`GitHub'a başarıyla push edildi: "${message}"`);
    return true;
  } catch (err) {
    log.error('Git push başarısız:', err.message);
    return false;
  }
}

// ─────────────────────────────────────────────
//  HTTP HELPER  (curl wrapper)
// ─────────────────────────────────────────────
function curlGet(url, extraHeaders = []) {
  const headers = [
    `-A "${USER_AGENT}"`,
    `-H "Referer: ${NOVELBIN_BASE}/"`,
    ...extraHeaders.map(h => `-H "${h}"`),
  ].join(' ');

  return execSync(`curl -s -L ${headers} "${url}"`, {
    encoding  : 'utf-8',
    maxBuffer : 10 * 1024 * 1024,
  });
}

// ─────────────────────────────────────────────
//  COVER DOWNLOADER
// ─────────────────────────────────────────────
async function downloadCoverIfMissing(novelName, novelPath) {
  const coverPath = path.join(novelPath, 'cover.jpg');
  if (await fs.pathExists(coverPath)) return;

  log.info('Kapak fotoğrafı bulunamadı, indiriliyor…');

  try {
    const html = curlGet(`${NOVELBIN_BASE}/b/${novelName}`);
    const $    = cheerio.load(html);

    let imageUrl = $('.book img').attr('src') || $('.book img').attr('data-src');
    if (!imageUrl) { log.warn('Sayfada kapak resmi bulunamadı.'); return; }

    if (imageUrl.startsWith('//')) imageUrl = 'https:' + imageUrl;

    execSync(
      `curl -s -L -A "${USER_AGENT}" -H "Referer: ${NOVELBIN_BASE}/" "${imageUrl}" -o "${coverPath}"`,
    );
    log.ok(`Kapak fotoğrafı kaydedildi: ${coverPath}`);
  } catch (err) {
    log.error('Kapak indirilemedi:', err.message);
  }
}

// ─────────────────────────────────────────────
//  CHAPTER LINK COLLECTOR
// ─────────────────────────────────────────────
async function getAllChapterLinks(novelName) {
  const url = `${NOVELBIN_BASE}/ajax/chapter-archive?novelId=${novelName}`;
  log.info('Bölüm listesi çekiliyor…');

  try {
    const html  = curlGet(url);
    const $     = cheerio.load(html);
    const links = new Set();

    $('a').each((_, el) => {
      const href = $(el).attr('href');
      if (href && href.includes('/chapter-')) links.add(href);
    });

    const sorted = Array.from(links).sort((a, b) => {
      const n = (s) => parseInt(s.match(/chapter-(\d+)/)?.[1] ?? 0);
      return n(a) - n(b);
    });

    return sorted;
  } catch (err) {
    log.error('Bölüm linkleri alınamadı:', err.message);
    return [];
  }
}

// ─────────────────────────────────────────────
//  CHAPTER PROCESSOR  (scrape + translate + save)
// ─────────────────────────────────────────────
async function processChapter(novelName, url, chapterNum) {
  const filePath = path.join(BOOKS_DIR, novelName, `ch${chapterNum}.md`);
  log.step(`Bölüm ${chapterNum}`);

  try {
    // 1. Scrape
    const html  = curlGet(url);
    const $     = cheerio.load(html);

    const title   = $('.chr-title').text().trim()
                  || $('.title').first().text().trim()
                  || `Chapter ${chapterNum}`;

    const content = $('#chr-content').text().trim()
                  || $('.chr-c').text().trim()
                  || $('.chapter-content').text().trim();

    if (!content || content.length < 100) {
      log.error(`Bölüm ${chapterNum}: İçerik çekilemedi veya çok kısa.`);
      return false;
    }

    // 2. Translate
    log.info(`Çeviriliyor: "${title}"`);

    const prompt = `\
Aşağıdaki İngilizce roman metnini Türkçe'ye çevir.

KURALLAR:
1. Akıcı, edebi ve profesyonel bir dil kullan.
2. Light novel olduğunu göze alarak ona uygun paragraflar kullan. Her paragraf arasında mutlaka bir satır boşluk bırak.
3. Sadece çeviri metnini döndür, başına veya sonuna açıklama ekleme.

İÇERİK:
${content}`;

    const response       = await client.complete(prompt);
    const translatedText = (response.content ?? '').trim();

    if (translatedText.length < 100) {
      log.error(`Bölüm ${chapterNum}: API'den gelen çeviri çok kısa/boş.`);
      return false;
    }

    // 3. Save
    await fs.writeFile(filePath, translatedText, 'utf-8');
    log.ok(`Kaydedildi → ch${chapterNum}.md`);

    // 4. Random delay (2.5–5.5 s) to be polite to the server
    await sleep(Math.random() * 3000 + 2500);

    return true;
  } catch (err) {
    log.error(`Bölüm ${chapterNum} işlenemedi:`, err.message);
    return false;
  }
}

// ─────────────────────────────────────────────
//  UTILITY
// ─────────────────────────────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ─────────────────────────────────────────────
//  MAIN
// ─────────────────────────────────────────────
async function main() {
  console.log('╔══════════════════════════════════════════╗');
  console.log('║  NovelBin Pro Scraper & Gemini Translator ║');
  console.log('╚══════════════════════════════════════════╝\n');

  await fs.ensureDir(BOOKS_DIR);

  // --- Novel selection ---
  const folders = (await fs.readdir(BOOKS_DIR, { withFileTypes: true }))
    .filter((d) => d.isDirectory())
    .map((d) => d.name);

  if (folders.length === 0) {
    log.error("'books/' klasörü boş. Önce bir roman klasörü oluşturun.");
    process.exit(1);
  }

  const { selectedNovel } = await inquirer.prompt([{
    type    : 'list',
    name    : 'selectedNovel',
    message : 'Kitap seçin:',
    choices : folders,
  }]);

  const novelPath = path.join(BOOKS_DIR, selectedNovel);
  const files     = await fs.readdir(novelPath);

  // --- Cover ---
  await downloadCoverIfMissing(selectedNovel, novelPath);

  // --- Chapter list ---
  const allChapterLinks = await getAllChapterLinks(selectedNovel);
  if (allChapterLinks.length === 0) {
    log.error('Hiç bölüm bulunamadı!');
    process.exit(1);
  }
  log.ok(`Toplam ${allChapterLinks.length} bölüm bulundu.`);

  // --- Detect existing chapters ---
  const existingChapters = new Set(
    files
      .map((f) => f.match(/ch(\d+)\.md/)?.[1])
      .filter(Boolean)
      .map(Number),
  );

  // --- Ask how many to translate ---
  const { count } = await inquirer.prompt([{
    type    : 'number',
    name    : 'count',
    message : 'Kaç adet eksik/yeni bölüm çevrilsin?',
    default : 1,
    validate: (v) => (v > 0 ? true : 'Lütfen pozitif bir sayı girin.'),
  }]);

  // --- Build target list (missing chapters only, in order) ---
  const targetChapters = [];
  for (let i = 1; i <= allChapterLinks.length && targetChapters.length < count; i++) {
    if (!existingChapters.has(i)) targetChapters.push(i);
  }

  if (targetChapters.length === 0) {
    log.ok('Serideki tüm bölümler cihazınızda eksiksiz bulunuyor! 🎉');
    process.exit(0);
  }

  log.info(`Çevrilecek bölümler: ${targetChapters.join(', ')}`);
  sendTermuxNotification(0, targetChapters.length);

  // ── MAIN LOOP ──────────────────────────────
  let successCount = 0;
  const pendingPushChapters = [];   // chapters waiting for the next push

  for (let i = 0; i < targetChapters.length; i++) {
    const chapterNum = targetChapters[i];
    const link       = allChapterLinks[chapterNum - 1];

    if (!link) {
      log.warn(`Bölüm ${chapterNum} listede yok. Roman sonu olabilir.`);
      break;
    }

    const success = await processChapter(selectedNovel, link, chapterNum);

    if (success) {
      successCount++;
      pendingPushChapters.push(chapterNum);
    }

    sendTermuxNotification(i + 1, targetChapters.length);

    // ── AUTO PUSH every PUSH_EVERY_N successful chapters ──
    if (pendingPushChapters.length >= PUSH_EVERY_N) {
      gitPush(selectedNovel, [...pendingPushChapters]);
      pendingPushChapters.length = 0;   // clear buffer
    }
  }

  // ── FINAL PUSH for any remaining chapters ──
  if (pendingPushChapters.length > 0) {
    gitPush(selectedNovel, [...pendingPushChapters]);
  }

  sendTermuxNotification(successCount, targetChapters.length, 'success');

  console.log(`\n╔══════════════════════════════════════════╗`);
  console.log(`║  ✅ Tamamlandı: ${String(successCount).padEnd(3)} / ${String(targetChapters.length).padEnd(3)} bölüm çevrildi.        ║`);
  console.log(`╚══════════════════════════════════════════╝`);
}

main().catch((err) => {
  log.error('Kritik hata:', err.message);
  process.exit(1);
});

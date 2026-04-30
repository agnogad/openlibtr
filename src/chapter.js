/**
 * src/chapter.js
 * Bölüm çekme, HTML temizleme ve kaydetme işlemleri.
 */

const fs      = require('fs-extra');
const path    = require('path');
const { translate } = require('./translator');

/** HTML → düz metin dönüşümü (paragraf yapısını korur) */
function htmlToText(html) {
    return html
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/p>/gi, '\n\n')
        .replace(/<\/h[1-6]>/gi, '\n\n')
        .replace(/<hr\s*\/?>/gi, '\n---\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

/** Throttle: 2.5 – 5.5 sn */
function randomDelay() {
    const ms = Math.floor(Math.random() * 3000) + 2500;
    return new Promise(res => setTimeout(res, ms));
}

/**
 * Tek bir bölümü işler: çeker → temizler → çevirir → kaydeder.
 *
 * @param {object} plugin       - Kaynak plugin örneği
 * @param {string} novelDir     - Kitabın kaydedileceği klasör
 * @param {object} chapter      - { name, path }
 * @param {number} chapterNum
 * @param {boolean} isDebug     - Debug modu aktif mi?
 * @returns {Promise<boolean>}  - Başarı durumu
 */
async function processChapter(plugin, novelDir, chapter, chapterNum, isDebug = false) {
    const { default: chalk } = await import('chalk');
    const { default: ora }   = await import('ora');
    const filePath = path.join(novelDir, `ch${chapterNum}.md`);
    const spinner = ora(`[Bölüm ${chapterNum}] Hazırlanıyor...`).start();

    try {
        // 1. Scrape
        spinner.text = `[Bölüm ${chapterNum}] Kaynak metin çekiliyor...`;
        const html = await plugin.parseChapter(chapter.path);

        if (isDebug) {
            const debugFile = path.join(novelDir, `debug_ch${chapterNum}.html`);
            await fs.writeFile(debugFile, html, 'utf-8');
        }

        const content = htmlToText(html);

        if (!content || content.length < 100) {
            spinner.fail(chalk.red(`[Bölüm ${chapterNum}] İçerik alınamadı.`));
            if (!isDebug) {
                const debugFile = path.join(novelDir, `error_ch${chapterNum}.html`);
                await fs.writeFile(debugFile, html || "NULL/EMPTY", 'utf-8');
            }
            return false;
        }

        // 2. Translate
        spinner.text = `[Bölüm ${chapterNum}] AI Çeviri yapılıyor...`;
        spinner.color = 'yellow';
        
        const translated = await translate(content, chapterNum);
        
        if (!translated || translated.length < 100) {
            spinner.fail(chalk.red(`[Bölüm ${chapterNum}] Çeviri başarısız.`));
            return false;
        }

        // 3. Save
        await fs.writeFile(filePath, translated.trim(), 'utf-8');
        spinner.succeed(chalk.green(`[Bölüm ${chapterNum}] Tamamlandı: ${chapter.name.slice(0, 30)}${chapter.name.length > 30 ? '...' : ''}`));

        await randomDelay();
        return true;

    } catch (err) {
        spinner.fail(chalk.red(`[Bölüm ${chapterNum}] Hata: ${err.message}`));
        return false;
    }
}

module.exports = { processChapter };

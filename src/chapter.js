/**
 * src/chapter.js
 * Bölüm çekme, HTML temizleme ve kaydetme işlemleri.
 */

const fs   = require('fs-extra');
const path = require('path');
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
 */
async function processChapter(plugin, novelDir, chapter, chapterNum, isDebug = false) {
    const filePath = path.join(novelDir, `ch${chapterNum}.md`);
    console.log(`\n--- [Bölüm ${chapterNum}: ${chapter.name}] ---`);

    try {
        const html    = await plugin.parseChapter(chapter.path);

        if (isDebug) {
            const debugFile = path.join(novelDir, `debug_ch${chapterNum}.html`);
            await fs.writeFile(debugFile, html, 'utf-8');
            console.log(`🔍 [DEBUG] Ham HTML kaydedildi: ${debugFile}`);
        }

        const content = htmlToText(html);

        if (!content || content.length < 100) {
            console.log("❌ İçerik çekilemedi veya çok kısa.");
            if (!isDebug) {
                const debugFile = path.join(novelDir, `error_ch${chapterNum}.html`);
                await fs.writeFile(debugFile, html || "NULL/EMPTY", 'utf-8');
                console.log(`🔍 Hata analizi için ham HTML kaydedildi: ${debugFile}`);
            }
            return;
        }

        const translated = await translate(content, chapterNum);
        await fs.writeFile(filePath, translated.trim(), 'utf-8');
        console.log(`💾 Kaydedildi: ch${chapterNum}.md`);

        await randomDelay();

    } catch (err) {
        console.error(`❌ Bölüm ${chapterNum} hatası:`, err.message);
        // Hata durumunda da eğer mümkünse bir şeyler kaydetmek isteyebiliriz,
        // ancak parseChapter hata verdiyse 'html' değişkeni elimizde olmayabilir.
    }
}

module.exports = { processChapter };

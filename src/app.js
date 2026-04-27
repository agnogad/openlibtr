/**
 * src/app.js
 * Ana uygulama akışı – sadece orkestrasyon, iş mantığı yok.
 */

const fs       = require('fs-extra');
const path     = require('path');
const inquirer = require('inquirer');

const { loadExtensions }                             = require('../extensions/loader');
const { sendTermuxNotification }                     = require('./notifier');
const { searchAndSelect, fetchAndSaveMeta,
        getMissingChapters }                         = require('./novel');
const { processChapter }                             = require('./chapter');

const BOOKS_DIR = path.join(__dirname, '..', 'books');
const IS_DEBUG  = process.argv.includes('--debug') || process.env.DEBUG;

async function start() {
    console.log("🚀 Novel Scraper & AI Translator");
    if (IS_DEBUG) console.log("🧪 Debug modu aktif.");

    await fs.ensureDir(BOOKS_DIR);

    // ── 1. Extension'ları otomatik yükle ─────────────────────────────────────
    const extensions = await loadExtensions();
    console.log(`✅ ${extensions.length} extension yüklendi: ${extensions.map(e => e.id).join(', ')}`);

    // ── 2. Kaynak seç ─────────────────────────────────────────────────────────
    const { sourceId } = await inquirer.prompt([{
        type:    'list',
        name:    'sourceId',
        message: 'Kaynak seçin:',
        choices: extensions.map(e => ({ name: e.label, value: e.id })),
    }]);

    const extension = extensions.find(e => e.id === sourceId);
    const plugin    = await extension.getInstance();

    // ── 3. Var olan kitap mı, yeni arama mı? ─────────────────────────────────
    const folders = (await fs.readdir(BOOKS_DIR, { withFileTypes: true }))
        .filter(d => d.isDirectory())
        .map(d => d.name);

    let selectedNovelPath;
    let selectedNovelSlug;

    if (folders.length > 0) {
        const { action } = await inquirer.prompt([{
            type:    'list',
            name:    'action',
            message: 'Ne yapmak istersiniz?',
            choices: [
                { name: '📂 Var olan kitabı devam ettir', value: 'existing' },
                { name: '🔍 Yeni novel ara',               value: 'search'   },
            ],
        }]);

        if (action === 'existing') {
            const { chosen } = await inquirer.prompt([{
                type:    'list',
                name:    'chosen',
                message: 'Kitap seçin:',
                choices: folders,
            }]);

            const metaPath = path.join(BOOKS_DIR, chosen, 'meta.json');
            if (!await fs.pathExists(metaPath)) {
                console.log("❌ meta.json bulunamadı, lütfen novel'i yeniden aratın.");
                return;
            }

            const meta = await fs.readJson(metaPath);
            if (meta.source && meta.source !== sourceId) {
                console.warn(`⚠️  Bu kitap "${meta.source}" kaynağından. Seçilen kaynak: "${sourceId}".`);
            }

            selectedNovelPath = meta.path;
            selectedNovelSlug = chosen;
        } else {
            ({ selectedNovelPath, selectedNovelSlug } = await searchAndSelect(plugin, sourceId));
        }
    } else {
        console.log("📂 'books/' klasörü boş, novel aranıyor...");
        ({ selectedNovelPath, selectedNovelSlug } = await searchAndSelect(plugin, sourceId));
    }

    if (!selectedNovelPath) return;

    // ── 4. Novel metadata ─────────────────────────────────────────────────────
    const novelDir = path.join(BOOKS_DIR, selectedNovelSlug);
    await fs.ensureDir(novelDir);

    const novel = await fetchAndSaveMeta(plugin, novelDir, selectedNovelPath, sourceId);

    const allChapters = novel.chapters || [];
    if (allChapters.length === 0) {
        console.log("❌ Hiç bölüm bulunamadı!");
        if (!IS_DEBUG) console.log("💡 Sorunu anlamak için komutu '--debug' bayrağıyla çalıştırabilirsiniz.");
        return;
    }
    console.log(`✅ Toplam ${allChapters.length} bölüm bulundu.`);

    // ── 5. Kaç bölüm çevrilsin? ───────────────────────────────────────────────
    const { count } = await inquirer.prompt([{
        type:    'number',
        name:    'count',
        message: 'Kaç adet eksik/yeni bölüm çevrilsin?',
        default: 1,
    }]);

    const existingFiles    = await fs.readdir(novelDir);
    const targetChapterNums = getMissingChapters(existingFiles, allChapters.length, count);

    if (targetChapterNums.length === 0) {
        console.log("🎉 Tüm bölümler zaten mevcut!");
        return;
    }

    console.log(`ℹ️  Çevrilecek bölümler: ${targetChapterNums.join(', ')}`);
    sendTermuxNotification(0, targetChapterNums.length, "progress");

    // ── 6. Bölümleri işle ────────────────────────────────────────────────────
    for (let i = 0; i < targetChapterNums.length; i++) {
        const chNum   = targetChapterNums[i];
        const chapter = allChapters[chNum - 1];

        if (!chapter) {
            console.log(`⚠️ Bölüm ${chNum} listede yok.`);
            break;
        }

        await processChapter(plugin, novelDir, chapter, chNum, IS_DEBUG);
        sendTermuxNotification(i + 1, targetChapterNums.length, "progress");
    }

    sendTermuxNotification(targetChapterNums.length, targetChapterNums.length, "success");
    console.log("🎉 Tüm çeviri işlemleri tamamlandı!");
}

module.exports = { start };

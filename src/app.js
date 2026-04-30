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
    const { default: chalk } = await import('chalk');
    const { default: ora }   = await import('ora');

    console.clear();
    console.log(chalk.cyan.bold("\n╔════════════════════════════════════════════╗"));
    console.log(chalk.cyan.bold("║      📖 Novel Scraper & AI Translator      ║"));
    console.log(chalk.cyan.bold("╚════════════════════════════════════════════╝\n"));

    if (IS_DEBUG) console.log(chalk.yellow("🧪 Debug modu aktif.\n"));

    await fs.ensureDir(BOOKS_DIR);

    // ── 1. Extension'ları otomatik yükle ─────────────────────────────────────
    const loaderSpinner = ora('Eklentiler yükleniyor...').start();
    const extensions = await loadExtensions();
    loaderSpinner.succeed(chalk.green(`${extensions.length} eklenti hazır: ${extensions.map(e => e.id).join(', ')}`));

    // ── 2. Kaynak seç ─────────────────────────────────────────────────────────
    const { sourceId } = await inquirer.prompt([{
        type:    'list',
        name:    'sourceId',
        message: 'Lütfen bir kaynak seçin:',
        choices: extensions.map(e => ({ name: e.label, value: e.id })),
    }]);

    const extension = extensions.find(e => e.id === sourceId);
    const plugin    = await extension.getInstance();

    // ── 3. Var olan kitap mı, yeni arama mı? ─────────────────────────────────
    const scanSpinner = ora('Yerel kütüphane taranıyor...').start();
    const allFolders = (await fs.readdir(BOOKS_DIR, { withFileTypes: true }))
        .filter(d => d.isDirectory())
        .map(d => d.name);

    const providerFolders = [];
    for (const folder of allFolders) {
        const folderPath = path.join(BOOKS_DIR, folder);
        const metaPath = path.join(folderPath, 'meta.json');
        if (await fs.pathExists(metaPath)) {
            try {
                const meta = await fs.readJson(metaPath);
                if (meta.source === sourceId) {
                    const files = await fs.readdir(folderPath);
                    const chapterCount = files.filter(f => f.match(/^ch\d+\.md$/)).length;
                    
                    providerFolders.push({
                        name: `${chalk.white(meta.name || folder)} ${chalk.gray(`(${chapterCount} bölüm yerelde)`)}`,
                        short: meta.name || folder,
                        value: folder
                    });
                }
            } catch (e) {
                if (IS_DEBUG) console.error(`Error reading meta for ${folder}:`, e.message);
            }
        }
    }
    scanSpinner.stop();

    let selectedNovelPath;
    let selectedNovelSlug;

    if (providerFolders.length > 0) {
        const { action } = await inquirer.prompt([{
            type:    'list',
            name:    'action',
            message: 'Ne yapmak istersiniz?',
            choices: [
                { name: chalk.blue(`📂 Mevcut ${providerFolders.length} kitaptan birine devam et`), value: 'existing' },
                { name: chalk.green('🔍 Yeni bir novel ara'),                             value: 'search'   },
            ],
        }]);

        if (action === 'existing') {
            const { chosen } = await inquirer.prompt([{
                type:    'list',
                name:    'chosen',
                message: 'Kitap seçin:',
                choices: providerFolders,
            }]);

            const metaPath = path.join(BOOKS_DIR, chosen, 'meta.json');
            const meta = await fs.readJson(metaPath);

            selectedNovelPath = meta.path;
            selectedNovelSlug = chosen;
        } else {
            ({ selectedNovelPath, selectedNovelSlug } = await searchAndSelect(plugin, sourceId));
        }
    } else {
        console.log(chalk.italic.gray(`\nℹ️  '${sourceId}' için yerel kayıt bulunamadı, aramaya yönlendiriliyorsunuz...`));
        ({ selectedNovelPath, selectedNovelSlug } = await searchAndSelect(plugin, sourceId));
    }

    if (!selectedNovelPath) return;

    // ── 4. Novel metadata ─────────────────────────────────────────────────────
    const novelDir = path.join(BOOKS_DIR, selectedNovelSlug);
    await fs.ensureDir(novelDir);

    const metaSpinner = ora('Novel bilgileri güncelleniyor...').start();
    const novel = await fetchAndSaveMeta(plugin, novelDir, selectedNovelPath, sourceId);
    metaSpinner.succeed(chalk.bold(novel.name) + chalk.green(' bilgileri alındı.'));

    const allChapters = novel.chapters || [];
    if (allChapters.length === 0) {
        console.log(chalk.red("\n❌ Hiç bölüm bulunamadı!"));
        return;
    }
    console.log(chalk.gray(`ℹ️  Toplam ${allChapters.length} bölüm mevcut.`));

    // ── 5. Kaç bölüm çevrilsin? ───────────────────────────────────────────────
    const existingFiles = await fs.readdir(novelDir);
    const existingCount = existingFiles.filter(f => f.match(/^ch\d+\.md$/)).length;
    
    console.log(chalk.yellow(`\n📈 Durum: ${existingCount} / ${allChapters.length} bölüm tamamlandı.`));

    const { count } = await inquirer.prompt([{
        type:    'number',
        name:    'count',
        message: 'Kaç adet yeni bölüm çevrilsin?',
        default: 5,
    }]);

    const targetChapterNums = getMissingChapters(existingFiles, allChapters.length, count);

    if (targetChapterNums.length === 0) {
        console.log(chalk.green("\n🎉 Harika! Tüm bölümler zaten güncel."));
        return;
    }

    console.log(chalk.blue(`\n🚀 İşlem başlatılıyor: ${targetChapterNums.length} bölüm sıraya alındı.`));
    console.log(chalk.gray(`Sıradaki bölümler: ${targetChapterNums.join(', ')}`));
    
    sendTermuxNotification(0, targetChapterNums.length, "progress");

    // ── 6. Bölümleri işle ────────────────────────────────────────────────────
    let successCount = 0;
    for (let i = 0; i < targetChapterNums.length; i++) {
        const chNum   = targetChapterNums[i];
        const chapter = allChapters[chNum - 1];

        if (!chapter) break;

        const result = await processChapter(plugin, novelDir, chapter, chNum, IS_DEBUG);
        if (result) successCount++;
        
        sendTermuxNotification(i + 1, targetChapterNums.length, "progress");
    }

    // ── 7. Kapanış ve Sync ───────────────────────────────────────────────────
    sendTermuxNotification(successCount, targetChapterNums.length, "success");
    
    console.log(chalk.green.bold(`\n✅ İşlem tamamlandı! ${successCount} yeni bölüm eklendi.`));
    
    const syncSpinner = ora('Kütüphane senkronize ediliyor...').start();
    try {
        const { execSync } = require('child_process');
        execSync('node sync-library.js');
        syncSpinner.succeed(chalk.green('Kütüphane (library.json) güncellendi.'));
    } catch (e) {
        syncSpinner.fail(chalk.red('Kütüphane senkronize edilemedi.'));
    }

    console.log(chalk.cyan.bold("\n👋 İyi okumalar!\n"));
}

module.exports = { start };

/**
 * src/novel.js
 * Novel arama, seçme ve metadata yönetimi.
 */

const fs       = require('fs-extra');
const path     = require('path');
const inquirer = require('inquirer');
const { execSync } = require('child_process');

/**
 * Novel arar ve kullanıcıya seçtirir.
 * @returns {Promise<{selectedNovelPath: string, selectedNovelSlug: string}>}
 */
async function searchAndSelect(plugin, sourceId) {
    const { default: chalk } = await import('chalk');
    const { default: ora }   = await import('ora');
    const sourceLabel = plugin.id || sourceId;

    const { searchTerm } = await inquirer.prompt([{
        type:    'input',
        name:    'searchTerm',
        message: `${chalk.blue(sourceLabel)} üzerinde ara:`,
    }]);

    const spinner = ora('Aranıyor...').start();
    const results = await plugin.searchNovels(searchTerm, 1);

    if (results.length === 0) {
        spinner.fail(chalk.red('Sonuç bulunamadı.'));
        return {};
    }
    spinner.succeed(chalk.green(`${results.length} sonuç bulundu.`));

    const { chosen } = await inquirer.prompt([{
        type:    'list',
        name:    'chosen',
        message: 'Devam etmek istediğiniz novelı seçin:',
        choices: results.map(n => ({ name: n.name, value: n })),
    }]);

    const slug = chosen.path
        .replace(/\/$/, '')
        .split('/')
        .filter(Boolean)
        .pop()
        .replace(/[^a-zA-Z0-9-_]/g, '-')
        .toLowerCase();

    return { selectedNovelPath: chosen.path, selectedNovelSlug: slug };
}

/**
 * Novel metadata'sını diske yazar ve kapak resmini indirir.
 * @returns {Promise<object>} novel nesnesi (chapters dahil)
 */
async function fetchAndSaveMeta(plugin, novelDir, selectedNovelPath, sourceId) {
    const { default: chalk } = await import('chalk');
    const { default: ora }   = await import('ora');
    const novel = await plugin.parseNovel(selectedNovelPath);

    const IS_DEBUG = process.argv.includes('--debug') || process.env.DEBUG;
    if (IS_DEBUG && (!novel.chapters || novel.chapters.length === 0)) {
        console.log(chalk.gray(`[DEBUG] No chapters found for ${novel.name}`));
    }

    await fs.writeJson(path.join(novelDir, 'meta.json'), {
        source:  sourceId,
        path:    novel.path,
        name:    novel.name,
        author:  novel.author,
        status:  novel.status,
        genres:  novel.genres,
        summary: novel.summary,
        cover:   novel.cover || '',
    }, { spaces: 2 });

    // Kapak resmi
    await downloadCover(plugin, novel.cover, novelDir);

    return novel;
}

/**
 * Hangi bölümlerin eksik olduğunu hesaplar.
 * @param {string[]} existingFiles - novelDir içindeki dosya adları
 * @param {number}   totalChapters
 * @param {number}   requestedCount
 * @returns {number[]}
 */
function getMissingChapters(existingFiles, totalChapters, requestedCount) {
    const existing = new Set();
    existingFiles.forEach(f => {
        const m = f.match(/ch(\d+)\.md/);
        if (m) existing.add(parseInt(m[1]));
    });

    const missing = [];
    for (let i = 1; i <= totalChapters; i++) {
        if (!existing.has(i)) missing.push(i);
        if (missing.length >= requestedCount) break;
    }
    return missing;
}

/**
 * Kapak resmini indirir (eğer yoksa).
 * @param {object} plugin
 * @param {string} coverUrl
 * @param {string} novelDir
 */
async function downloadCover(plugin, coverUrl, novelDir) {
    const { default: chalk } = await import('chalk');
    const { default: ora }   = await import('ora');
    const IS_DEBUG = process.argv.includes('--debug') || process.env.DEBUG;
    const coverPath = path.join(novelDir, 'cover.jpg');

    if (await fs.pathExists(coverPath) || !coverUrl) return;

    const spinner = ora('Kapak resmi indiriliyor...').start();
    try {
        if (typeof plugin.downloadImage === 'function') {
            const buffer = await plugin.downloadImage(coverUrl);
            await fs.writeFile(coverPath, buffer);
        } else {
            execSync(`curl -s -L "${coverUrl}" -o "${coverPath}"`);
        }
        spinner.succeed(chalk.green('Kapak resmi kaydedildi.'));
    } catch (err) {
        if (IS_DEBUG) console.error(chalk.red(`[DEBUG] Image download error: ${err.message}`));
        spinner.warn(chalk.yellow('Kapak resmi indirilemedi.'));
    }
}

/**
 * Seçili providere ait kapaksız novelleri tarar ve cover'larını indirir.
 * @param {object} plugin
 * @param {Array<{value: string}>} providerFolders
 * @param {string} booksDir
 * @returns {Promise<number>} indirilen kapak sayısı
 */
async function fixMissingCovers(plugin, providerFolders, booksDir) {
    const { default: chalk } = await import('chalk');
    const { default: ora }   = await import('ora');
    const IS_DEBUG = process.argv.includes('--debug') || process.env.DEBUG;

    const spinner = ora('Eksik kapak resimleri taranıyor...').start();
    let fixed = 0;

    for (const folder of providerFolders) {
        const novelDir = path.join(booksDir, folder.value);
        const coverPath = path.join(novelDir, 'cover.jpg');
        const metaPath  = path.join(novelDir, 'meta.json');

        if (await fs.pathExists(coverPath)) continue;

        try {
            const meta = await fs.readJson(metaPath);

            // Her zaman parseNovel'u çağır - yeni doğru cover URL'ini almak için
            const novel = await plugin.parseNovel(meta.path);
            
            // meta.json'ı güncelle ve cover'ı indir
            await fs.writeJson(metaPath, {
                ...meta,
                cover: novel.cover,
            }, { spaces: 2 });
            
            if (novel.cover) {
                await downloadCover(plugin, novel.cover, novelDir);
                fixed++;
            }
        } catch (e) {
            if (IS_DEBUG) console.error(`Cover error for ${folder.value}:`, e.message);
        }
    }

    if (fixed > 0) {
        spinner.succeed(chalk.green(`${fixed} kapak resmi indirildi.`));
    } else {
        spinner.stop();
        console.log(chalk.gray('ℹ️  Tüm kapak resimleri mevcut.'));
    }

    return fixed;
}

module.exports = { searchAndSelect, fetchAndSaveMeta, getMissingChapters, fixMissingCovers };


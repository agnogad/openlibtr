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
    const sourceLabel = plugin.id || sourceId;

    const { searchTerm } = await inquirer.prompt([{
        type:    'input',
        name:    'searchTerm',
        message: `${sourceLabel}'da novel ara:`,
    }]);

    console.log("🔍 Aranıyor...");
    const results = await plugin.searchNovels(searchTerm, 1);

    if (results.length === 0) {
        console.log("❌ Sonuç bulunamadı.");
        return {};
    }

    const { chosen } = await inquirer.prompt([{
        type:    'list',
        name:    'chosen',
        message: 'Novel seçin:',
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
    console.log("🔍 Novel bilgileri alınıyor...");
    const novel = await plugin.parseNovel(selectedNovelPath);

    const IS_DEBUG = process.argv.includes('--debug') || process.env.DEBUG;
    if (IS_DEBUG && (!novel.chapters || novel.chapters.length === 0)) {
        console.log("[DEBUG] Novel object contains no chapters:", JSON.stringify(novel, null, 2));
    }

    await fs.writeJson(path.join(novelDir, 'meta.json'), {
        source:  sourceId,
        path:    novel.path,
        name:    novel.name,
        author:  novel.author,
        status:  novel.status,
        genres:  novel.genres,
        summary: novel.summary,
    }, { spaces: 2 });

    // Kapak resmi
    const coverPath = path.join(novelDir, 'cover.jpg');
    if (!await fs.pathExists(coverPath) && novel.cover) {
        console.log("📸 Kapak indiriliyor...");
        try {
            execSync(`curl -s -L "${novel.cover}" -o "${coverPath}"`);
            console.log("✅ Kapak kaydedildi.");
        } catch {
            console.log("⚠️ Kapak indirilemedi.");
        }
    }

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

module.exports = { searchAndSelect, fetchAndSaveMeta, getMissingChapters };


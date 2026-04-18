const aisdk = require("./aisdk.js");
const fs    = require('fs-extra');
const path  = require('path');
const { execSync } = require('child_process');
const inquirer     = require('inquirer');

require('dotenv').config();

// ─── ESM kütüphanelerini CJS içine yükle ──────────────────────────────────────

let _rrInstance, _nuInstance;

async function getRoyalRoad() {
    if (!_rrInstance) {
        const mod = await import('./royalroad.js');
        _rrInstance = new mod.default({ enableVol: false });
    }
    return _rrInstance;
}

async function getNovelUpdates() {
    if (!_nuInstance) {
        const mod = await import('./novelupdates.js');
        _nuInstance = new mod.default();
    }
    return _nuInstance;
}

// ─── AYARLAR ──────────────────────────────────────────────────────────────────

const BOOKS_DIR = path.join(__dirname, 'books');

const client = new aisdk.PiAiClient({
    accounts: [aisdk.AccountPresets.geminiCli()],
});

// ─── TERMUX BİLDİRİM ─────────────────────────────────────────────────────────

function sendTermuxNotification(current, total, status) {
    try {
        const id = "indirme_durumu";
        if (status === "success") {
            execSync(`termux-notification -i "${id}" -t "İşlem Başarılı" -c "Tüm dosyalar (${total}/${total}) cihazına kaydedildi." --icon "check_circle" --led-color "00FF00"`);
            return;
        }
        const bar   = '#'.repeat(Math.round((current / total) * 10));
        const empty = '.'.repeat(10 - bar.length);
        execSync(`termux-notification -i "${id}" -t "Bölümler Çevriliyor" -c "[${bar}${empty}] ${current}/${total} tamamlandı" --icon "sync" --priority high`);
    } catch {
        console.error("⚠️ Termux bildirimi gönderilemedi.");
    }
}

// ─── ANA AKIŞ ─────────────────────────────────────────────────────────────────

async function start() {
    try {
        console.log("🚀 Novel Scraper & AI Translator");

        if (!await fs.pathExists(BOOKS_DIR)) await fs.ensureDir(BOOKS_DIR);

        // ── Kaynak seç ────────────────────────────────────────────────────────
        const { source } = await inquirer.prompt([{
            type: 'list',
            name: 'source',
            message: 'Kaynak seçin:',
            choices: [
                { name: '👑 Royal Road  (İngilizce orijinal web novellar)', value: 'royalroad'    },
                { name: '📚 Novel Updates (Çeviri novellar – Japonca/Kore/Çince)', value: 'novelupdates' },
            ],
        }]);

        const plugin = source === 'royalroad'
            ? await getRoyalRoad()
            : await getNovelUpdates();

        // ── Var olan kitapları veya yeni arama ────────────────────────────────
        const folders = (await fs.readdir(BOOKS_DIR, { withFileTypes: true }))
            .filter(d => d.isDirectory())
            .map(d => d.name);

        let selectedNovelPath;   // plugin'in kullandığı path
        let selectedNovelSlug;   // klasör adı

        if (folders.length > 0) {
            const { action } = await inquirer.prompt([{
                type: 'list',
                name: 'action',
                message: 'Ne yapmak istersiniz?',
                choices: [
                    { name: '📂 Var olan kitabı devam ettir', value: 'existing' },
                    { name: '🔍 Yeni novel ara',               value: 'search'   },
                ],
            }]);

            if (action === 'existing') {
                const { chosen } = await inquirer.prompt([{
                    type: 'list',
                    name: 'chosen',
                    message: 'Kitap seçin:',
                    choices: folders,
                }]);
                const metaPath = path.join(BOOKS_DIR, chosen, 'meta.json');
                if (!await fs.pathExists(metaPath)) {
                    console.log("❌ meta.json bulunamadı, lütfen novel'i yeniden aratın.");
                    return;
                }
                const meta = await fs.readJson(metaPath);
                if (meta.source && meta.source !== source) {
                    console.log(`⚠️ Bu kitap "${meta.source}" kaynağından. Seçilen kaynak: "${source}".`);
                }
                selectedNovelPath = meta.path;
                selectedNovelSlug = chosen;
            } else {
                ({ selectedNovelPath, selectedNovelSlug } = await searchAndSelect(plugin, source));
            }
        } else {
            console.log("📂 'books/' klasörü boş, novel aranıyor...");
            ({ selectedNovelPath, selectedNovelSlug } = await searchAndSelect(plugin, source));
        }

        if (!selectedNovelPath) return;

        const novelDir = path.join(BOOKS_DIR, selectedNovelSlug);
        await fs.ensureDir(novelDir);

        // ── Novel metadata + bölüm listesi ───────────────────────────────────
        console.log("🔍 Novel bilgileri alınıyor...");
        const novel = await plugin.parseNovel(selectedNovelPath);

        await fs.writeJson(path.join(novelDir, 'meta.json'), {
            source,
            path:    novel.path,
            name:    novel.name,
            author:  novel.author,
            status:  novel.status,
            genres:  novel.genres,
            summary: novel.summary,
        }, { spaces: 2 });

        // ── Kapak resmi ───────────────────────────────────────────────────────
        const coverPath = path.join(novelDir, 'cover.jpg');
        if (!await fs.pathExists(coverPath) && novel.cover) {
            console.log(`📸 Kapak indiriliyor...`);
            try {
                execSync(`curl -s -L "${novel.cover}" -o "${coverPath}"`);
                console.log("✅ Kapak kaydedildi.");
            } catch {
                console.log("⚠️ Kapak indirilemedi.");
            }
        }

        const allChapters = novel.chapters || [];
        if (allChapters.length === 0) {
            console.log("❌ Hiç bölüm bulunamadı!");
            return;
        }
        console.log(`✅ Toplam ${allChapters.length} bölüm bulundu.`);

        // ── Eksik bölümleri tespit et ─────────────────────────────────────────
        const files = await fs.readdir(novelDir);
        const existingChapters = new Set();
        files.forEach(f => {
            const m = f.match(/ch(\d+)\.md/);
            if (m) existingChapters.add(parseInt(m[1]));
        });

        const { count } = await inquirer.prompt([{
            type: 'number',
            name: 'count',
            message: 'Kaç adet eksik/yeni bölüm çevrilsin?',
            default: 1,
        }]);

        const targetChapters = [];
        for (let i = 1; i <= allChapters.length; i++) {
            if (!existingChapters.has(i)) targetChapters.push(i);
            if (targetChapters.length >= count) break;
        }

        if (targetChapters.length === 0) {
            console.log("🎉 Tüm bölümler zaten mevcut!");
            return;
        }

        console.log(`ℹ️ Çevrilecek bölümler: ${targetChapters.join(', ')}`);
        sendTermuxNotification(0, targetChapters.length, "progress");

        for (let i = 0; i < targetChapters.length; i++) {
            const chNum   = targetChapters[i];
            const chapter = allChapters[chNum - 1];
            if (!chapter) { console.log(`⚠️ Bölüm ${chNum} listede yok.`); break; }

            await processChapter(plugin, novelDir, chapter, chNum);
            sendTermuxNotification(i + 1, targetChapters.length, "progress");
        }

        sendTermuxNotification(targetChapters.length, targetChapters.length, "success");
        console.log("🎉 Tüm çeviri işlemleri tamamlandı!");

    } catch (err) {
        console.error("💥 Kritik Hata:", err.message);
    }
}

// ─── Novel arama + seçim ──────────────────────────────────────────────────────

async function searchAndSelect(plugin, source) {
    const { searchTerm } = await inquirer.prompt([{
        type: 'input',
        name: 'searchTerm',
        message: `${source === 'royalroad' ? 'Royal Road' : 'Novel Updates'}'da novel ara:`,
    }]);

    console.log("🔍 Aranıyor...");
    const results = await plugin.searchNovels(searchTerm, 1);

    if (results.length === 0) {
        console.log("❌ Sonuç bulunamadı.");
        return {};
    }

    const { chosen } = await inquirer.prompt([{
        type: 'list',
        name: 'chosen',
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

// ─── Bölüm işleme ────────────────────────────────────────────────────────────

async function processChapter(plugin, novelDir, chapter, chapterNum) {
    const filePath = path.join(novelDir, `ch${chapterNum}.md`);
    console.log(`\n--- [Bölüm ${chapterNum}: ${chapter.name}] ---`);

    try {
        const html = await plugin.parseChapter(chapter.path);

        // HTML → düz metin (paragraf yapısını koru)
        const content = html
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

        if (!content || content.length < 100) {
            console.log("❌ İçerik çekilemedi veya çok kısa.");
            return;
        }

        console.log(`🤖 AI çevirisi başlıyor (Bölüm ${chapterNum})...`);

        const prompt = `Aşağıdaki İngilizce roman metnini Türkçe'ye çevir.

KURALLAR:
1. Akıcı, edebi ve profesyonel bir dil kullan.
2. Light novel olduğunu göze alarak ona uygun paragraflar kullan. Her paragraf arasında mutlaka bir satır boşluk bırak.
3. Sadece çeviri metnini döndür, başına veya sonuna açıklama ekleme.

İÇERİK:
${content}`;

        const response = await client.complete(prompt);
        const translatedText = response.content;

        if (!translatedText || translatedText.length < 100) {
            console.error(`❌ Bölüm ${chapterNum}: API çevirisi çok kısa/boş!`);
            return;
        }

        const markdown = `# ${chapter.name}\n\n${translatedText.trim()}`;
        await fs.writeFile(filePath, markdown, 'utf-8');
        console.log(`💾 Kaydedildi: ch${chapterNum}.md`);

        // Throttle: 2.5 – 5.5 sn
        const delay = Math.floor(Math.random() * 3000) + 2500;
        await new Promise(res => setTimeout(res, delay));

    } catch (err) {
        console.error(`❌ Bölüm ${chapterNum} hatası:`, err.message);
    }
}

start();

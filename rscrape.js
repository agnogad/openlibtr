const aisdk = require("./aisdk.js");
const fs = require('fs-extra');
const path = require('path');
const { execSync } = require('child_process');
const inquirer = require('inquirer');

require('dotenv').config();

// Royal Road kütüphanesini dinamik import ile yüklüyoruz (ESM)
let RoyalRoad;
async function loadRoyalRoad() {
    if (!RoyalRoad) {
        const mod = await import('./royalroad.js');
        RoyalRoad = mod.default;
    }
    return new RoyalRoad({ enableVol: false });
}

// --- AYARLAR ---
const BOOKS_DIR = path.join(__dirname, 'books');

const client = new aisdk.PiAiClient({
    accounts: [aisdk.AccountPresets.geminiCli()],
});

// --- TERMUX BİLDİRİM FONKSİYONU ---
function sendTermuxNotification(current, total, status) {
    try {
        const id = "indirme_durumu";

        if (status === "success") {
            const cmd = `termux-notification -i "${id}" -t "İşlem Başarılı" -c "Tüm dosyalar (${total}/${total}) cihazına kaydedildi." --icon "check_circle" --led-color "00FF00"`;
            execSync(cmd);
            return;
        }

        const ratio = current / total;
        const barCount = Math.round(ratio * 10);
        const bar = '#'.repeat(barCount);
        const empty = '.'.repeat(10 - barCount);

        const cmd = `termux-notification -i "${id}" -t "Bölümler Çevriliyor" -c "[${bar}${empty}] ${current}/${total} tamamlandı" --icon "sync" --priority high`;
        execSync(cmd);
    } catch (error) {
        console.error("⚠️ Termux bildirimi gönderilemedi (Termux:API kurulu/aktif olmayabilir).");
    }
}

async function start() {
    try {
        console.log("🚀 Royal Road Scraper & AI Translator");

        const rr = await loadRoyalRoad();

        if (!await fs.pathExists(BOOKS_DIR)) await fs.ensureDir(BOOKS_DIR);

        // --- Novel seçimi: klasör yoksa arama yap ---
        const folders = (await fs.readdir(BOOKS_DIR, { withFileTypes: true }))
            .filter(d => d.isDirectory())
            .map(d => d.name);

        let selectedNovelPath; // "fiction/12345/novel-slug"
        let selectedNovelSlug; // klasör adı olarak kullanılacak kısa isim

        if (folders.length > 0) {
            const { action } = await inquirer.prompt([{
                type: 'list',
                name: 'action',
                message: 'Ne yapmak istersiniz?',
                choices: [
                    { name: '📚 Var olan kitap', value: 'existing' },
                    { name: '🔍 Yeni novel ara', value: 'search' },
                ],
            }]);

            if (action === 'existing') {
                const { chosen } = await inquirer.prompt([{
                    type: 'list',
                    name: 'chosen',
                    message: 'Kitap seçin:',
                    choices: folders,
                }]);

                // Klasörde kaydedilen novel path'ini oku
                const metaPath = path.join(BOOKS_DIR, chosen, 'meta.json');
                if (await fs.pathExists(metaPath)) {
                    const meta = await fs.readJson(metaPath);
                    selectedNovelPath = meta.path;
                    selectedNovelSlug = chosen;
                } else {
                    console.log("❌ meta.json bulunamadı, lütfen novel'i yeniden aratın.");
                    return;
                }
            } else {
                ({ selectedNovelPath, selectedNovelSlug } = await searchAndSelectNovel(rr));
            }
        } else {
            console.log("📂 'books/' klasörü boş, novel aranıyor...");
            ({ selectedNovelPath, selectedNovelSlug } = await searchAndSelectNovel(rr));
        }

        if (!selectedNovelPath) return;

        const novelDir = path.join(BOOKS_DIR, selectedNovelSlug);
        await fs.ensureDir(novelDir);

        // --- Novel metadata + bölüm listesini çek ---
        console.log("🔍 Novel bilgileri alınıyor...");
        const novel = await rr.parseNovel(selectedNovelPath);

        // meta.json kaydet
        await fs.writeJson(path.join(novelDir, 'meta.json'), {
            path:    novel.path,
            name:    novel.name,
            author:  novel.author,
            status:  novel.status,
            genres:  novel.genres,
            summary: novel.summary,
        }, { spaces: 2 });

        // --- Kapak resmi ---
        const coverPath = path.join(novelDir, 'cover.jpg');
        if (!await fs.pathExists(coverPath) && novel.cover) {
            console.log(`📸 Kapak indiriliyor: ${novel.cover}`);
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

        // --- Eksik bölümleri tespit et ---
        const files = await fs.readdir(novelDir);
        const existingChapters = new Set();
        files.forEach(file => {
            const match = file.match(/ch(\d+)\.md/);
            if (match) existingChapters.add(parseInt(match[1]));
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
            const chNum = targetChapters[i];
            const chapter = allChapters[chNum - 1];
            if (!chapter) {
                console.log(`⚠️ Bölüm ${chNum} listede yok.`);
                break;
            }
            await processChapter(rr, novelDir, chapter, chNum);
            sendTermuxNotification(i + 1, targetChapters.length, "progress");
        }

        sendTermuxNotification(targetChapters.length, targetChapters.length, "success");
        console.log("🎉 Tüm çeviri işlemleri tamamlandı!");

    } catch (err) {
        console.error("💥 Kritik Hata:", err.message);
    }
}

// --- Novel arama yardımcısı ---
async function searchAndSelectNovel(rr) {
    const { searchTerm } = await inquirer.prompt([{
        type: 'input',
        name: 'searchTerm',
        message: 'Royal Road\'da novel ara:',
    }]);

    console.log("🔍 Aranıyor...");
    const results = await rr.searchNovels(searchTerm, 1);

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

    // Klasör adı: path'ten slug üret  e.g. "fiction/12345/my-novel" → "my-novel"
    const slug = chosen.path.split('/').pop();
    return { selectedNovelPath: chosen.path, selectedNovelSlug: slug };
}

// --- Bölüm işleme ---
async function processChapter(rr, novelDir, chapter, chapterNum) {
    const filePath = path.join(novelDir, `ch${chapterNum}.md`);
    console.log(`\n--- [Bölüm ${chapterNum}: ${chapter.name}] ---`);

    try {
        // Royal Road kütüphanemizle içeriği çek
        const html = await rr.parseChapter(chapter.path);

        // HTML taglerini temizle, düz metin al
        const content = html
            .replace(/<[^>]+>/g, ' ')
            .replace(/&nbsp;/g, ' ')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'")
            .replace(/\s{3,}/g, '\n\n')
            .trim();

        if (!content || content.length < 100) {
            console.log("❌ İçerik çekilemedi veya çok kısa.");
            return;
        }

        console.log(`🤖 AI çevirisi başlıyor (${chapterNum})...`);

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
            console.error(`❌ Bölüm ${chapterNum}: API'den gelen çeviri çok kısa/boş!`);
        } else {
            const markdown = `# ${chapter.name}\n\n${translatedText.trim()}`;
            await fs.writeFile(filePath, markdown, 'utf-8');
            console.log(`💾 Kaydedildi: ch${chapterNum}.md`);
        }

        // Throttle: 2.5–5.5 saniye bekle
        const delay = Math.floor(Math.random() * 3000) + 2500;
        await new Promise(res => setTimeout(res, delay));

    } catch (err) {
        console.error(`❌ Bölüm ${chapterNum} hatası:`, err.message);
    }
}

start();

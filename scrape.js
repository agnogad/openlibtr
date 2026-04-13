const fs = require('fs-extra');
const path = require('path');
const { execSync } = require('child_process');
const cheerio = require('cheerio');
const inquirer = require('inquirer');
const { GoogleGenerativeAI } = require("@google/generative-ai");
require('dotenv').config();

// --- AYARLAR ---
const BOOKS_DIR = path.join(__dirname, 'books');
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash-lite" });

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

async function start() {
    try {
        console.log("🚀 NovelBin Pro Scraper & Gemini Translator");

        if (!await fs.pathExists(BOOKS_DIR)) await fs.ensureDir(BOOKS_DIR);
        const folders = (await fs.readdir(BOOKS_DIR, { withFileTypes: true }))
            .filter(dirent => dirent.isDirectory())
            .map(dirent => dirent.name);

        if (folders.length === 0) {
            console.log("❌ 'books/' klasörü boş!");
            return;
        }

        const { selectedNovel } = await inquirer.prompt([{
            type: 'list',
            name: 'selectedNovel',
            message: 'Kitap seçin:',
            choices: folders
        }]);
        
        const novelPath = path.join(BOOKS_DIR, selectedNovel);
const files = await fs.readdir(novelPath);

// Dosya listesinde 'Cover.jpg' var mı bak (Büyük/küçük harf duyarlı)
const hasCover = files.includes('cover.jpg');

if (!hasCover) {
    console.log(" ¯\_(ツ)_/¯  Kapak fotoğrafı yok, 🔍 kendim indiriyorum...");
    const curlCmd = `curl -s -L -A "${USER_AGENT}" -H "Referer: https://novelbin.com/" "https://novelbin.com/b/${selectedNovel}"`;
const html = execSync(curlCmd, { encoding: 'utf-8', maxBuffer: 1024 * 1024 * 10 });
const $ = cheerio.load(html);

// 1. '.book' class'ı içindeki img etiketinin 'src' attribute'unu al
let imageUrl = $('.book img').attr('src') || $('.book img').attr('data-src');


if (imageUrl) {
    // Eğer URL protokol içermiyorsa (örn: //resim.com), başına https: ekle
    if (imageUrl.startsWith('//')) {
        imageUrl = 'https:' + imageUrl;
    }

    console.log(`📸 Resim bulundu: ${imageUrl}`);

    // 2. Resmi indir ve 'cover.jpg' olarak kaydet
    const coverPath = path.join(novelPath, 'cover.jpg');
    
    try {
        // -o parametresi çıktıyı belirtilen dosya yoluna yazar
        const downloadCmd = `curl -s -L -A "${USER_AGENT}" -H "Referer: https://novelbin.com/" "${imageUrl}" -o "${coverPath}"`;
        execSync(downloadCmd);
        console.log("✅ Kapak fotoğrafı başarıyla indirildi.");
    } catch (downloadError) {
        console.error("❌ Resim indirilirken hata oluştu:", downloadError.message);
    }
} else {
    console.log("⚠️ Sayfada kapak resmi bulunamadı.");
}

}


        const novelUrl = `https://novelbin.com/ajax/chapter-archive?novelId=${selectedNovel}`; 

        console.log("🔍 Sayfa taranıyor, tüm bölümler ayıklanıyor...");
        const allChapterLinks = await getAllChapterLinks(novelUrl);
        
        if (allChapterLinks.length === 0) {
            console.log("❌ Hiç bölüm bulunamadı! Sayfa yapısı farklı olabilir.");
            return;
        }
        
        console.log(`✅ Toplam ${allChapterLinks.length} adet bölüm linki toplandı.`);

        
        
        let lastChapterIdx = 0;

        files.forEach(file => {
            const match = file.match(/ch(\d+)\.md/);
            if (match) {
                const num = parseInt(match[1]);
                if (num > lastChapterIdx) lastChapterIdx = num;
            }
        });

        console.log(`ℹ️ Mevcut durum: ch${lastChapterIdx}.md`);

        const { count } = await inquirer.prompt([{
            type: 'number',
            name: 'count',
            message: 'Kaç yeni bölüm çevrilsin?',
            default: 1
        }]);

        for (let i = 1; i <= count; i++) {
            const targetIdx = lastChapterIdx + i;
            // DİKKAT: Liste 0'dan başlar, ch1 listedeki 0. elemandır.
            const targetLink = allChapterLinks[targetIdx - 1];

            if (!targetLink) {
                console.log(`⚠️ Bölüm ${targetIdx} listede yok. Romanın sonuna gelmiş olabilirsiniz.`);
                break;
            }

            await processChapter(selectedNovel, targetLink, targetIdx);
        }

    } catch (err) {
        console.error("💥 Kritik Hata:", err.message);
    }
}

async function getAllChapterLinks(novelUrl) {
    try {
        // -L takibi ve referer ile çekiyoruz
        const curlCmd = `curl -s -L -A "${USER_AGENT}" "${novelUrl}"`;
        const html = execSync(curlCmd, { encoding: 'utf-8', maxBuffer: 1024 * 1024 * 10 });
        const $ = cheerio.load(html);
        
        const linksSet = new Set(); // Tekrar eden linkleri engellemek için

        // 1. Yol: Senin verdiğin yapı (En garantisi)
        $('a').each((i, el) => {
            const href = $(el).attr('href');
            if (href && href.startsWith('http' && href.includes('/chapter-'))) linksSet.add(href);
        });

        // 2. Yol: Alternatif (Eğer li içinde değilse ama chapter linki ise)
        if (linksSet.size === 0) {
            $('a').each((i, el) => {
                const href = $(el).attr('href');
                if (href && href.includes('/chapter-')) {
                    linksSet.add(href);
                }
            });
        }

        // Linkleri diziye çevir ve sırala (URL'deki rakama göre sıralamak en mantıklısı)
        let sortedLinks = Array.from(linksSet);
        
        // Eğer linkler karışık gelirse diye basit bir numerik sıralama denemesi:
        sortedLinks.sort((a, b) => {
            const numA = parseInt(a.match(/chapter-(\d+)/)?.[1] || 0);
            const numB = parseInt(b.match(/chapter-(\d+)/)?.[1] || 0);
            return numA - numB;
        });

        return sortedLinks;
    } catch (e) {
        console.error("Link toplama hatası:", e.message);
        return [];
    }
}

async function processChapter(novelName, url, chapterNum) {
    const filePath = path.join(BOOKS_DIR, novelName, `ch${chapterNum}.md`);
    console.log(`\n--- [Sıradaki: Bölüm ${chapterNum}] ---`);

    try {
        const curlCmd = `curl -s -L -A "${USER_AGENT}" -H "Referer: https://novelbin.com/" "${url}"`;
        const html = execSync(curlCmd, { encoding: 'utf-8', maxBuffer: 1024 * 1024 * 10 });
        const $ = cheerio.load(html);
        
        // Başlık ve İçerik Temizleme
        const title = $('.chr-title').text().trim() || $('.title').first().text().trim() || `Chapter ${chapterNum}`;
        let content = $('#chr-content').text().trim();
        if (!content) content = $('.chr-c').text().trim();
        if (!content) content = $('.chapter-content').text().trim();
        if (!content) content = $('#chr-content').text().trim();

        if (!content || content.length < 100) {
            console.log("❌ İçerik çok kısa veya çekilemedi. HTML yapısı farklı olabilir.");
            return;
        }

        console.log(`🤖 Gemini (${chapterNum}) çevirisine başladı...`);
        const prompt = `Aşağıdaki İngilizce roman metnini Türkçe'ye çevir. 
        
KURALLAR:
1. Akıcı, edebi ve profesyonel bir dil kullan.
2. Light novel olduğunu göze alarak ona uygun paragraflar kullan. Her paragraf arasında mutlaka bir satır boşluk bırak.
3. Sadece çeviri metnini döndür, başına veya sonuna açıklama ekleme.

İÇERİK:
${content}`;

        // Model ayarlarını bu şekilde dene
const result = await model.generateContent({
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
        temperature: 0.9, // Edebi metinlerde yaratıcılık ve yapı için daha iyidir
    }
});

let translatedText = result.response.text();

// Yazmadan önce metnin başına ve sonuna trim uygulayıp, 
// satır sonlarının korunduğundan emin olalım
await fs.writeFile(filePath, translatedText.trim(), 'utf-8');

        console.log(`💾 Başarıyla kaydedildi: ch${chapterNum}.md`);

        // Anti-ban beklemesi
        const delay = Math.floor(Math.random() * 3000) + 2500;
        await new Promise(res => setTimeout(res, delay));

    } catch (err) {
        console.error(`❌ Bölüm ${chapterNum} hatası:`, err.message);
    }
}

start();

const fs = require('fs');
const path = require('path');

const BOOKS_DIR = path.join(__dirname, 'books');
const LIB_INDEX_PATH = path.join(__dirname, 'library.json');

function syncLibrary() {
    if (!fs.existsSync(BOOKS_DIR)) {
        console.log("❌ 'books' klasörü bulunamadı!");
        return;
    }

    // 1. Mevcut kütüphaneyi oku (Eğer dosya yoksa boş dizi başlat)
    let oldLibrary = [];
    if (fs.existsSync(LIB_INDEX_PATH)) {
        try {
            oldLibrary = JSON.parse(fs.readFileSync(LIB_INDEX_PATH, 'utf-8'));
        } catch (e) {
            oldLibrary = [];
        }
    }

    const libraryIndex = [];
    const bookFolders = fs.readdirSync(BOOKS_DIR);

    bookFolders.forEach(folder => {
        const folderPath = path.join(BOOKS_DIR, folder);
        
        if (fs.lstatSync(folderPath).isDirectory()) {
            const files = fs.readdirSync(folderPath)
                .filter(file => file.endsWith('.md'))
                .sort((a, b) => {
                    const numA = parseInt(a.match(/\d+/) || 0);
                    const numB = parseInt(b.match(/\d+/) || 0);
                    return numA - numB;
                });

            const chapters = files.map((file, index) => {
                const cleanTitle = file.replace('.md', '').replace(/-/g, ' ');
                return {
                    id: index + 1,
                    title: cleanTitle.charAt(0).toUpperCase() + cleanTitle.slice(1),
                    path: file
                };
            });

            // Config.json güncelleme (İçerik değişmese de yazılabilir, maliyeti düşüktür)
            const configPath = path.join(folderPath, 'config.json');
            fs.writeFileSync(configPath, JSON.stringify({
                slug: folder,
                total_chapters: chapters.length,
                chapters: chapters
            }, null, 2));

            // 2. Değişiklik kontrolü
            const oldBookData = oldLibrary.find(b => b.slug === folder);
            let lastUpdated = oldBookData ? oldBookData.lastUpdated : new Date().toISOString();

            // Eğer bölüm sayısı değişmişse tarihi güncelle
            if (oldBookData && oldBookData.chapterCount !== chapters.length) {
                console.log(`✨ ${folder} güncellendi (Yeni bölümler eklendi).`);
                lastUpdated = new Date().toISOString();
            } else if (!oldBookData) {
                console.log(`🆕 ${folder} kütüphaneye yeni eklendi.`);
            }

            libraryIndex.push({
                title: folder.replace(/-/g, ' ').toUpperCase(),
                slug: folder,
                chapterCount: chapters.length,
                lastUpdated: lastUpdated
            });
        }
    });

    fs.writeFileSync(LIB_INDEX_PATH, JSON.stringify(libraryIndex, null, 2));
    console.log(`\n✅ İşlem tamamlandı.`);
}

syncLibrary();

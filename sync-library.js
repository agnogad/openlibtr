const fs = require('fs');
const path = require('path');

const BOOKS_DIR = path.join(__dirname, 'books');
const LIB_INDEX_PATH = path.join(__dirname, 'library.json');

function syncLibrary() {
    if (!fs.existsSync(BOOKS_DIR)) {
        console.log("❌ 'books' klasörü bulunamadı!");
        return;
    }

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

            // --- BAŞLIK BELİRLEME MANTIĞI (Yeni Kısım) ---
            const metaPath = path.join(folderPath, 'meta.json');
            let displayTitle = folder.replace(/-/g, ' ').toUpperCase(); // Varsayılan yöntem

            if (fs.existsSync(metaPath)) {
                try {
                    const metaData = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
                    if (metaData.name) {
                        displayTitle = metaData.name; // meta.json varsa oradan al
                    }
                } catch (e) {
                    console.error(`⚠️ ${folder} içindeki meta.json okunamadı, klasör ismi kullanılıyor.`);
                }
            }
            // --------------------------------------------

            const configPath = path.join(folderPath, 'config.json');
            fs.writeFileSync(configPath, JSON.stringify({
                slug: folder,
                total_chapters: chapters.length,
                chapters: chapters
            }, null, 2));

            const oldBookData = oldLibrary.find(b => b.slug === folder);
            let lastUpdated = oldBookData ? oldBookData.lastUpdated : new Date().toISOString();

            if (oldBookData && oldBookData.chapterCount !== chapters.length) {
                console.log(`✨ ${folder} güncellendi.`);
                lastUpdated = new Date().toISOString();
            } else if (!oldBookData) {
                console.log(`🆕 ${folder} kütüphaneye yeni eklendi.`);
            }

            libraryIndex.push({
                title: displayTitle, // Belirlenen başlığı kullan
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

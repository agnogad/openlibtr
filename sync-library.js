const fs = require('fs');
const path = require('path');

const BOOKS_DIR = path.join(__dirname, 'books');
const LIB_INDEX_PATH = path.join(__dirname, 'library.json');

function syncLibrary() {
    if (!fs.existsSync(BOOKS_DIR)) {
        console.log("❌ 'books' klasörü bulunamadı! Lütfen oluşturun.");
        return;
    }

    const libraryIndex = [];
    const bookFolders = fs.readdirSync(BOOKS_DIR);

    bookFolders.forEach(folder => {
        const folderPath = path.join(BOOKS_DIR, folder);
        
        // Sadece klasörleri işle
        if (fs.lstatSync(folderPath).isDirectory()) {
            console.log(`📖 İşleniyor: ${folder}`);

            // Klasör içindeki .md dosyalarını bul ve sırala
            const files = fs.readdirSync(folderPath)
                .filter(file => file.endsWith('.md'))
                .sort((a, b) => {
                    // Dosya isimlerindeki sayıları alıp ona göre sıralar (bolum-1, bolum-2 vb.)
                    const numA = parseInt(a.match(/\d+/) || 0);
                    const numB = parseInt(b.match(/\d+/) || 0);
                    return numA - numB;
                });

            const chapters = files.map((file, index) => {
                // Dosya adından temiz başlık oluştur (bolum-1.md -> Bölüm 1)
                const cleanTitle = file.replace('.md', '').replace(/-/g, ' ');
                return {
                    id: index + 1,
                    title: cleanTitle.charAt(0).toUpperCase() + cleanTitle.slice(1),
                    path: file
                };
            });

            // Her kitap için özel config.json oluştur
            const configPath = path.join(folderPath, 'config.json');
            fs.writeFileSync(configPath, JSON.stringify({
                slug: folder,
                total_chapters: chapters.length,
                chapters: chapters
            }, null, 2));

            // Ana kütüphane listesine ekle
            libraryIndex.push({
                title: folder.replace(/-/g, ' ').toUpperCase(),
                slug: folder,
                chapterCount: chapters.length,
                lastUpdated: new Date().toISOString()
            });
        }
    });

    // Ana library.json dosyasını güncelle
    fs.writeFileSync(LIB_INDEX_PATH, JSON.stringify(libraryIndex, null, 2));
    console.log(`\n✅ Başarılı! library.json ve tüm config.json dosyaları güncellendi.`);
}

syncLibrary();

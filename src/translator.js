/**
 * src/translator.js
 * AI çeviri katmanı.
 */

const aisdk = require('../lib/aisdk.js');

// AI istemcisini bir kez oluştur
const client = new aisdk.PiAiClient({
    accounts: [aisdk.AccountPresets.geminiCli()],
});

/**
 * İngilizce metni Türkçe'ye çevirir.
 * İçerik zaten Türkçe ise (ğ harfi içeriyorsa) olduğu gibi döner.
 *
 * @param {string} content  - Ham metin
 * @param {number} chapterNum
 * @returns {Promise<string>} Çevrilmiş (veya orijinal) metin
 */
async function translate(content, chapterNum) {
    // Zaten Türkçe içerik – çevirme
    if (content.includes("ğ")) {
        console.log(`ℹ️  Bölüm ${chapterNum} zaten Türkçe, çeviri atlanıyor.`);
        return content;
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

    if (!response.content || response.content.length < 100) {
        throw new Error(`API çevirisi çok kısa/boş! (Bölüm ${chapterNum})`);
    }

    return response.content;
}

module.exports = { translate };

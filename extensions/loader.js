/**
 * extensions/loader.js
 * extensions/ klasöründeki tüm plugin dosyalarını otomatik yükler.
 *
 * Her plugin dosyası şu yapıda export etmelidir:
 *   module.exports = {
 *     id:          'royalroad',          // benzersiz ID (zorunlu)
 *     label:       '👑 Royal Road ...',  // inquirer'da gösterilecek isim (zorunlu)
 *     getInstance: async () => { ... },  // plugin örneği döndüren async fn (zorunlu)
 *   };
 */

const fs   = require('fs-extra');
const path = require('path');

const EXT_DIR = path.join(__dirname);

// Yüklü instance'ları önbellekte tut
const _cache = {};

/**
 * extensions/ klasöründeki tüm geçerli plugin tanımlarını yükler.
 * @returns {Promise<Array<{id, label, getInstance}>>}
 */
async function loadExtensions() {
    const entries = await fs.readdir(EXT_DIR, { withFileTypes: true });

    const plugins = [];

    for (const entry of entries) {
        // Sadece .js dosyaları, loader.js'in kendisi hariç
        if (!entry.isFile()) continue;
        if (!entry.name.endsWith('.js')) continue;
        if (entry.name === 'loader.js') continue;

        const fullPath = path.join(EXT_DIR, entry.name);

        try {
            // eslint-disable-next-line import/no-dynamic-require
            const def = require(fullPath);

            if (!def.id || !def.label || typeof def.getInstance !== 'function') {
                console.warn(`⚠️  ${entry.name}: geçerli bir extension değil (id/label/getInstance eksik), atlanıyor.`);
                continue;
            }

            // getInstance'ı önbellekli hale getir
            const originalGetInstance = def.getInstance;
            def.getInstance = async () => {
                if (!_cache[def.id]) {
                    _cache[def.id] = await originalGetInstance();
                }
                return _cache[def.id];
            };

            plugins.push(def);
        } catch (err) {
            console.warn(`⚠️  ${entry.name} yüklenemedi: ${err.message}`);
        }
    }

    if (plugins.length === 0) {
        throw new Error("❌ Hiç geçerli extension bulunamadı! extensions/ klasörünü kontrol edin.");
    }

    return plugins;
}

module.exports = { loadExtensions };

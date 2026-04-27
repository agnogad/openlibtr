/**
 * extensions/royalroad.js
 * Royal Road plugin tanımı.
 */

module.exports = {
    id:    'novelupdates',
    label: '👑 NovelUpdates  (İngilizce orijinal web novellar)',

    getInstance: async () => {
        const mod = await import('../lib/novelupdates.js');
        return new mod.default({ enableVol: false });
    },
};


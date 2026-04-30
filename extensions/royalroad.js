/**
 * extensions/royalroad.js
 * Royal Road plugin tanımı.
 */

module.exports = {
    id:    'royalroad',
    label: '👑 Royal Road  (İngilizce orijinal web novellar)',

    getInstance: async () => {
        const mod = await import('../lib/royalroad.mjs');
        return new mod.default({ enableVol: false });
    },
};

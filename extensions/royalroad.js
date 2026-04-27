/**
 * extensions/royalroad.js
 * Royal Road plugin tanımı.
 */

module.exports = {
    id:    'royalroad',
    label: '👑 Royal Road  (İngilizce orijinal web novellar)',

    getInstance: async () => {
        const mod = await import('../lib/royalroad.js');
        return new mod.default({ enableVol: false });
    },
};

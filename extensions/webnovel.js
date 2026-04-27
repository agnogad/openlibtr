/**
 * extensions/royalroad.js
 * Royal Road plugin tanımı.
 */

module.exports = {
    id:    'webnovel',
    label: '👑 Webnovel  (İngilizce orijinal web novellar)',

    getInstance: async () => {
        const mod = await import('../lib/webnovel.js');
        return new mod.default({ enableVol: false });
    },
};
 

/**
 * extensions/royalroad.js
 * Royal Road plugin tanımı.
 */

module.exports = {
    id:    'novelbin',
    label: '👑 Novelbin  (İngilizce orijinal web novellar)',

    getInstance: async () => {
        const mod = await import('../lib/novelbin.js');
        return new mod.default({ enableVol: false });
    },
};
 

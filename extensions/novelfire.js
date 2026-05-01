/**
 * extensions/novelfire.js
 * Novel Fire plugin tanımı.
 */

module.exports = {
    id:    'novelfire',
    label: '🔥 Novel Fire  (İngilizce orijinal ve çeviri novellar)',

    getInstance: async () => {
        const mod = await import('../lib/novelfire.mjs');
        return new mod.default();
    },
};

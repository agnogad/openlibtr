/**
 * extensions/scribblehub.js
 * Scribble Hub plugin tanımı.
 */

module.exports = {
    id:    'scribblehub',
    label: '✍️ Scribble Hub  (İngilizce orijinal web novellar)',

    getInstance: async () => {
        const mod = await import('../lib/scribblehub.mjs');
        return new mod.default();
    },
};

module.exports = {
    id:    'novelturk',
    label: '👑 Noveltürk  (Türkçe orijinal web novellar)',

    getInstance: async () => {
        const mod = await import('../lib/novelturk.mjs');
        return new mod.default({ enableVol: false });
    },
};
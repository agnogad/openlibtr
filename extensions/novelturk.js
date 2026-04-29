module.exports = {
    id:    'novelturk',
    label: '👑 Noveltürk  (Türkçe orijinal web novellar)',

    getInstance: async () => {
        const mod = await import('../lib/novelturk.js');
        return new mod.default({ enableVol: false });
    },
};
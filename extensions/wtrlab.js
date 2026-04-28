module.exports = {
    id:    'wtrlab',
    label: '👑 WTR Lab  (İngilizce orijinal web novellar)',

    getInstance: async () => {
        const mod = await import('../lib/wtrlab.js');
        return new mod.default({ enableVol: false });
    },
};
 

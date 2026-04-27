const http = require('http');
const fs = require('fs-extra');
const path = require('path');

const COOKIE_FILE = path.join(__dirname, '..', 'cookies.json');
let server = null;
let resolveBridge = null;

const CookieBridge = {
    async getSavedData() {
        if (await fs.pathExists(COOKIE_FILE)) {
            return await fs.readJson(COOKIE_FILE);
        }
        return null;
    },

    async saveData(data) {
        await fs.writeJson(COOKIE_FILE, data, { spaces: 2 });
    },

    /**
     * Bridge sunucusunu başlatır ve çerezler gelene kadar bekleyen bir Promise döner.
     */
    waitForCookies(port = 3000) {
        return new Promise((resolve) => {
            resolveBridge = resolve;
            if (server) {
                console.log(`🌐 [Bridge] Sunucu zaten açık, çerezler bekleniyor...`);
                return;
            }

            server = http.createServer(async (req, res) => {
                res.setHeader('Access-Control-Allow-Origin', '*');
                res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
                res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

                if (req.method === 'OPTIONS') {
                    res.writeHead(204);
                    res.end();
                    return;
                }

                if (req.method === 'POST' && req.url === '/cookies') {
                    let body = '';
                    req.on('data', chunk => { body += chunk.toString(); });
                    req.on('end', async () => {
                        try {
                            const data = JSON.parse(body);
                            if (data.cookies && data.ua) {
                                await this.saveData(data);
                                console.log('\n✅ [Bridge] Çerezler alındı! İşlem devam ediyor...');
                                res.writeHead(200, { 'Content-Type': 'application/json' });
                                res.end(JSON.stringify({ status: 'ok' }));
                                
                                // Sunucuyu kapatıp devam edelim
                                server.close(() => { server = null; });
                                resolveBridge(data);
                            } else {
                                throw new Error('Geçersiz veri formatı');
                            }
                        } catch (err) {
                            res.writeHead(400);
                            res.end(err.message);
                        }
                    });
                } else {
                    res.writeHead(404);
                    res.end();
                }
            });

            server.listen(port, () => {
                console.log(`\n🌐 [Bridge] Bridge dinleniyor: http://localhost:${port}`);
                console.log(`🚀 [Bridge] Lütfen tarayıcıdan "Çerezleri Gönder" butonuna basın.`);
            });
        });
    }
};

module.exports = CookieBridge;

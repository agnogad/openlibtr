/**
 * cookie-bridge.js
 * 
 * ViolentMonkey script tarayıcıdan CF cookie + header'ları bu server'a POST eder.
 * NovelUpdates kütüphanesi bu server'dan alınan bilgilerle istek yapar.
 * 
 * Başlatmak için: node cookie-bridge.js
 */

import http from 'http';

const PORT        = 7842;
const BRIDGE_PATH = '/cf-session';
const STATUS_PATH = '/status';

// Aktif CF oturumu burada tutulur (bellekte)
let cfSession = null;
let sessionSetAt = null;

// ─── Server ───────────────────────────────────────────────────────────────────

const server = http.createServer((req, res) => {
  // CORS — ViolentMonkey script'i farklı origin'den POST eder
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // ── GET /status — oturum durumunu göster ───────────────────────────────────
  if (req.method === 'GET' && req.url === STATUS_PATH) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      active: !!cfSession,
      setAt:  sessionSetAt,
      age:    sessionSetAt ? Math.round((Date.now() - sessionSetAt) / 1000) + 's' : null,
    }));
    return;
  }

  // ── GET /cf-session — kütüphane session'ı okur ────────────────────────────
  if (req.method === 'GET' && req.url === BRIDGE_PATH) {
    if (!cfSession) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'No session yet. Open novelupdates.com in browser.' }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(cfSession));
    return;
  }

  // ── POST /cf-session — ViolentMonkey session'ı gönderir ───────────────────
  if (req.method === 'POST' && req.url === BRIDGE_PATH) {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        if (!data.cookie || !data.userAgent) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'cookie and userAgent fields required' }));
          return;
        }
        cfSession    = data;
        sessionSetAt = Date.now();
        console.log(`\n✅ [${new Date().toLocaleTimeString()}] CF session alındı`);
        console.log(`   User-Agent : ${data.userAgent.slice(0, 60)}...`);
        console.log(`   Cookie     : ${data.cookie.slice(0, 80)}...`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
      }
    });
    return;
  }

  res.writeHead(404);
  res.end();
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`\n🌉 Cookie Bridge Server — http://127.0.0.1:${PORT}`);
  console.log(`   POST ${BRIDGE_PATH}  ← ViolentMonkey buraya gönderir`);
  console.log(`   GET  ${BRIDGE_PATH}  ← NovelUpdates kütüphanesi buradan okur`);
  console.log(`   GET  ${STATUS_PATH}          ← oturum durumu\n`);
});

// ─── Export — kütüphane doğrudan da import edebilir ──────────────────────────

/**
 * Aktif CF session'ını döndürür.
 * Bridge server çalışmıyorsa veya session yoksa null döner.
 */
export async function getCfSession() {
  try {
    const res = await fetch(`http://127.0.0.1:${PORT}${BRIDGE_PATH}`);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export { PORT, BRIDGE_PATH };
export default server;


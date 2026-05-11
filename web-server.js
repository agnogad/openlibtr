const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const fs = require('fs-extra');
const path = require('path');
const { exec } = require('child_process');

const { loadExtensions } = require('./extensions/loader');
const { fetchAndSaveMeta, getMissingChapters, fixMissingCovers } = require('./src/novel');
const { processChapter } = require('./src/chapter');
const { sendTermuxNotification } = require('./src/notifier');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

const BOOKS_DIR = path.join(__dirname, 'books');
const PORT = 4000;

app.use(cors());
app.use(express.json());

// Serving books/cover.jpg for novels
app.use('/covers', express.static(BOOKS_DIR));

let extensions = [];
let activeTasks = {};

// Load extensions initially
async function initExtensions() {
    extensions = await loadExtensions();
}
initExtensions();

// API Endpoints
app.get('/api/extensions', (req, res) => {
    res.json(extensions.map(e => ({ id: e.id, label: e.label })));
});

app.get('/api/library', async (req, res) => {
    console.log(`[API] Library requested from ${req.ip}`);
    const libPath = path.join(__dirname, 'library.json');
    try {
        if (await fs.pathExists(libPath)) {
            const lib = await fs.readJson(libPath);
            console.log(`[API] Sending ${lib.length} items`);
            res.json(Array.isArray(lib) ? lib : []);
        } else {
            console.log("[API] library.json not found");
            res.json([]);
        }
    } catch (err) {
        console.error("[API] Library Read Error:", err);
        res.status(500).json({ error: "Could not read library.json" });
    }
});

app.get('/api/novel/:slug', async (req, res) => {
    const { slug } = req.params;
    const metaPath = path.join(BOOKS_DIR, slug, 'meta.json');
    if (await fs.pathExists(metaPath)) {
        const meta = await fs.readJson(metaPath);
        const files = await fs.readdir(path.join(BOOKS_DIR, slug));
        const chapters = files.filter(f => f.match(/^ch\d+\.md$/)).map(f => ({
            name: f,
            num: parseInt(f.match(/^ch(\d+)\.md$/)[1])
        })).sort((a,b) => a.num - b.num);
        
        res.json({ ...meta, chapterFiles: chapters });
    } else {
        res.status(404).json({ error: 'Novel not found' });
    }
});

app.post('/api/search', async (req, res) => {
    const { sourceId, searchTerm } = req.body;
    const ext = extensions.find(e => e.id === sourceId);
    if (!ext) return res.status(400).json({ error: 'Extension not found' });

    try {
        const plugin = await ext.getInstance();
        const results = await plugin.searchNovels(searchTerm, 1);
        res.json(results);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/fetch-meta', async (req, res) => {
    const { sourceId, novelPath } = req.body;
    const ext = extensions.find(e => e.id === sourceId);
    if (!ext) return res.status(400).json({ error: 'Extension not found' });

    try {
        const plugin = await ext.getInstance();
        const slug = novelPath
            .replace(/\/$/, '')
            .split('/')
            .filter(Boolean)
            .pop()
            .replace(/[^a-zA-Z0-9-_]/g, '-')
            .toLowerCase();
        
        const novelDir = path.join(BOOKS_DIR, slug);
        await fs.ensureDir(novelDir);
        
        const novel = await fetchAndSaveMeta(plugin, novelDir, novelPath, sourceId);
        res.json({ ...novel, slug });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/process', async (req, res) => {
    const { sourceId, novelSlug, novelPath, count } = req.body;
    
    if (activeTasks[novelSlug]) {
        return res.status(400).json({ error: 'Task already running for this novel' });
    }

    const ext = extensions.find(e => e.id === sourceId);
    if (!ext) return res.status(400).json({ error: 'Extension not found' });

    const novelDir = path.join(BOOKS_DIR, novelSlug);
    
    // Start background process
    activeTasks[novelSlug] = { status: 'running', current: 0, total: count, logs: ['Initializing...'] };
    
    (async () => {
        try {
            const plugin = await ext.getInstance();
            const novel = await plugin.parseNovel(novelPath);
            const allChapters = novel.chapters || [];
            
            const existingFiles = await fs.readdir(novelDir);
            const targetChapterNums = getMissingChapters(existingFiles, allChapters.length, count);
            
            activeTasks[novelSlug].total = targetChapterNums.length;
            activeTasks[novelSlug].logs.push(`Found ${targetChapterNums.length} chapters to process`);

            io.emit('task-started', { novelSlug, total: targetChapterNums.length, chapters: targetChapterNums });
            sendTermuxNotification(0, targetChapterNums.length, "progress");

            const CONCURRENCY = 5;
            let successCount = 0;
            let completedCount = 0;
            const totalCh = targetChapterNums.length;

            for (let i = 0; i < totalCh; i += CONCURRENCY) {
                const batch = targetChapterNums.slice(i, i + CONCURRENCY);

                const results = await Promise.all(batch.map(async (chNum, idx) => {
                    const chapter = allChapters[chNum - 1];
                    if (!chapter) return false;

                    const logMsg = `Processing Ch ${chNum}: ${chapter.name}`;
                    activeTasks[novelSlug].lastChapter = logMsg;
                    activeTasks[novelSlug].logs.unshift(logMsg);
                    if (activeTasks[novelSlug].logs.length > 10) activeTasks[novelSlug].logs.pop();

                    io.emit('task-progress', {
                        novelSlug,
                        current: completedCount + idx + 1,
                        total: totalCh,
                        chapterNum: chNum,
                        chapterName: chapter.name
                    });

                    if (idx > 0) await new Promise(r => setTimeout(r, 1000 * idx));

                    const result = await processChapter(plugin, novelDir, chapter, chNum);
                    return result;
                }));

                successCount += results.filter(Boolean).length;
                completedCount += batch.length;
                activeTasks[novelSlug].current = completedCount;
                activeTasks[novelSlug].progress = (completedCount / totalCh) * 100;
                sendTermuxNotification(completedCount, totalCh, "progress");
            }

            // Sync library
            exec('node sync-library.js', (err) => {
                if (err) console.error('Sync failed:', err);
                io.emit('library-updated');
            });

            io.emit('task-completed', { novelSlug, successCount, total: targetChapterNums.length });
            sendTermuxNotification(successCount, targetChapterNums.length, "success");
            delete activeTasks[novelSlug];
        } catch (err) {
            console.error(err);
            io.emit('task-failed', { novelSlug, error: err.message });
            delete activeTasks[novelSlug];
        }
    })();

    res.json({ message: 'Process started' });
});

app.get('/api/active-tasks', (req, res) => {
    res.json(activeTasks);
});

app.post('/api/fix-covers', async (req, res) => {
    const { sourceId } = req.body;
    const ext = extensions.find(e => e.id === sourceId);
    if (!ext) return res.status(400).json({ error: 'Extension not found' });

    try {
        const plugin = await ext.getInstance();
        const BOOKS_DIR = path.join(__dirname, 'books');
        const allFolders = (await fs.readdir(BOOKS_DIR, { withFileTypes: true }))
            .filter(d => d.isDirectory())
            .map(d => d.name);

        const providerFolders = [];
        for (const folder of allFolders) {
            const metaPath = path.join(BOOKS_DIR, folder, 'meta.json');
            if (await fs.pathExists(metaPath)) {
                try {
                    const meta = await fs.readJson(metaPath);
                    if (meta.source === sourceId) {
                        providerFolders.push({ value: folder });
                    }
                } catch {}
            }
        }

        const fixed = await fixMissingCovers(plugin, providerFolders, BOOKS_DIR);
        res.json({ fixed });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

server.listen(PORT, () => {
    console.log(`Web server running at http://localhost:${PORT}`);
});

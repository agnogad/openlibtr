#!/usr/bin/env node

const { parse } = require("node-html-parser");
const https = require("https");
const http = require("http");
const fs = require("fs");
const path = require("path");

// ─── HTTP ────────────────────────────────────────────────────────────────────

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith("https") ? https : http;
    lib
      .get(url, { headers: { "User-Agent": "Mozilla/5.0" } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return fetchUrl(res.headers.location).then(resolve).catch(reject);
        }
        if (res.statusCode !== 200) {
          return reject(new Error(`HTTP ${res.statusCode} — ${url}`));
        }
        let data = "";
        res.setEncoding("utf8");
        res.on("data", (c) => (data += c));
        res.on("end", () => resolve(data));
      })
      .on("error", reject);
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ─── Label çıkar ─────────────────────────────────────────────────────────────

function extractLabelFromUrl(url) {
  const labelMatch = url.match(/\/search\/label\/([^/?#]+)/i);
  if (labelMatch) return decodeURIComponent(labelMatch[1]);
  return null;
}

function extractLabelFromHtml(html) {
  const root = parse(html);
  const labelLinks = root.querySelectorAll('a[href*="/search/label/"]');

  const labels = labelLinks
    .map((a) => {
      const m = a.getAttribute("href").match(/\/search\/label\/([^/?#]+)/);
      return m ? decodeURIComponent(m[1]) : null;
    })
    .filter(Boolean)
    .filter((l) => l !== "Bolum");

  if (!labels.length) return null;
  return labels.reduce((a, b) => (a.length >= b.length ? a : b));
}

// ─── FEED (FULL + SAFE PAGINATION) ───────────────────────────────────────────

async function fetchAllChapters(label) {
  const chapters = [];
  const seen = new Set();

  let startIndex = 1;
  const maxResults = 150;
  let page = 1;

  console.log(`\n🔍 "${label}" için TÜM feed taranıyor...`);

  while (true) {
    console.log(`📄 Sayfa ${page} (start=${startIndex})`);

    const feedUrl =
      `https://www.novelturk.com/feeds/posts/summary/-/${encodeURIComponent(label)}` +
      `?alt=json&start-index=${startIndex}&max-results=${maxResults}`;

    const raw = await fetchUrl(feedUrl);

    let feed;
    try {
      feed = JSON.parse(raw);
    } catch {
      throw new Error("Feed parse hatası");
    }

    const entries = feed.feed.entry ?? [];

    if (entries.length === 0) {
      console.log("⛔ Bitti (boş sayfa)");
      break;
    }

    let newCount = 0;

    for (const entry of entries) {
      const altLink = (entry.link ?? []).find((l) => l.rel === "alternate");
      if (!altLink) continue;

      if (seen.has(altLink.href)) continue;
      seen.add(altLink.href);
      newCount++;

      const cats = (entry.category ?? []).map((c) => c.term);
      console.log(entry.title.$t);
      if (!cats.includes("Bolum")) continue;
      if (!cats.includes(label)) continue;

      chapters.push({
        title: entry.title.$t.trim(),
        url: altLink.href,
        published: entry.published.$t,
      });
    }

    if (newCount === 0) {
      console.log("⛔ Yeni veri yok → feed tekrar ediyor");
      break;
    }

    startIndex += maxResults;
    page++;

    await sleep(300);
  }

  return chapters;
}

// ─── SIRALAMA (GÜÇLÜ) ────────────────────────────────────────────────────────

function parseOrder(ch) {
  // URL'den bölüm
  const urlMatch = ch.url.match(/bolum-(\d+)/i);
  const bolum = urlMatch ? parseInt(urlMatch[1], 10) : 0;

  // başlıktan cilt
  const t = ch.title;
  const ciltMatch = t.match(/(\d+(?:[.,]\d+)?)\s*(?:Cilt)/i) ||
                    t.match(/Cilt\s*(\d+(?:[.,]\d+)?)/i);

  const cilt = ciltMatch ? parseFloat(ciltMatch[1].replace(",", ".")) : 0;

  return { cilt, bolum };
}

function sortChapters(chapters) {
  return [...chapters].sort((a, b) => {
    const oa = parseOrder(a);
    const ob = parseOrder(b);

    if (oa.cilt !== ob.cilt) return oa.cilt - ob.cilt;
    return oa.bolum - ob.bolum;
  });
}

// ─── CONTENT ─────────────────────────────────────────────────────────────────

function parseChapterContent(html) {
  const root = parse(html);
  const article = root.querySelector("article") ?? root;

  return article
    .querySelectorAll("p")
    .map((p) => p.text.trim())
    .filter(Boolean)
    .join("\n\n");
}

// ─── MAIN ────────────────────────────────────────────────────────────────────

async function main() {
  const [startUrl, folderArg] = process.argv.slice(2);

  if (!startUrl) {
    console.error("Kullanım: node novel-downloader.js <url>");
    process.exit(1);
  }

  let label = extractLabelFromUrl(startUrl);

  if (!label) {
    const html = await fetchUrl(startUrl);
    label = extractLabelFromHtml(html);
  }

  if (!label) {
    console.error("❌ Label bulunamadı");
    process.exit(1);
  }

  console.log(`📚 Novel: ${label}`);

  const novelSlug =
    folderArg ??
    label.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");

  const outputDir = path.join("books", novelSlug);

  const raw = await fetchAllChapters(label);

  if (!raw.length) {
    console.error("❌ Bölüm bulunamadı");
    process.exit(1);
  }

  const chapters = sortChapters(raw);

  console.log(`\n✅ Toplam: ${chapters.length} bölüm\n`);

  fs.mkdirSync(outputDir, { recursive: true });

  let i = 1;

  for (const ch of chapters) {
    const filename = `ch${i}.md`;
    const filepath = path.join(outputDir, filename);

    process.stdout.write(`[${i}/${chapters.length}] ${ch.title} ... `);

    try {
      const html = await fetchUrl(ch.url);
      const content = parseChapterContent(html);

      fs.writeFileSync(
        filepath,
        `# ${ch.title}\n\n${content}\n`,
        "utf8"
      );

      console.log("✅");
    } catch (e) {
      console.log("❌");
    }

    i++;
    await sleep(500);
  }

  console.log("\n🎉 Bitti!");
}

main();
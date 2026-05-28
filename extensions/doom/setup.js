#!/usr/bin/env node
/**
 * setup.js — Download all offline assets for the Doom extension.
 * Run once before building: node setup.js
 *
 * Downloads:
 *   assets/js-dos.js          — js-dos v8 runtime (~2MB)
 *   assets/doom.jsdos         — DOOM Shareware bundle (~4MB)
 */

const https = require("https");
const http = require("http");
const fs = require("fs");
const path = require("path");

const ASSETS_DIR = path.join(__dirname, "assets");

const DOWNLOADS = [
  {
    name: "js-dos v8 runtime",
    url: "https://v8.js-dos.com/latest/js-dos.js",
    dest: "js-dos.js",
  },
  {
    name: "DOOM Shareware bundle",
    url: "https://cdn.dos.zone/custom/dos/doom.jsdos",
    dest: "doom.jsdos",
  },
];

function download(url, destPath, label) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);
    let received = 0;
    let total = 0;
    let lastPct = -1;

    const handleRes = (res) => {
      // Follow redirects
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        file.close();
        fs.unlinkSync(destPath);
        const redirectUrl = res.headers.location;
        const mod = redirectUrl.startsWith("https") ? https : http;
        mod.get(redirectUrl, handleRes).on("error", reject);
        return;
      }

      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        return;
      }

      total = parseInt(res.headers["content-length"] || "0", 10);

      res.on("data", (chunk) => {
        received += chunk.length;
        if (total > 0) {
          const pct = Math.floor((received / total) * 100);
          if (pct !== lastPct && pct % 10 === 0) {
            process.stdout.write(`\r  ${label}: ${pct}%`);
            lastPct = pct;
          }
        }
      });

      res.pipe(file);
      file.on("finish", () => {
        file.close();
        const kb = Math.round(received / 1024);
        process.stdout.write(`\r  ${label}: ✓ ${kb} KB\n`);
        resolve();
      });
    };

    const mod = url.startsWith("https") ? https : http;
    mod.get(url, handleRes).on("error", (err) => {
      fs.unlink(destPath, () => {});
      reject(err);
    });
  });
}

async function main() {
  if (!fs.existsSync(ASSETS_DIR)) {
    fs.mkdirSync(ASSETS_DIR, { recursive: true });
  }

  console.log("🔫 Doom Extension — Asset Setup\n");

  for (const { name, url, dest } of DOWNLOADS) {
    const destPath = path.join(ASSETS_DIR, dest);
    if (fs.existsSync(destPath)) {
      const kb = Math.round(fs.statSync(destPath).size / 1024);
      console.log(`  ${name}: already downloaded (${kb} KB) — skipping`);
      continue;
    }
    process.stdout.write(`  ${name}: downloading...\n`);
    try {
      await download(url, destPath, name);
    } catch (err) {
      console.error(`\n  ✗ Failed to download ${name}: ${err.message}`);
      process.exit(1);
    }
  }

  console.log("\n✅ All assets ready. Run: node esbuild.js\n");
}

main();

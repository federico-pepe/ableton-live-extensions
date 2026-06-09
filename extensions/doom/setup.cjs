#!/usr/bin/env node
/**
 * setup.js — Fetch all offline assets for the Doom extension.
 * Run once before building:  npm run setup
 *
 * The extension is fully offline at runtime: every asset below is bundled into
 * dist/extension.js and written to a temp folder when the game launches, so
 * js-dos never touches the network. This script only acquires the assets at
 * build time (the assets/ folder is gitignored).
 *
 * Acquires into assets/:
 *   js-dos.js, js-dos.css              — js-dos runtime + styles (from npm js-dos)
 *   emulators/emulators.js             — js-dos emulator loader        (from npm)
 *   emulators/wdosbox.js, .wasm        — DOSBox WASM core              (from npm)
 *   emulators/wlibzip.js, .wasm        — libzip WASM (reads .jsdos)    (from npm)
 *   doom.jsdos                         — DOOM Shareware bundle  (from cdn.dos.zone)
 *
 * Pinning the js-dos version keeps js-dos.js and the emulator core in lockstep.
 */

const https = require("https");
const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const ASSETS_DIR = path.join(__dirname, "assets");
const EMU_DIR = path.join(ASSETS_DIR, "emulators");
const JSDOS_VERSION = "8.3.20";

// Files copied verbatim out of the js-dos npm package's dist/ folder.
const JSDOS_FILES = [
  ["dist/js-dos.js", "js-dos.js"],
  ["dist/js-dos.css", "js-dos.css"],
  ["dist/emulators/emulators.js", "emulators/emulators.js"],
  ["dist/emulators/wdosbox.js", "emulators/wdosbox.js"],
  ["dist/emulators/wdosbox.wasm", "emulators/wdosbox.wasm"],
  ["dist/emulators/wlibzip.js", "emulators/wlibzip.js"],
  ["dist/emulators/wlibzip.wasm", "emulators/wlibzip.wasm"],
];

const DOWNLOADS = [
  {
    name: "DOOM Shareware bundle",
    url: "https://cdn.dos.zone/custom/dos/doom.jsdos",
    dest: "doom.jsdos",
  },
];

function fetchJsDosFromNpm() {
  const have = JSDOS_FILES.every(([, dst]) => fs.existsSync(path.join(ASSETS_DIR, dst)));
  if (have) {
    console.log(`  js-dos ${JSDOS_VERSION} runtime + emulators: already present — skipping`);
    return;
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "jsdos-"));
  console.log(`  js-dos ${JSDOS_VERSION}: npm pack...`);
  const tgz = execFileSync("npm", ["pack", `js-dos@${JSDOS_VERSION}`, "--pack-destination", tmp], {
    encoding: "utf8",
    shell: true, // npm is npm.cmd on Windows; shell true lets the OS resolve it
  }).trim().split("\n").pop().trim();
  // Use cwd + relative filename so Windows tar doesn't misread "C:" as a hostname.
  execFileSync("tar", ["xzf", tgz, "-C", "."], { cwd: tmp });
  fs.mkdirSync(EMU_DIR, { recursive: true });
  for (const [src, dst] of JSDOS_FILES) {
    fs.copyFileSync(path.join(tmp, "package", src), path.join(ASSETS_DIR, dst));
  }
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`  js-dos ${JSDOS_VERSION} runtime + emulators: ✓`);
}

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

  try {
    fetchJsDosFromNpm();
  } catch (err) {
    console.error(`\n  ✗ Failed to fetch js-dos from npm: ${err.message}`);
    process.exit(1);
  }

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

  console.log("\n✅ All assets ready. Run: npm run package\n");
}

main();

import * as esbuild from "esbuild";
import * as fs from "node:fs";
import * as path from "node:path";

const manifest = JSON.parse(fs.readFileSync("manifest.json", "utf8"));
const production = process.argv.includes("--production");

// Step 1: build the dialog as an in-memory browser IIFE bundle and inline it into the HTML shell
const dialogResult = await esbuild.build({
  entryPoints: ["dialog/main.ts"],
  bundle: true,
  format: "iife",
  minify: production,
  sourcemap: false,
  platform: "browser",
  write: false,
  logLevel: "warning",
});
const dialogJs = dialogResult.outputFiles[0].text;
let dialogHtml = fs.readFileSync(path.join("dialog", "index.html"), "utf8");
dialogHtml = dialogHtml.replace("<!--__DIALOG_SCRIPT__-->", `<script>${dialogJs}</script>`);
fs.mkdirSync("src", { recursive: true });
fs.writeFileSync(path.join("src", "dialog-compiled.html"), dialogHtml);

// Step 2: bundle the extension host (CJS / Node)
await esbuild.build({
  entryPoints: ["src/extension.ts"],
  outfile: manifest.entry,
  bundle: true,
  format: "cjs",
  platform: "node",
  sourcesContent: false,
  logLevel: "info",
  minify: production,
  sourcemap: !production,
  loader: { ".html": "text" },
});

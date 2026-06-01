import * as esbuild from "esbuild";
import * as fs from "node:fs";
import * as path from "node:path";

const manifest = JSON.parse(fs.readFileSync("manifest.json", "utf8"));
const production = process.argv.includes("--production");

// The extension ships fully offline: every runtime asset (the HTML page,
// js-dos.js, js-dos.css, the DOOM .jsdos bundle, and the wdosbox/wlibzip
// emulator cores) is bundled into dist/extension.js. At launch the extension
// writes them to a temp folder and opens the page via a file:// URL.
//
// esbuild bundles .js files as code, but we need the *verbatim* source of the
// emulator JS files to write back to disk. So we copy them to .txt and import
// them with the "text" loader.
const embedDir = "assets/embed";
fs.mkdirSync(embedDir, { recursive: true });
const jsEmbeds: Array<[string, string]> = [
  ["assets/js-dos.js", "js-dos.txt"],
  ["assets/emulators/emulators.js", "emulators.txt"],
  ["assets/emulators/wdosbox.js", "wdosbox.txt"],
  ["assets/emulators/wlibzip.js", "wlibzip.txt"],
];
for (const [src, dst] of jsEmbeds) {
  fs.copyFileSync(src, path.join(embedDir, dst));
}

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
  loader: {
    ".html": "text", // HTML page template -> string
    ".css": "text", // js-dos.css -> string
    ".txt": "text", // emulator JS sources -> string
    // base64 strings (decoded with Buffer.from at runtime). NOT "binary":
    // esbuild's binary loader emits Uint8Array.fromBase64(), which is absent
    // in Live's extension-host Node and would crash on load.
    ".wasm": "base64", // wdosbox/wlibzip wasm -> base64 string
    ".jsdos": "base64", // DOOM bundle -> base64 string
  },
});

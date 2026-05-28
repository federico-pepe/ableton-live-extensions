/**
 * esbuild.js — Build script for the Doom extension.
 *
 * Includes an inlining plugin that:
 *   1. Reads assets/js-dos.js and base64-encodes it for inline <script> injection
 *   2. Reads assets/doom.jsdos and base64-encodes it for Blob URL injection
 *   3. Replaces placeholder tokens in doom.html before bundling
 *
 * Prerequisites: run `node setup.js` once to download assets.
 */

const esbuild = require("esbuild");
const fs = require("fs");
const path = require("path");

const production = process.argv.includes("--production");
const watch = process.argv.includes("--watch");

const ASSETS_DIR = path.join(__dirname, "assets");

/** esbuild plugin: inline js-dos.js and doom.jsdos into the HTML at build time */
const inlineDoomAssetsPlugin = {
  name: "inline-doom-assets",
  setup(build) {
    build.onLoad({ filter: /doom\.html$/ }, (args) => {
      // Verify assets are present
      const jsdosPath = path.join(ASSETS_DIR, "js-dos.js");
      const bundlePath = path.join(ASSETS_DIR, "doom.jsdos");

      if (!fs.existsSync(jsdosPath)) {
        return {
          errors: [{
            text: `Missing asset: assets/js-dos.js\nRun "node setup.js" first to download required assets.`,
          }],
        };
      }
      if (!fs.existsSync(bundlePath)) {
        return {
          errors: [{
            text: `Missing asset: assets/doom.jsdos\nRun "node setup.js" first to download required assets.`,
          }],
        };
      }

      let html = fs.readFileSync(args.path, "utf8");

      // 1. Inline the js-dos runtime as a <script> block.
      //    We read it as text and inject directly — no base64 round-trip needed for JS.
      const jsdosSource = fs.readFileSync(jsdosPath, "utf8");
      const inlineScript = `<script>\n${jsdosSource}\n</script>`;
      html = html.replace("<!-- __JSDOS_SCRIPT_PLACEHOLDER__ -->", inlineScript);

      // 2. Base64-encode the .jsdos bundle and inject as a JS constant.
      //    At runtime this gets decoded into a Uint8Array and passed to Dos() as a bundle.
      const bundleB64 = fs.readFileSync(bundlePath).toString("base64");
      const bundleKb = Math.round(fs.statSync(bundlePath).size / 1024);
      console.log(`[inline-doom] js-dos.js: ${Math.round(fs.statSync(jsdosPath).size / 1024)} KB`);
      console.log(`[inline-doom] doom.jsdos: ${bundleKb} KB → base64 injected`);

      // Inject as a const the runtime JS will reference
      const bundleScript = `<script>\nconst __DOOM_BUNDLE_B64__ = "${bundleB64}";\n</script>`;
      html = html.replace("<!-- __DOOM_BUNDLE_PLACEHOLDER__ -->", bundleScript);

      return { contents: html, loader: "text" };
    });
  },
};

async function main() {
  const ctx = await esbuild.context({
    entryPoints: ["src/extension.ts"],
    bundle: true,
    format: "cjs",
    minify: production,
    sourcemap: !production,
    sourcesContent: false,
    platform: "node",
    outfile: "dist/extension.js",
    logLevel: "warning",
    loader: {
      ".html": "text",
    },
    plugins: [inlineDoomAssetsPlugin],
  });

  if (watch) {
    await ctx.watch();
    console.log("[esbuild] Watching for changes...");
  } else {
    await ctx.rebuild();
    await ctx.dispose();
    console.log("[esbuild] Build complete → dist/extension.js");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

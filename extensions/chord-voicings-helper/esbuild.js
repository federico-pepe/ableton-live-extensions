const esbuild = require("esbuild");
const fs = require("fs");
const path = require("path");

const production = process.argv.includes("--production");
const watch = process.argv.includes("--watch");

async function buildDialogHtml() {
  // Build dialog IIFE — get output as string (no write to disk)
  const result = await esbuild.build({
    entryPoints: ["dialog/main.ts"],
    bundle: true,
    format: "iife",
    minify: production,
    sourcemap: false,
    platform: "browser",
    write: false,
    logLevel: "warning",
  });

  const dialogJs = result.outputFiles[0].text;

  // Read the dialog HTML shell
  let html = fs.readFileSync(path.join("dialog", "index.html"), "utf8");

  // Inject the bundled script in place of the placeholder comment
  html = html.replace("<!--__DIALOG_SCRIPT__-->", `<script>${dialogJs}</script>`);

  // Write combined HTML to src/ so extension.ts can import it as text
  fs.mkdirSync("src", { recursive: true });
  fs.writeFileSync(path.join("src", "dialog-compiled.html"), html);
  console.log("[dialog] compiled HTML written to src/dialog-compiled.html");
}

async function main() {
  // Step 1: Build and inline the dialog
  await buildDialogHtml();

  // Step 2: Build extension host (CJS, Node.js)
  // dialog-compiled.html is imported as text via the .html loader
  const extensionCtx = await esbuild.context({
    entryPoints: ["src/extension.ts"],
    bundle: true,
    format: "cjs",
    minify: production,
    sourcemap: !production,
    sourcesContent: false,
    platform: "node",
    outfile: "dist/extension.js",
    loader: { ".html": "text" },
    logLevel: "warning",
    plugins: [esbuildProblemMatcherPlugin],
  });

  if (watch) {
    await extensionCtx.watch();
  } else {
    await extensionCtx.rebuild();
    await extensionCtx.dispose();
  }
}

const esbuildProblemMatcherPlugin = {
  name: "esbuild-problem-matcher",
  setup(build) {
    build.onStart(() => console.log("[extension] build started"));
    build.onEnd((result) => {
      result.errors.forEach(({ text, location }) => {
        console.error(`✘ [ERROR] ${text}`);
        if (location) {
          console.error(`    ${location.file}:${location.line}:${location.column}:`);
        }
      });
      console.log("[extension] build finished");
    });
  },
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

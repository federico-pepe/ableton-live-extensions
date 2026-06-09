import { initialize, type ActivationContext } from "@ableton-extensions/sdk";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as http from "node:http";

// Text assets (verbatim sources written back to disk at runtime).
import doomHtml from "./doom.html";
import jsDosJs from "../assets/embed/js-dos.txt";
import jsDosCss from "../assets/js-dos.css";
import emulatorsJs from "../assets/embed/emulators.txt";
import wdosboxJs from "../assets/embed/wdosbox.txt";
import wlibzipJs from "../assets/embed/wlibzip.txt";
// Binary assets (base64-encoded; decoded with Buffer.from at runtime).
import wdosboxWasm from "../assets/emulators/wdosbox.wasm";
import wlibzipWasm from "../assets/emulators/wlibzip.wasm";
import doomBundle from "../assets/doom.jsdos";

// Bump when any bundled asset changes so a fresh copy is written.
const RUNTIME_DIR = "ableton-doom-runtime=1";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".wasm": "application/wasm", // required for WebAssembly streaming compile
  ".jsdos": "application/octet-stream",
  ".json": "application/json",
};

/**
 * Writes the DOOM page and its js-dos runtime/emulator core into a temp
 * directory and returns that directory. Everything is local — at runtime the
 * directory is served over http://localhost, so js-dos loads its emulator core
 * (wdosbox/wlibzip) from "./emulators/" without any network access.
 *
 * js-dos.css and js-dos.js are inlined directly into doom.html rather than
 * served as separate files. Two Windows-specific issues make this necessary:
 *
 * 1. The replacement uses a function (not a string) because js-dos.js contains
 *    the literal text "$&" in its minified source. String.prototype.replace
 *    expands "$&" to the matched text, which would splice the search string
 *    back into the output and inject stray </script> tags.
 *
 * 2. The inlined script is wrapped in an IIFE. Ableton's WebView2 process
 *    exposes V8's gc() function as a page global (via --expose-gc), and
 *    js-dos.js declares a top-level `const gc`. Since const cannot redeclare
 *    an existing binding, this throws a SyntaxError before window.Dos is
 *    assigned. The IIFE gives js-dos its own scope, avoiding the conflict.
 */
function writeRuntime(baseDir: string): string {
  const dir = path.join(baseDir, RUNTIME_DIR);
  const emuDir = path.join(dir, "emulators");
  fs.mkdirSync(emuDir, { recursive: true });

  const inlinedHtml = doomHtml
    .replace(
      '<link rel="stylesheet" href="./js-dos.css">',
      () => `<style>\n${jsDosCss}\n</style>`
    )
    .replace(
      '<script src="./js-dos.js"></script>',
      () => `<script>\n(function(){\n${jsDosJs}\n})();\n</script>`
    );
  fs.writeFileSync(path.join(dir, "doom.html"), inlinedHtml);
  fs.writeFileSync(path.join(dir, "doom.jsdos"), Buffer.from(doomBundle, "base64"));

  fs.writeFileSync(path.join(emuDir, "emulators.js"), emulatorsJs);
  fs.writeFileSync(path.join(emuDir, "wdosbox.js"), wdosboxJs);
  fs.writeFileSync(path.join(emuDir, "wdosbox.wasm"), Buffer.from(wdosboxWasm, "base64"));
  fs.writeFileSync(path.join(emuDir, "wlibzip.js"), wlibzipJs);
  fs.writeFileSync(path.join(emuDir, "wlibzip.wasm"), Buffer.from(wlibzipWasm, "base64"));

  return dir;
}

// One static server per host process, reused across launches.
let serverBaseUrl: string | null = null;

/**
 * Serves `rootDir` over http://localhost on an ephemeral port. A localhost
 * server (rather than file://) is required because WKWebView blocks fetch/XHR
 * and Web Workers for file:// sub-resources — and js-dos loads its wasm core
 * exactly that way. The SDK explicitly allows the http://localhost scheme.
 *
 * We bind on both 127.0.0.1 (IPv4) and ::1 (IPv6) so the server is reachable
 * regardless of whether the platform resolves "localhost" to IPv4 or IPv6.
 * On Windows, WebView2 resolves localhost to ::1; binding only on 127.0.0.1
 * causes fetch() calls for .wasm and .jsdos files to fail there.
 */
function ensureServer(rootDir: string): Promise<string> {
  if (serverBaseUrl) return Promise.resolve(serverBaseUrl);
  const root = path.resolve(rootDir);

  const handler = (req: http.IncomingMessage, res: http.ServerResponse) => {
    const rawPath = decodeURIComponent((req.url || "/").split("?")[0]);
    const rel = rawPath === "/" ? "doom.html" : rawPath.replace(/^\/+/, "");
    const filePath = path.resolve(root, rel);
    // Path-traversal guard: never serve outside the runtime directory.
    if (filePath !== root && !filePath.startsWith(root + path.sep)) {
      res.statusCode = 403;
      res.end("Forbidden");
      return;
    }
    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.statusCode = 404;
        res.end("Not found");
        return;
      }
      res.setHeader("Content-Type", MIME[path.extname(filePath)] || "application/octet-stream");
      res.end(data);
    });
  };

  return new Promise((resolve, reject) => {
    const server4 = http.createServer(handler);
    server4.on("error", reject);
    server4.listen(0, "127.0.0.1", () => {
      const addr = server4.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      serverBaseUrl = `http://localhost:${port}`;
      // Also bind on IPv6 loopback for WebView2 on Windows (resolves localhost → ::1).
      // Silently ignore errors (e.g. IPv6 disabled) — IPv4 is sufficient on those hosts.
      const server6 = http.createServer(handler);
      server6.listen(port, "::1", () => resolve(serverBaseUrl!));
      server6.on("error", () => resolve(serverBaseUrl!));
    });
  });
}

export function activate(activation: ActivationContext) {
  const context = initialize(activation, "1.0.0");

  // Command: launch Doom dialog
  context.commands.registerCommand("doom.launch", async (_arg: unknown) => {
    try {
      const baseDir = context.environment.tempDirectory || os.tmpdir();
      const runtimeDir = writeRuntime(baseDir);
      const base = await ensureServer(runtimeDir);
      const url = `${base}/doom.html`;
      console.log(`[Doom] serving ${runtimeDir}`);
      console.log(`[Doom] loading ${url}`);
      // Large dialog to give Doom plenty of room (880x600)
      await context.ui.showModalDialog(url, 880, 600);
    } catch (err) {
      console.error("[Doom] Dialog error:", err);
    }
  });

  // Register on all track types and scene
  const scopes = ["AudioTrack", "MidiTrack", "Scene"] as const;

  for (const scope of scopes) {
    context.ui.registerContextMenuAction(scope, "Play Doom 🔫", "doom.launch");
  }

  console.log("[Doom] Extension activated — right-click a track or scene to launch DOOM!");
}

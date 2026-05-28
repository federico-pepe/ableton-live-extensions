import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import * as https from "https";
import { createWriteStream } from "fs";
import {
  initialize,
  AudioTrack,
  ClipSlot,
  type ActivationContext,
  type Handle,
} from "@ableton/extensions-sdk";
import dialogHtml from "./dialog.html";

// ── Types ─────────────────────────────────────────────────────────────────────

type ExtensionContext = ReturnType<typeof initialize<"1.0.0">>;
type UpdateFn = (text: string, progress: number) => Promise<void>;

interface DialogResult {
  previewUrl: string;
  name: string;
  username: string;
  id: number;
  duration: number;
  license: string;
  _apiKey: string;
}

interface ArrangementSelectionArg {
  time_selection_start: number;
  time_selection_end: number;
  selected_lanes: Handle[];
}

function isArrangementSelection(arg: unknown): arg is ArrangementSelectionArg {
  return (
    typeof arg === "object" &&
    arg !== null &&
    "selected_lanes" in arg &&
    Array.isArray((arg as ArrangementSelectionArg).selected_lanes)
  );
}

// ── API key persistence ───────────────────────────────────────────────────────

function apiKeyFilePath(storageDir: string): string {
  return path.join(storageDir, "freesound-api-key.json");
}

async function loadSavedApiKey(
  storageDir: string | undefined,
): Promise<string> {
  if (!storageDir) return "";
  try {
    const raw = await fs.readFile(apiKeyFilePath(storageDir), "utf8");
    const parsed = JSON.parse(raw) as { apiKey?: string };
    return parsed.apiKey ?? "";
  } catch {
    return "";
  }
}

async function saveApiKey(
  storageDir: string | undefined,
  apiKey: string,
): Promise<void> {
  if (!storageDir) return;
  await fs.mkdir(storageDir, { recursive: true });
  await fs.writeFile(
    apiKeyFilePath(storageDir),
    JSON.stringify({ apiKey }),
    "utf8",
  );
}

// ── Filename sanitization ─────────────────────────────────────────────────────

function sanitizeFilename(input: string, maxLength = 80): string {
  return (
    input
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
      .replace(/\s+/g, "_")
      .replace(/_+/g, "_")
      .replace(/^[._]+|[._]+$/g, "")
      .slice(0, maxLength) || "download"
  );
}

// ── Reuse check ───────────────────────────────────────────────────────────────

async function findExistingDownload(
  dir: string,
  baseName: string,
): Promise<string | null> {
  try {
    const entries = await fs.readdir(dir);
    const match = entries.find((e) => e.startsWith(baseName + "."));
    return match ? path.join(dir, match) : null;
  } catch {
    return null;
  }
}

// ── HTTPS download with AbortSignal ───────────────────────────────────────────

async function downloadFile(
  url: string,
  dest: string,
  signal: AbortSignal,
): Promise<void> {
  await fs.mkdir(path.dirname(dest), { recursive: true });

  return new Promise<void>((resolve, reject) => {
    const file = createWriteStream(dest);

    const req = https.get(url, (res) => {
      if (res.statusCode !== 200) {
        file.destroy();
        reject(new Error(`HTTP ${res.statusCode} from Freesound`));
        return;
      }
      res.pipe(file);
      file.on("finish", () => file.close(() => resolve()));
      file.on("error", reject);
    });

    req.on("error", reject);

    const abortHandler = () => {
      req.destroy();
      file.destroy();
      reject(new DOMException("AbortError", "AbortError"));
    };
    signal.addEventListener("abort", abortHandler, { once: true });
  });
}

// ── Clip placement ────────────────────────────────────────────────────────────

function findFirstEmptySlot(track: AudioTrack<"1.0.0">): ClipSlot<"1.0.0"> | null {
  return track.clipSlots.find((s) => s.clip === null) ?? null;
}

function findArrangementEnd(track: AudioTrack<"1.0.0">): number {
  const clips = track.arrangementClips;
  if (clips.length === 0) return 0;
  return Math.max(...clips.map((c) => c.endTime));
}

// ── Error dialog HTML ─────────────────────────────────────────────────────────

function makeErrorHtml(message: string): string {
  const escaped = message
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <script>
    function closeDialog() {
      const msg = { method: "close_and_send", params: [JSON.stringify(null)] };
      if (window.webkit?.messageHandlers?.live) {
        window.webkit.messageHandlers.live.postMessage(msg);
      } else if (window.chrome?.webview) {
        window.chrome.webview.postMessage(msg);
      }
    }
  </script>
  <style>
    :root { --panel: #4E4E4E; --accent: #FFA500; --text: #FFF; }
    html, body { background: var(--panel); font-family: 'Lucida Grande', sans-serif;
      color: var(--text); margin: 0; height: 100vh; display: flex;
      flex-direction: column; justify-content: center; align-items: center; }
    .content { padding: 20px; max-width: 440px; }
    p { font-size: 12px; margin: 0 0 16px; line-height: 1.6; white-space: pre-wrap; }
    .row { display: flex; justify-content: flex-end; }
    button { font-family: inherit; font-size: 12px; background: var(--accent);
      color: #000; border: none; border-radius: 2px; padding: 6px 14px; cursor: pointer; }
    button:hover { opacity: 0.85; }
  </style>
</head>
<body>
  <div class="content">
    <p>${escaped}</p>
    <div class="row"><button onclick="closeDialog()">OK</button></div>
  </div>
</body>
</html>`;
}

// ── Extension entry point ─────────────────────────────────────────────────────

export async function activate(activation: ActivationContext) {
  const context: ExtensionContext = initialize(activation, "1.0.0");

  for (const scope of ["AudioTrack", "AudioTrack.ArrangementSelection"] as const) {
    context.ui.registerContextMenuAction(scope, "Find samples", "freesound.open");
  }

  context.commands.registerCommand(
    "freesound.open",
    async (arg: unknown) => {
      console.log("[freesound-sampler] Command triggered, arg:", arg);

      let track: AudioTrack<"1.0.0">;
      let arrangementStartTime: number | null = null;

      if (isArrangementSelection(arg)) {
        // Triggered from Arrangement View
        const sel = arg;
        if (!sel.selected_lanes || sel.selected_lanes.length === 0) {
          const errDialog = context.createModalDialog();
          try {
            await errDialog.show(
              `data:text/html,${encodeURIComponent(makeErrorHtml("No track selected in Arrangement View."))}`,
              480, 200,
            );
          } catch { /* dismissed */ }
          return;
        }
        try {
          track = context.objects.getObjectFromHandle(sel.selected_lanes[0], AudioTrack);
          arrangementStartTime = sel.time_selection_start;
          console.log("[freesound-sampler] Arrangement view: track=%s, startTime=%s", track.name, arrangementStartTime);
        } catch (err) {
          console.error("[freesound-sampler] Failed to get AudioTrack from ArrangementSelection:", err);
          const errDialog = context.createModalDialog();
          try {
            await errDialog.show(
              `data:text/html,${encodeURIComponent(makeErrorHtml("Could not resolve track. Make sure you right-clicked an Audio Track lane."))}`,
              480, 200,
            );
          } catch { /* dismissed */ }
          return;
        }
      } else {
        // Triggered from Session View — arg is a Handle to the track
        try {
          track = context.objects.getObjectFromHandle(arg as Handle, AudioTrack);
          console.log("[freesound-sampler] Session view: track=%s", track.name);
        } catch (err) {
          console.error("[freesound-sampler] Failed to get AudioTrack:", err);
          const errDialog = context.createModalDialog();
          try {
            await errDialog.show(
              `data:text/html,${encodeURIComponent(makeErrorHtml("Error: Invalid track reference. Make sure you right-clicked an Audio Track.\n\nDetails: " + String(err instanceof Error ? err.message : err)))}`,
              500, 240,
            );
          } catch { /* dismissed */ }
          return;
        }
      }

      const storageDir = context.environment.storageDirectory;
      const soundsDir = storageDir
        ? path.join(storageDir, "sounds")
        : path.join(os.homedir(), ".freesound-sampler", "sounds");

      console.log("[freesound-sampler] Storage dir:", storageDir);
      console.log("[freesound-sampler] Sounds dir:", soundsDir);

      // Load and inject saved API key into dialog
      const savedApiKey = await loadSavedApiKey(storageDir);
      console.log("[freesound-sampler] Loaded API key:", savedApiKey ? savedApiKey.substring(0, 5) + "..." : "NONE");
      const initData = { savedApiKey };
      const initScript = `<script>window.INITIAL_DATA=${JSON.stringify(initData).replace(/<\/script>/gi, "<\\/script>")};<\/script>`;
      const html = dialogHtml.replace("</head>", initScript + "</head>");

      // Show search/results dialog
      const dialog = context.createModalDialog();
      let raw: string;
      try {
        console.log("[freesound-sampler] Opening dialog...");
        raw = await dialog.show(
          `data:text/html,${encodeURIComponent(html)}`,
          560,
          410,
        );
        console.log("[freesound-sampler] Dialog closed, result:", raw.substring(0, 100));
      } catch (err) {
        console.log("[freesound-sampler] Dialog dismissed or error:", err);
        return;
      }

      let result: DialogResult | null;
      try {
        result = JSON.parse(raw) as DialogResult | null;
        console.log("[freesound-sampler] Parsed result:", result);
      } catch (err) {
        console.error("[freesound-sampler] Failed to parse result:", err);
        return;
      }
      if (!result) {
        console.log("[freesound-sampler] Result is null, exiting");
        return;
      }

      // Persist API key (empty string clears it)
      console.log("[freesound-sampler] Saving API key and downloading...");
      await saveApiKey(storageDir, result._apiKey);

      // Download and create clip
      try {
        console.log("[freesound-sampler] Starting progress dialog for:", result!.name);
        await context.withinProgressDialog(
          "Freesound Sampler",
          { progress: 0 },
          async (update, signal) => {
            signal.throwIfAborted();
            await update("Downloading audio…", 10);

            const baseName = sanitizeFilename(result!.name);
            console.log("[freesound-sampler] Base name:", baseName);
            console.log("[freesound-sampler] Preview URL:", result!.previewUrl);

            // Reuse an already-downloaded file if present
            const existing = await findExistingDownload(soundsDir, baseName);
            if (existing) {
              console.log("[freesound-sampler] File already exists:", existing);
              await update("File already downloaded, reusing…", 50);
              signal.throwIfAborted();
            } else {
              console.log("[freesound-sampler] Downloading to:", path.join(soundsDir, baseName + ".mp3"));
              signal.throwIfAborted();
              await downloadFile(result!.previewUrl, path.join(soundsDir, baseName + ".mp3"), signal);
              await update("Download complete…", 50);
            }

            signal.throwIfAborted();
            await update("Creating audio clip…", 90);

            const filePath = existing ?? path.join(soundsDir, baseName + ".mp3");
            console.log("[freesound-sampler] Creating clip from:", filePath);
            let clip;
            if (arrangementStartTime !== null) {
              // Arrangement view: place at the time selection start
              clip = await context.withinTransaction(() =>
                track.createAudioClip(filePath, arrangementStartTime!, undefined, true),
              );
            } else {
              // Session view: prefer empty slot, fallback to arrangement end
              const emptySlot = findFirstEmptySlot(track);
              clip = emptySlot
                ? await context.withinTransaction(() =>
                    emptySlot.createAudioClip(filePath, true),
                  )
                : await context.withinTransaction(() =>
                    track.createAudioClip(
                      filePath,
                      findArrangementEnd(track),
                      undefined,
                      true,
                    ),
                  );
            }

            console.log("[freesound-sampler] Clip created:", clip.name);
            context.withinTransaction(() => {
              clip.name = result!.name.slice(0, 64);
            });

            await update("Done!", 100);
            console.log("[freesound-sampler] Success!");
          },
        );
      } catch (err) {
        if ((err as Error)?.name === "AbortError") {
          console.log("[freesound-sampler] User cancelled");
          return;
        }
        console.error("[freesound-sampler] Error:", err);
        const errDialog = context.createModalDialog();
        try {
          await errDialog.show(
            `data:text/html,${encodeURIComponent(makeErrorHtml(String(err instanceof Error ? err.message : err)))}`,
            480,
            220,
          );
        } catch {
          // dialog dismissed
        }
      }
    },
  );
}

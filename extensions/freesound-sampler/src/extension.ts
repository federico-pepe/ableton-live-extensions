import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import * as https from "https";
import * as crypto from "crypto";
import { createWriteStream } from "fs";
import {
  initialize,
  AudioTrack,
  ClipSlot,
  type ActivationContext,
  type Handle,
} from "@ableton-extensions/sdk";
import dialogHtml from "./dialog.html";

// ── Types ─────────────────────────────────────────────────────────────────────

type ExtensionContext = ReturnType<typeof initialize<"1.0.0">>;

// Dialog results are a discriminated union on _action.
type DialogResult =
  | { _action: "oauth_start" }
  | { _action: "oauth_logout" }
  | {
      _action?: never;
      previewUrl: string;
      name: string;
      username: string;
      id: number;
      duration: number;
      license: string;
      licenseShort: string;
      soundPageUrl: string;
      type: string;
      _apiKey: string;
    };

interface FreesoundTokens {
  access_token: string;
  refresh_token: string;
  expires_at: number; // ms timestamp
}

interface ImportRecord {
  id: number;
  name: string;
  username: string;
  license: string;
  soundPageUrl: string;
  trackName: string;
  sessionId: string;
  importedAt: string;
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

// ── OAuth constants ────────────────────────────────────────────────────────────
// TODO: Replace with the client_id from your registered Public Freesound app.
// Register at https://freesound.org/apiv2/apply/ — select "Public" client type.
const FREESOUND_CLIENT_ID = "B0nHWr4cwLk9DgLDhTHx";
const FREESOUND_AUTH_URL = "https://freesound.org/apiv2/oauth2/authorize/";
// OOB callback: Freesound's built-in page that displays the authorization code.
// Must use https://www — the Live webview blocks http:// navigations.
const FREESOUND_REDIRECT_URI =
  "https://www.freesound.org/home/app_permissions/permission_granted/";

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

// ── OAuth token persistence ───────────────────────────────────────────────────

function tokensFilePath(storageDir: string): string {
  return path.join(storageDir, "freesound-tokens.json");
}

async function loadSavedTokens(
  storageDir: string | undefined,
): Promise<FreesoundTokens | null> {
  if (!storageDir) return null;
  try {
    const raw = await fs.readFile(tokensFilePath(storageDir), "utf8");
    return JSON.parse(raw) as FreesoundTokens;
  } catch {
    return null;
  }
}

async function saveTokens(
  storageDir: string | undefined,
  tokens: FreesoundTokens,
): Promise<void> {
  if (!storageDir) return;
  await fs.mkdir(storageDir, { recursive: true });
  await fs.writeFile(tokensFilePath(storageDir), JSON.stringify(tokens), "utf8");
}

async function clearTokens(storageDir: string | undefined): Promise<void> {
  if (!storageDir) return;
  try {
    await fs.unlink(tokensFilePath(storageDir));
  } catch { /* already absent */ }
}

// ── Import ledger persistence ───────────────────────────────────────────────

function importsFilePath(storageDir: string): string {
  return path.join(storageDir, "freesound-imports.json");
}

async function loadImports(
  storageDir: string | undefined,
): Promise<ImportRecord[]> {
  if (!storageDir) return [];
  try {
    const raw = await fs.readFile(importsFilePath(storageDir), "utf8");
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as ImportRecord[]) : [];
  } catch {
    return [];
  }
}

async function appendImport(
  storageDir: string | undefined,
  record: ImportRecord,
): Promise<void> {
  if (!storageDir) return;
  const existing = await loadImports(storageDir);
  // Avoid duplicate entries for the same sound within the same session.
  const isDup = existing.some(
    (e) => e.id === record.id && e.sessionId === record.sessionId,
  );
  if (isDup) return;
  existing.push(record);
  await fs.mkdir(storageDir, { recursive: true });
  await fs.writeFile(
    importsFilePath(storageDir),
    JSON.stringify(existing, null, 2),
    "utf8",
  );
}

// ── PKCE helpers ──────────────────────────────────────────────────────────────

function generateCodeVerifier(): string {
  return crypto.randomBytes(48).toString("base64url");
}

function generateCodeChallenge(verifier: string): string {
  return crypto.createHash("sha256").update(verifier).digest("base64url");
}

function generateState(): string {
  return crypto.randomBytes(16).toString("base64url");
}

// ── OAuth token exchange + refresh ────────────────────────────────────────────

function httpsPost(body: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const req = https.request(
      {
        hostname: "freesound.org",
        path: "/apiv2/oauth2/access_token/",
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk: string) => { data += chunk; });
        res.on("end", () => resolve(data));
        res.on("error", reject);
      },
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

async function exchangeCode(
  code: string,
  verifier: string,
): Promise<FreesoundTokens> {
  const body =
    "grant_type=authorization_code" +
    "&code=" + encodeURIComponent(code) +
    "&client_id=" + encodeURIComponent(FREESOUND_CLIENT_ID) +
    "&redirect_uri=" + encodeURIComponent(FREESOUND_REDIRECT_URI) +
    "&code_verifier=" + encodeURIComponent(verifier);

  const raw = await httpsPost(body);
  const parsed = JSON.parse(raw) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  };
  if (!parsed.access_token) {
    throw new Error(parsed.error_description ?? parsed.error ?? `Token exchange failed: ${raw}`);
  }
  return {
    access_token: parsed.access_token,
    refresh_token: parsed.refresh_token ?? "",
    expires_at: Date.now() + (parsed.expires_in ?? 86400) * 1000,
  };
}

async function refreshAccessToken(
  refreshToken: string,
): Promise<FreesoundTokens> {
  const body =
    "grant_type=refresh_token" +
    "&refresh_token=" + encodeURIComponent(refreshToken) +
    "&client_id=" + encodeURIComponent(FREESOUND_CLIENT_ID);

  const raw = await httpsPost(body);
  const parsed = JSON.parse(raw) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  };
  if (!parsed.access_token) {
    throw new Error(parsed.error_description ?? parsed.error ?? `Token refresh failed: ${raw}`);
  }
  return {
    access_token: parsed.access_token,
    refresh_token: parsed.refresh_token ?? refreshToken,
    expires_at: Date.now() + (parsed.expires_in ?? 86400) * 1000,
  };
}

// Returns a valid access token, refreshing if needed, or null if refresh fails.
async function getValidAccessToken(
  storageDir: string | undefined,
  tokens: FreesoundTokens,
): Promise<string | null> {
  if (tokens.expires_at > Date.now() + 60_000) {
    return tokens.access_token;
  }
  try {
    const refreshed = await refreshAccessToken(tokens.refresh_token);
    await saveTokens(storageDir, refreshed);
    return refreshed.access_token;
  } catch {
    return null;
  }
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
  soundId: number,
): Promise<string | null> {
  try {
    const entries = await fs.readdir(dir);
    // Files are named `<name>_FS<id>.<ext>`, so match on the stable ID token.
    const token = `_FS${soundId}.`;
    const match = entries.find((e) => e.includes(token));
    return match ? path.join(dir, match) : null;
  } catch {
    return null;
  }
}

// ── HTTPS download with AbortSignal ───────────────────────────────────────────
// Follows redirects (Freesound's download endpoint may redirect to a CDN URL).
// Strips auth header on redirect so it is not forwarded to the CDN.

async function downloadFile(
  url: string,
  dest: string,
  signal: AbortSignal,
  authHeader?: string,
): Promise<void> {
  await fs.mkdir(path.dirname(dest), { recursive: true });

  // Resolve redirects before streaming to a file.
  const makeRequest = (
    reqUrl: string,
    headers: Record<string, string>,
  ): Promise<import("http").IncomingMessage> =>
    new Promise((resolve, reject) => {
      const req = https.get(reqUrl, { headers }, resolve);
      req.on("error", reject);
      signal.addEventListener("abort", () => req.destroy(), { once: true });
    });

  let targetUrl = url;
  let reqHeaders: Record<string, string> = authHeader
    ? { Authorization: authHeader }
    : {};

  for (let hop = 0; hop < 5; hop++) {
    const res = await makeRequest(targetUrl, reqHeaders);

    if (
      (res.statusCode === 301 ||
        res.statusCode === 302 ||
        res.statusCode === 307) &&
      res.headers.location
    ) {
      res.resume(); // drain + discard
      const loc = res.headers.location;
      // Redirect URLs from Freesound/CDN are always absolute.
      targetUrl = loc;
      reqHeaders = {}; // don't forward auth to CDN
      continue;
    }

    if (res.statusCode !== 200) {
      res.resume();
      if (res.statusCode === 401) {
        throw Object.assign(
          new Error(
            "Freesound login expired. Please log out and log in again.",
          ),
          { code: "AUTH_EXPIRED" },
        );
      }
      throw new Error(`HTTP ${res.statusCode} from Freesound`);
    }

    // Stream the 200 response to disk.
    return new Promise<void>((resolve, reject) => {
      const file = createWriteStream(dest);
      res.pipe(file);
      file.on("finish", () => file.close(() => resolve()));
      file.on("error", reject);
      res.on("error", reject);
      signal.addEventListener(
        "abort",
        () => {
          res.destroy();
          file.destroy();
          reject(new DOMException("AbortError", "AbortError"));
        },
        { once: true },
      );
    });
  }

  throw new Error("Too many redirects from Freesound");
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
  <\/script>
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

// ── OAuth paste-code dialog HTML ──────────────────────────────────────────────

function makePasteCodeHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <style>
    @font-face {
      font-family: "AbletonSansSmall";
      font-weight: 400;
      src: url("/Applications/Ableton Live 12.4 Alpha.app/Contents/App-Resources/Fonts/AbletonSansSmall-Regular.ttf") format("truetype");
    }
    :root {
      --bg: #ffffff; --accent: #ff3546; --text: #141424;
      --border: #dcdce6; --text-dim: #8a8a9c; --raised: #f4f4fa;
    }
    html, body {
      background: var(--bg);
      font-family: "AbletonSansSmall", "Lucida Grande", sans-serif;
      color: var(--text); margin: 0; height: 100vh;
      display: flex; flex-direction: column;
      justify-content: center; align-items: center;
      padding: 24px; box-sizing: border-box; font-size: 11.5px;
    }
    .wrap { width: 100%; max-width: 400px; }
    h2 { font-size: 13px; margin: 0 0 6px; font-weight: 700; }
    p { font-size: 11px; color: var(--text-dim); margin: 0 0 14px; line-height: 1.6; }
    input {
      width: 100%; border: 1px solid var(--border); border-radius: 3px;
      padding: 8px 10px; font-family: inherit; font-size: 11px;
      color: var(--text); background: var(--raised);
      box-sizing: border-box; outline: none;
    }
    input:focus { border-color: var(--accent); }
    .row { display: flex; gap: 8px; margin-top: 12px; justify-content: flex-end; }
    button {
      font-family: inherit; font-size: 11px; border-radius: 2px;
      border: none; padding: 6px 14px; cursor: pointer;
    }
    .primary { background: var(--accent); color: #fff; }
    .secondary { background: var(--border); color: var(--text); }
    .err { font-size: 10.5px; margin-top: 8px; color: var(--accent); min-height: 14px; }
  </style>
</head>
<body>
  <div class="wrap">
    <h2>Paste your authorization code</h2>
    <p>
      After granting access on Freesound, copy the authorization code shown on the page
      and paste it below to complete login.
    </p>
    <input
      type="text" id="code-input"
      placeholder="Authorization code"
      autocomplete="off" spellcheck="false"
    />
    <div id="err" class="err"></div>
    <div class="row">
      <button class="secondary" onclick="doCancel()">Cancel</button>
      <button class="primary" onclick="doConnect()">Connect</button>
    </div>
  </div>
  <script>
    function postMsg(value) {
      var msg = { method: "close_and_send", params: [JSON.stringify(value)] };
      if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.live) {
        window.webkit.messageHandlers.live.postMessage(msg);
      } else if (window.chrome && window.chrome.webview) {
        window.chrome.webview.postMessage(msg);
      }
    }
    function doCancel() { postMsg(null); }
    function doConnect() {
      var code = document.getElementById("code-input").value.trim();
      if (!code) {
        document.getElementById("err").textContent = "Please paste your authorization code.";
        return;
      }
      postMsg({ code: code });
    }
    document.getElementById("code-input").focus();
    document.addEventListener("keydown", function(e) {
      if (e.key === "Enter") doConnect();
      if (e.key === "Escape") doCancel();
    });
  <\/script>
</body>
</html>`;
}

// ── OAuth login flow ──────────────────────────────────────────────────────────

async function runOAuthFlow(
  context: ExtensionContext,
  storageDir: string | undefined,
): Promise<boolean> {
  const verifier = generateCodeVerifier();
  const challenge = generateCodeChallenge(verifier);
  const state = generateState();

  const authUrl =
    FREESOUND_AUTH_URL +
    "?response_type=code" +
    "&client_id=" + encodeURIComponent(FREESOUND_CLIENT_ID) +
    "&redirect_uri=" + encodeURIComponent(FREESOUND_REDIRECT_URI) +
    "&code_challenge=" + encodeURIComponent(challenge) +
    "&code_challenge_method=S256" +
    "&state=" + encodeURIComponent(state) +
    "&scope=read";

  // Step 1: Show the Freesound authorization page in the modal. After the user
  // grants access, Freesound redirects to the OOB permission-granted page which
  // displays the authorization code. The user copies it and closes the modal.
  try {
    await context.ui.showModalDialog(authUrl.toString(), 640, 700);
  } catch {
    // Normal: the modal closes when the redirect lands on the permission page
    // (or the user cancels). Either way, proceed to the paste step.
  }

  // Step 2: Prompt the user to paste the code they just copied.
  let raw: string;
  try {
    raw = await context.ui.showModalDialog(
      `data:text/html,${encodeURIComponent(makePasteCodeHtml())}`,
      480,
      260,
    );
  } catch {
    return false;
  }

  let pasted: { code?: string } | null;
  try {
    pasted = JSON.parse(raw) as { code?: string } | null;
  } catch {
    return false;
  }
  if (!pasted?.code) return false;

  // Step 3: Exchange the authorization code for tokens (no client_secret needed).
  try {
    const tokens = await exchangeCode(pasted.code.trim(), verifier);
    await saveTokens(storageDir, tokens);
    console.log("[freesound-sampler] OAuth login successful");
    return true;
  } catch (err) {
    console.error("[freesound-sampler] Token exchange failed:", err);
    try {
      await context.ui.showModalDialog(
        `data:text/html,${encodeURIComponent(
          makeErrorHtml(
            "Login failed: " +
              String(err instanceof Error ? err.message : err),
          ),
        )}`,
        480,
        220,
      );
    } catch { /* dismissed */ }
    return false;
  }
}

// ── Extension entry point ─────────────────────────────────────────────────────

export async function activate(activation: ActivationContext) {
  const context: ExtensionContext = initialize(activation, "1.0.0");

  // One id per extension run — used to group imported sounds for attribution.
  const sessionId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

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
          try {
            await context.ui.showModalDialog(
              `data:text/html,${encodeURIComponent(makeErrorHtml("No track selected in Arrangement View."))}`,
              480, 200,
            );
          } catch { /* dismissed */ }
          return;
        }
        try {
          track = context.getObjectFromHandle(sel.selected_lanes[0], AudioTrack);
          arrangementStartTime = sel.time_selection_start;
          console.log("[freesound-sampler] Arrangement view: track=%s, startTime=%s", track.name, arrangementStartTime);
        } catch (err) {
          console.error("[freesound-sampler] Failed to get AudioTrack from ArrangementSelection:", err);
          try {
            await context.ui.showModalDialog(
              `data:text/html,${encodeURIComponent(makeErrorHtml("Could not resolve track. Make sure you right-clicked an Audio Track lane."))}`,
              480, 200,
            );
          } catch { /* dismissed */ }
          return;
        }
      } else {
        // Triggered from Session View — arg is a Handle to the track
        try {
          track = context.getObjectFromHandle(arg as Handle, AudioTrack);
          console.log("[freesound-sampler] Session view: track=%s", track.name);
        } catch (err) {
          console.error("[freesound-sampler] Failed to get AudioTrack:", err);
          try {
            await context.ui.showModalDialog(
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

      // Load saved OAuth tokens and refresh if they are near expiry.
      let savedTokens = await loadSavedTokens(storageDir);
      let accessToken: string | null = null;
      if (savedTokens) {
        accessToken = await getValidAccessToken(storageDir, savedTokens);
        if (!accessToken) {
          console.log("[freesound-sampler] Token refresh failed, clearing tokens");
          await clearTokens(storageDir);
        }
      }

      // ── Main dialog loop ──────────────────────────────────────────────────
      // Re-opens after OAuth login / logout actions; exits on cancel or import.
      while (true) {
        const savedApiKey = await loadSavedApiKey(storageDir);
        const imports = await loadImports(storageDir);
        const initData = {
          savedApiKey,
          imports,
          sessionId,
          loggedIn: !!accessToken,
          accessToken: accessToken ?? null,
        };
        const initScript = `<script>window.INITIAL_DATA=${JSON.stringify(initData).replace(/<\/script>/gi, "<\\/script>")};<\/script>`;
        const html = dialogHtml.replace("</head>", initScript + "</head>");

        let raw: string;
        try {
          console.log("[freesound-sampler] Opening dialog (loggedIn=%s)...", !!accessToken);
          raw = await context.ui.showModalDialog(
            `data:text/html,${encodeURIComponent(html)}`,
            640,
            620,
          );
          console.log("[freesound-sampler] Dialog closed, result:", raw.substring(0, 100));
        } catch (err) {
          console.log("[freesound-sampler] Dialog dismissed:", err);
          return;
        }

        let result: DialogResult | null;
        try {
          result = JSON.parse(raw) as DialogResult | null;
        } catch (err) {
          console.error("[freesound-sampler] Failed to parse result:", err);
          return;
        }
        if (!result) return;

        if (result._action === "oauth_start") {
          const success = await runOAuthFlow(context, storageDir);
          if (success) {
            const newTokens = await loadSavedTokens(storageDir);
            accessToken = newTokens?.access_token ?? null;
          }
          continue;
        }

        if (result._action === "oauth_logout") {
          await clearTokens(storageDir);
          accessToken = null;
          continue;
        }

        // Normal import — persist API key, download, create clip.
        await saveApiKey(storageDir, result._apiKey);

        try {
          console.log("[freesound-sampler] Starting progress dialog for:", result.name);
          await context.ui.withinProgressDialog(
            "Freesound Sampler",
            { progress: 0 },
            async (update, signal) => {
              signal.throwIfAborted();
              await update("Downloading audio…", 10);

              const isHQ = !!accessToken;
              // HQ: use the original format reported by the API; fallback is mp3.
              const fileExt = isHQ ? `.${result.type || "wav"}` : ".mp3";
              const baseName = `${sanitizeFilename(result.name)}_FS${result.id}`;
              console.log("[freesound-sampler] Download: HQ=%s ext=%s", isHQ, fileExt);

              const existing = await findExistingDownload(soundsDir, result.id);
              if (existing) {
                console.log("[freesound-sampler] Reusing existing file:", existing);
                await update("File already downloaded, reusing…", 50);
                signal.throwIfAborted();
              } else {
                const downloadUrl = isHQ
                  ? `https://freesound.org/apiv2/sounds/${result.id}/download/`
                  : result.previewUrl;
                const destPath = path.join(soundsDir, baseName + fileExt);
                console.log("[freesound-sampler] Downloading from:", downloadUrl);
                signal.throwIfAborted();
                await downloadFile(
                  downloadUrl,
                  destPath,
                  signal,
                  isHQ ? `Bearer ${accessToken}` : undefined,
                );
                await update("Download complete…", 50);
              }

              signal.throwIfAborted();
              await update("Creating audio clip…", 90);

              const filePath = existing ?? path.join(soundsDir, baseName + fileExt);
              console.log("[freesound-sampler] Creating clip from:", filePath);
              let clip;
              if (arrangementStartTime !== null) {
                clip = await context.withinTransaction(() =>
                  track.createAudioClip({ filePath, startTime: arrangementStartTime!, isWarped: true }),
                );
              } else {
                const emptySlot = findFirstEmptySlot(track);
                clip = emptySlot
                  ? await context.withinTransaction(() =>
                      emptySlot.createAudioClip({ filePath, isWarped: true }),
                    )
                  : await context.withinTransaction(() =>
                      track.createAudioClip({
                        filePath,
                        startTime: findArrangementEnd(track),
                        isWarped: true,
                      }),
                    );
              }

              console.log("[freesound-sampler] Clip created:", clip.name);
              const suffix = ` [FS#${result.id} · ${result.licenseShort}]`;
              const clipName = result.name.slice(0, 64 - suffix.length) + suffix;
              context.withinTransaction(() => { clip.name = clipName; });

              await appendImport(storageDir, {
                id: result.id,
                name: result.name,
                username: result.username,
                license: result.license,
                soundPageUrl: result.soundPageUrl,
                trackName: track.name,
                sessionId,
                importedAt: new Date().toISOString(),
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
          try {
            await context.ui.showModalDialog(
              `data:text/html,${encodeURIComponent(makeErrorHtml(String(err instanceof Error ? err.message : err)))}`,
              480,
              220,
            );
          } catch { /* dismissed */ }
        }

        return; // Exit the loop after a completed (or failed) import.
      }
    },
  );
}

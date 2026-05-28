import { applyVoicing, type VoicingStrategy, type Register } from "../src/voicingEngine";
import { bestMix } from "../src/voiceLeading";
import { pitchToName } from "../src/utils";
import { renderPiano } from "./piano";
import { renderNotation } from "./notation";

// ─── Cross-platform close ──────────────────────────────────────────────────────

declare global {
  interface Window {
    webkit?: { messageHandlers?: { live?: { postMessage: (msg: unknown) => void } } };
    chrome?: { webview?: { postMessage: (msg: unknown) => void } };
  }
}

function closeWithResult(result: unknown): void {
  const msg = { method: "close_and_send", params: [JSON.stringify(result)] };
  if (window.webkit?.messageHandlers?.live) {
    window.webkit.messageHandlers.live.postMessage(msg);
  } else if (window.chrome?.webview) {
    window.chrome.webview.postMessage(msg);
  }
}

// ─── Types ─────────────────────────────────────────────────────────────────────

interface ChordGroup {
  startTime: number;
  pitches: number[];
  noteIndices: number[];
  candidates: string[];
}

interface Payload {
  notes: unknown[];
  chordGroups: ChordGroup[];
}

declare const __PAYLOAD__: Payload | null;

type DialogStrategy = VoicingStrategy | "bestmix";

interface GroupState {
  candidateIndex: number;
  strategy: DialogStrategy;
  register: Register;
  cachedVoicing?: number[]; // pre-computed for bestmix sequential pass
}

// ─── State ─────────────────────────────────────────────────────────────────────

let payload: Payload = { notes: [], chordGroups: [] };
let focusedIndex = 0;
const checked = new Set<number>();
const groupStates: GroupState[] = [];

function state(i: number): GroupState {
  return groupStates[i]!;
}

function focusedChordName(): string {
  const g = payload.chordGroups[focusedIndex];
  const s = state(focusedIndex);
  if (!g || !s) return "";
  return g.candidates[s.candidateIndex] ?? "";
}

function computeVoicing(groupIndex: number): number[] {
  const g = payload.chordGroups[groupIndex];
  const s = state(groupIndex);
  if (!g || !s) return [];
  const chordName = g.candidates[s.candidateIndex] ?? "";
  if (!chordName) return [];
  if (s.strategy === "bestmix") return s.cachedVoicing ?? bestMix(g.pitches, chordName, s.register);
  return applyVoicing(s.strategy as VoicingStrategy, chordName, { register: s.register });
}

// ─── Beat formatting ───────────────────────────────────────────────────────────

function formatBeat(t: number): string {
  const bar  = Math.floor(t / 4) + 1;
  const beat = t % 4 + 1;
  return `${bar}.${Number.isInteger(beat) ? beat : beat.toFixed(1)}`;
}

// ─── Visualizations ────────────────────────────────────────────────────────────

function updateVisualizations(): void {
  const pitches = computeVoicing(focusedIndex);
  const chordName = focusedChordName();
  const s = state(focusedIndex);

  const footerEl = document.getElementById("footer-info")!;
  footerEl.textContent = pitches.length
    ? pitches.map(pitchToName).join("  ")
    : chordName ? "No voicing available" : "Select a chord group";

  const pianoContainer = document.getElementById("piano-container")!;
  renderPiano(pianoContainer, pitches);
  renderNotation(document.getElementById("notation-container")!, pitches);

  const pitchList = document.getElementById("pitch-list")!;
  pitchList.innerHTML = pitches
    .map((p) => `<div class="pitch-badge">${pitchToName(p)}</div>`)
    .join("") || `<span style="color:#888;font-size:11px;">${chordName || "—"}</span>`;

  const applyBtn = document.getElementById("btn-apply") as HTMLButtonElement;
  applyBtn.textContent = `Apply (${checked.size})`;
  applyBtn.disabled = checked.size === 0;

  if (s) {
    document.querySelectorAll<HTMLButtonElement>(".strategy-btn").forEach((b) =>
      b.classList.toggle("selected", b.dataset.strategy === s.strategy)
    );
    document.querySelectorAll<HTMLButtonElement>(".register-btn").forEach((b) =>
      b.classList.toggle("selected", b.dataset.register === s.register)
    );
  }
}

// ─── Candidates ────────────────────────────────────────────────────────────────

function updateCandidates(): void {
  const container = document.getElementById("candidates-area")!;
  container.innerHTML = "";
  const g = payload.chordGroups[focusedIndex];
  const s = state(focusedIndex);
  if (!g || !s) return;

  if (g.candidates.length === 0) {
    container.innerHTML = `<span class="no-candidates">Unrecognised</span>`;
    return;
  }
  g.candidates.forEach((c, i) => {
    const chip = document.createElement("div");
    chip.className = "chord-chip" + (i === s.candidateIndex ? " selected" : "");
    chip.textContent = c;
    chip.addEventListener("click", () => {
      s.candidateIndex = i;
      delete s.cachedVoicing; // invalidate bestmix cache
      updateCandidates();
      updateRowBadge(focusedIndex);
      updateVisualizations();
    });
    container.appendChild(chip);
  });
}

// ─── Groups list ───────────────────────────────────────────────────────────────

function strategyLabel(strat: DialogStrategy): string {
  const MAP: Record<string, string> = {
    close: "Close", open: "Open", shell: "Shell",
    drop2: "Drop 2", drop3: "Drop 3", guidetones: "Guide Tones", bestmix: "Best Mix",
  };
  return MAP[strat] ?? strat;
}

function updateRowBadge(i: number): void {
  const row = document.querySelector<HTMLElement>(`[data-group-index="${i}"]`);
  if (!row) return;
  const badge = row.querySelector<HTMLElement>(".group-strategy-badge");
  if (badge) badge.textContent = strategyLabel(state(i).strategy);

  const nameEl = row.querySelector<HTMLElement>(".group-chord");
  if (nameEl) {
    const g = payload.chordGroups[i]!;
    nameEl.textContent = g.candidates[state(i).candidateIndex] || "—";
  }
}

function updateAllRowClasses(): void {
  payload.chordGroups.forEach((_, i) => {
    const row = document.querySelector<HTMLElement>(`[data-group-index="${i}"]`);
    if (!row) return;
    row.classList.toggle("focused", i === focusedIndex);
    row.classList.toggle("checked", checked.has(i));
    const cb = row.querySelector<HTMLInputElement>("input[type=checkbox]");
    if (cb) cb.checked = checked.has(i);
  });
}

function initGroupsList(): void {
  const container = document.getElementById("groups-list")!;
  container.innerHTML = "";

  const sub = document.getElementById("header-sub")!;
  sub.textContent = payload.chordGroups.length
    ? `${payload.chordGroups.length} chord group${payload.chordGroups.length !== 1 ? "s" : ""}`
    : "";

  if (payload.chordGroups.length === 0) {
    container.innerHTML = `<div style="padding:10px 12px;color:#888;font-size:11px;font-style:italic;">No notes in clip</div>`;
    return;
  }

  payload.chordGroups.forEach((group, i) => {
    const s = state(i);
    const bestName = group.candidates[s.candidateIndex] ?? "—";
    const rawNotes = group.pitches.map(pitchToName).join(" ");

    const row = document.createElement("div");
    row.className = "group-row" + (i === focusedIndex ? " focused" : "") + (checked.has(i) ? " checked" : "");
    row.dataset.groupIndex = String(i);

    row.innerHTML = `
      <div class="group-check">
        <input type="checkbox" ${checked.has(i) ? "checked" : ""}>
      </div>
      <div class="group-info">
        <div class="group-time">Bar ${formatBeat(group.startTime)}</div>
        <div class="group-chord">${bestName}</div>
        <div class="group-notes-raw">${rawNotes}</div>
      </div>
      <div class="group-strategy-badge">${strategyLabel(s.strategy)}</div>
    `;

    const cb = row.querySelector<HTMLInputElement>("input[type=checkbox]")!;
    cb.addEventListener("click", (e) => {
      e.stopPropagation();
      if (cb.checked) checked.add(i); else checked.delete(i);
      updateAllRowClasses();
      updateVisualizations();
    });

    row.addEventListener("click", (e) => {
      if ((e.target as HTMLElement).tagName === "INPUT") return;
      focusedIndex = i;
      updateAllRowClasses();
      updateCandidates();
      updateVisualizations();
    });

    container.appendChild(row);
  });

  document.getElementById("select-all-link")!.addEventListener("click", () => {
    const allChecked = checked.size === payload.chordGroups.length;
    if (allChecked) {
      checked.clear();
    } else {
      payload.chordGroups.forEach((_, i) => checked.add(i));
    }
    updateAllRowClasses();
    updateVisualizations();
  });
}

// ─── Strategy / Register ───────────────────────────────────────────────────────

function initStrategyButtons(): void {
  document.querySelectorAll<HTMLButtonElement>(".strategy-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const strat = btn.dataset.strategy as DialogStrategy;
      if (strat === "bestmix") {
        // Best Mix: apply sequential voice leading across all checked groups
        const targets = checked.size > 0 ? [...checked] : [focusedIndex];
        // Sort by start time so voice leading flows in musical order
        const ordered = [...targets].sort(
          (a, b) => (payload.chordGroups[a]?.startTime ?? 0) - (payload.chordGroups[b]?.startTime ?? 0)
        );

        let prevPitches: number[] | null = null;
        for (const i of ordered) {
          const g = payload.chordGroups[i]!;
          const s = state(i);
          s.strategy = "bestmix";
          const chordName = g.candidates[s.candidateIndex] ?? "";
          if (chordName) {
            // First chord uses its own original pitches as anchor; subsequent chords
            // use the previous chord's computed voicing for smooth voice leading
            const ref = prevPitches ?? g.pitches;
            const voicing = bestMix(ref, chordName, s.register);
            s.cachedVoicing = voicing;
            prevPitches = voicing;
          }
          updateRowBadge(i);
        }

        // Focus first target so result is immediately visible
        if (!ordered.includes(focusedIndex)) {
          focusedIndex = ordered[0] ?? focusedIndex;
          updateAllRowClasses();
          updateCandidates();
        }
      } else {
        // All other strategies: apply only to the focused chord
        state(focusedIndex).strategy = strat;
        updateRowBadge(focusedIndex);
      }
      updateVisualizations();
    });
  });
}

function initRegisterButtons(): void {
  document.querySelectorAll<HTMLButtonElement>(".register-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const reg = btn.dataset.register as Register;
      const targets = checked.size > 0 ? [...checked] : [focusedIndex];
      targets.forEach((i) => { state(i).register = reg; });
      updateVisualizations();
    });
  });
}

// ─── Audio preview ─────────────────────────────────────────────────────────────

let audioCtx: AudioContext | null = null;
let currentInstrument: "piano" | "epiano" | "synth" = "piano";

function getAudioCtx(): AudioContext {
  if (!audioCtx) audioCtx = new AudioContext();
  return audioCtx;
}

function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

function playGrandPiano(midi: number, ac: AudioContext, dest: AudioNode, t: number): void {
  const freq = midiToFreq(midi);
  const end = t + 2.2;
  const harmonics: [number, number][] = [[1, 0.5], [2, 0.25], [3.01, 0.12], [4.02, 0.06]];
  for (const [ratio, level] of harmonics) {
    const osc = ac.createOscillator();
    const g = ac.createGain();
    osc.type = "sine";
    osc.frequency.value = freq * ratio;
    g.gain.setValueAtTime(0.001, t);
    g.gain.linearRampToValueAtTime(level, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.001, end);
    osc.connect(g);
    g.connect(dest);
    osc.start(t);
    osc.stop(end);
  }
}

function playEPiano(midi: number, ac: AudioContext, dest: AudioNode, t: number): void {
  const freq = midiToFreq(midi);
  const end = t + 1.8;

  const carrier = ac.createOscillator();
  const modulator = ac.createOscillator();
  const modGain = ac.createGain();
  const g = ac.createGain();

  carrier.type = "sine";
  modulator.type = "sine";
  carrier.frequency.value = freq;
  modulator.frequency.value = freq;

  // Modulation index decays from 2 → 0.2 (classic Rhodes FM envelope)
  modGain.gain.setValueAtTime(freq * 2, t);
  modGain.gain.exponentialRampToValueAtTime(freq * 0.15, end);

  modulator.connect(modGain);
  modGain.connect(carrier.frequency);

  g.gain.setValueAtTime(0.001, t);
  g.gain.linearRampToValueAtTime(0.35, t + 0.003);
  g.gain.exponentialRampToValueAtTime(0.12, t + 0.4);
  g.gain.exponentialRampToValueAtTime(0.001, end);

  carrier.connect(g);
  g.connect(dest);
  modulator.start(t);
  carrier.start(t);
  modulator.stop(end);
  carrier.stop(end);
}

function playSynth(midi: number, ac: AudioContext, dest: AudioNode, t: number): void {
  const freq = midiToFreq(midi);
  const end = t + 2.0;

  const filter = ac.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.setValueAtTime(600, t);
  filter.frequency.linearRampToValueAtTime(2200, t + 0.08);
  filter.frequency.exponentialRampToValueAtTime(500, end);
  filter.Q.value = 3;
  filter.connect(dest);

  for (const detune of [-6, 6]) {
    const osc = ac.createOscillator();
    const g = ac.createGain();
    osc.type = "sawtooth";
    osc.frequency.value = freq;
    osc.detune.value = detune;
    g.gain.setValueAtTime(0.001, t);
    g.gain.linearRampToValueAtTime(0.18, t + 0.025);
    g.gain.setValueAtTime(0.18, end - 0.08);
    g.gain.linearRampToValueAtTime(0.001, end);
    osc.connect(g);
    g.connect(filter);
    osc.start(t);
    osc.stop(end);
  }
}

function previewChord(pitches: number[]): void {
  if (pitches.length === 0) return;
  const ac = getAudioCtx();
  if (ac.state === "suspended") void ac.resume();

  const master = ac.createGain();
  master.gain.value = 0.65 / Math.sqrt(pitches.length);

  const comp = ac.createDynamicsCompressor();
  comp.threshold.value = -6;
  comp.ratio.value = 4;
  comp.attack.value = 0.003;
  comp.release.value = 0.25;
  master.connect(comp);
  comp.connect(ac.destination);

  const t = ac.currentTime + 0.015;
  for (const midi of pitches) {
    switch (currentInstrument) {
      case "piano":  playGrandPiano(midi, ac, master, t); break;
      case "epiano": playEPiano(midi, ac, master, t);     break;
      case "synth":  playSynth(midi, ac, master, t);      break;
    }
  }
}

function initAudio(): void {
  document.querySelectorAll<HTMLButtonElement>(".instrument-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      currentInstrument = btn.dataset.instrument as typeof currentInstrument;
      document.querySelectorAll<HTMLButtonElement>(".instrument-btn").forEach((b) =>
        b.classList.toggle("selected", b === btn)
      );
    });
  });

  document.getElementById("btn-preview")!.addEventListener("click", () => {
    previewChord(computeVoicing(focusedIndex));
  });
}

// ─── Footer ────────────────────────────────────────────────────────────────────

function initFooterButtons(): void {
  document.getElementById("btn-cancel")!.addEventListener("click", () => closeWithResult(null));

  document.getElementById("btn-apply")!.addEventListener("click", () => {
    if (checked.size === 0) return;

    const changes = [...checked].map((i) => {
      const g = payload.chordGroups[i]!;
      const s = state(i);
      const chordName = g.candidates[s.candidateIndex] ?? "";
      const newPitches = computeVoicing(i);
      return { chordName, newPitches, noteIndices: g.noteIndices };
    }).filter((c) => c.newPitches.length > 0);

    if (changes.length === 0) return;
    closeWithResult({ changes });
  });
}

// ─── Bootstrap ─────────────────────────────────────────────────────────────────

function init(): void {
  if (typeof __PAYLOAD__ !== "undefined" && __PAYLOAD__ !== null) {
    payload = __PAYLOAD__;
  }

  payload.chordGroups.forEach(() => {
    groupStates.push({ candidateIndex: 0, strategy: "close", register: "mid" });
  });

  initGroupsList();
  updateCandidates();
  initStrategyButtons();
  initRegisterButtons();
  initAudio();
  initFooterButtons();
  updateVisualizations();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}

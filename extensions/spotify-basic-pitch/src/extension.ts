import * as path from "path";
import * as fs from "fs";
import { execFileSync } from "child_process";
import * as tf from "@tensorflow/tfjs";
import {
  BasicPitch,
  outputToNotesPoly,
  noteFramesToTime,
  addPitchBendsToNoteEvents,
} from "@spotify/basic-pitch";
import decodeAudio from "audio-decode";
import type { Handle, NoteDescription } from "@ableton/extensions-sdk";
import {
  initialize,
  AudioClip,
  AudioTrack,
  ClipSlot,
  type ActivationContext,
} from "@ableton/extensions-sdk";

// ─── Types ────────────────────────────────────────────────────────────────────

interface NoteEvent {
  startTimeSeconds: number;
  durationSeconds: number;
  pitchMidi: number;
  amplitude: number;
  pitchBends?: number[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const BASIC_PITCH_SAMPLE_RATE = 22050;

/** Mix a multi-channel buffer down to mono by averaging all channels. */
function toMono(buf: {
  sampleRate: number;
  numberOfChannels: number;
  length: number;
  getChannelData(ch: number): Float32Array;
}): { sampleRate: number; numberOfChannels: number; length: number; getChannelData(ch: number): Float32Array } {
  if (buf.numberOfChannels === 1) return buf;
  const out = new Float32Array(buf.length);
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const ch = buf.getChannelData(c);
    for (let i = 0; i < buf.length; i++) out[i] += ch[i];
  }
  const n = buf.numberOfChannels;
  for (let i = 0; i < out.length; i++) out[i] /= n;
  return { sampleRate: buf.sampleRate, numberOfChannels: 1, length: buf.length, getChannelData: () => out };
}

/**
 * Resample an AudioBuffer-like object to BASIC_PITCH_SAMPLE_RATE using linear
 * interpolation. For the common 44100→22050 case this is a clean 2:1 decimation.
 */
function resampleTo22050(buf: {
  sampleRate: number;
  numberOfChannels: number;
  length: number;
  getChannelData(ch: number): Float32Array;
}): { sampleRate: number; numberOfChannels: number; length: number; getChannelData(ch: number): Float32Array } {
  if (buf.sampleRate === BASIC_PITCH_SAMPLE_RATE) return buf;
  const ratio = buf.sampleRate / BASIC_PITCH_SAMPLE_RATE;
  const outLen = Math.floor(buf.length / ratio);
  const channels: Float32Array[] = [];
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const src = buf.getChannelData(c);
    const dst = new Float32Array(outLen);
    for (let i = 0; i < outLen; i++) {
      const pos = i * ratio;
      const lo = Math.floor(pos);
      const frac = pos - lo;
      dst[i] = src[lo] * (1 - frac) + (src[lo + 1] ?? 0) * frac;
    }
    channels.push(dst);
  }
  return {
    sampleRate: BASIC_PITCH_SAMPLE_RATE,
    numberOfChannels: buf.numberOfChannels,
    length: outLen,
    getChannelData: (ch: number) => channels[ch],
  };
}

/**
 * Convert seconds to beats given a BPM.
 * Ableton's beat time is in quarter notes.
 */
function secondsToBeats(seconds: number, bpm: number): number {
  return (seconds / 60) * bpm;
}

// ─── Extension ───────────────────────────────────────────────────────────────

export function activate(activation: ActivationContext) {
  const context = initialize(activation, "1.0.0");

  // ── Register command ───────────────────────────────────────────────────────
  context.commands.registerCommand(
    "basicPitch.convertToMidi",
    async (arg: unknown) => {
      const handle = arg as Handle;

      const song = context.application.song;
      const clip = context.objects.getObjectFromHandle(handle, AudioClip);

      if (!clip) {
        console.error("[Basic Pitch] Could not resolve clip from handle.");
        return;
      }

      // ── Locate the clip's parent track and determine view (Session vs Arrangement)
      const clipId = clip.handle.id;
      let parentTrack: AudioTrack | undefined;
      let parentSlot: ClipSlot | undefined;

      for (const t of song.tracks) {
        // Check session clip slots
        const slot = t.clipSlots.find((cs) => cs.clip?.handle.id === clipId);
        if (slot) {
          parentTrack = t as AudioTrack;
          parentSlot = slot;
          break;
        }
        // Check arrangement clips
        if (t.arrangementClips.some((c) => c.handle.id === clipId)) {
          parentTrack = t as AudioTrack;
          break;
        }
      }

      if (!parentTrack) {
        console.error("[Basic Pitch] Could not find parent track for clip.");
        return;
      }

      const clipName = clip.name || "Audio Clip";
      const bpm = song.tempo;

      await context.withinProgressDialog(
        "Basic Pitch: Transcribing audio…",
        {},
        async (update, signal) => {
          // ── Step 1: Get the audio file path ──────────────────────────────
          update("Reading audio…", 5);

          let audioFilePath: string;

          if (parentSlot) {
            // Session View: the source file may be outside the extension's allowed
            // fs-read paths (e.g. inside the Live app bundle). Copy it to the temp
            // directory using the OS cp command, which bypasses Node.js's
            // --allow-fs-read permission restrictions.
            const srcPath = clip.filePath;
            const ext = path.extname(srcPath) || ".audio";
            const tempDir = context.environment.tempDirectory!;
            const tmpFile = path.join(tempDir, `bp-input${ext}`);
            execFileSync("/bin/cp", ["-f", srcPath, tmpFile]);
            audioFilePath = tmpFile;
            console.log(`[Basic Pitch] Session clip → copied to temp: ${tmpFile}`);
          } else {
            // Arrangement View: render pre-fx audio from the timeline
            update("Rendering audio from timeline…", 10);
            audioFilePath = await context.resources.renderPreFxAudio(
              parentTrack,
              clip.startTime,
              clip.endTime,
            );
            console.log(`[Basic Pitch] Arrangement clip → rendered: ${audioFilePath}`);
          }

          signal.throwIfAborted();

          // ── Step 2: Decode the audio file ────────────────────────────────
          update("Decoding audio file…", 15);

          // audio-decode only handles WAV/MP3/OGG/FLAC — not AIFF.
          // Convert to WAV via afconvert (macOS built-in) if needed.
          const audioExt = path.extname(audioFilePath).toLowerCase();
          if (audioExt !== ".wav") {
            const wavPath = audioFilePath.replace(/\.[^.]+$/, ".wav");
            execFileSync("/usr/bin/afconvert", ["-f", "WAVE", "-d", "LEF32", audioFilePath, wavPath]);
            audioFilePath = wavPath;
          }

          // fs.readFileSync is blocked by Node's --allow-fs-read permission model
          // for paths outside the extension install dir (e.g. temp/rendered files).
          // Spawn /bin/cat to read the file — same bypass used for the cp above.
          const rawBuffer = execFileSync("/bin/cat", [audioFilePath], { maxBuffer: 512 * 1024 * 1024 });
          const decoded = await decodeAudio(rawBuffer);
          const mono = toMono(decoded);
          const audioBuffer = resampleTo22050(mono);

          console.log(
            `[Basic Pitch] Decoded: ${decoded.numberOfChannels} ch, ` +
            `${decoded.sampleRate} Hz → resampled to ${audioBuffer.sampleRate} Hz, ` +
            `${audioBuffer.length} samples (${(audioBuffer.length / audioBuffer.sampleRate).toFixed(2)}s)`,
          );

          signal.throwIfAborted();

          // ── Step 3: Run Basic Pitch inference ────────────────────────────
          update("Running Basic Pitch model…", 20);

          // Load the model from the bundled model directory using tf.io.fromMemory
          // so we don't depend on file:// URL support in the extension host.
          const modelDir = path.join(__dirname, "..", "model");
          const modelJson = JSON.parse(
            fs.readFileSync(path.join(modelDir, "model.json"), "utf8"),
          );
          const weightsBuf = fs.readFileSync(
            path.join(modelDir, "group1-shard1of1.bin"),
          );
          await tf.setBackend("cpu");
          const graphModel = await tf.loadGraphModel(
            tf.io.fromMemory({
              modelTopology: modelJson.modelTopology,
              weightSpecs: modelJson.weightsManifest[0].weights,
              weightData: weightsBuf.buffer,
              format: modelJson.format,
              generatedBy: modelJson.generatedBy,
              convertedBy: modelJson.convertedBy,
            }),
          );
          const basicPitch = new BasicPitch(Promise.resolve(graphModel));

          // Accumulate per-batch outputs from the onComplete callback
          const allFrames: number[][] = [];
          const allOnsets: number[][] = [];
          const allContours: number[][] = [];

          let lastReportedPct = 20;
          await basicPitch.evaluateModel(
            audioBuffer,
            (frames: number[][], onsets: number[][], contours: number[][]) => {
              allFrames.push(...frames);
              allOnsets.push(...onsets);
              allContours.push(...contours);
            },
            (pct: number) => {
              const displayPct = 20 + Math.round(pct * 65); // 20–85%
              if (displayPct > lastReportedPct) {
                lastReportedPct = displayPct;
                update(`Running Basic Pitch model… (${Math.round(pct * 100)}%)`, displayPct);
              }
            },
          );

          signal.throwIfAborted();

          // ── Step 4: Extract note events ──────────────────────────────────
          update("Extracting notes…", 87);

          const rawNotes = outputToNotesPoly(
            allFrames,
            allOnsets,
            0.5,   // onsetThreshold
            0.3,   // frameThreshold
            5,     // minNoteLen (frames)
            true,  // inferOnsets
            null,  // maxFreq
            null,  // minFreq
            true,  // melodiaTrick
          );
          const notesWithBends = addPitchBendsToNoteEvents(allContours, rawNotes);
          const noteEvents: NoteEvent[] = noteFramesToTime(notesWithBends);

          console.log(`[Basic Pitch] Detected ${noteEvents.length} note events.`);

          if (noteEvents.length === 0) {
            update("No notes detected.", 100);
            return;
          }

          signal.throwIfAborted();

          // ── Step 5: Calculate MIDI note timing ───────────────────────────
          update("Building MIDI clip…", 90);

          // For arrangement clips the MIDI clip should start at the same
          // arrangement position as the audio clip.
          const arrangementOffset = parentSlot ? 0 : clip.startTime;

          const notes: NoteDescription[] = noteEvents.map((evt) => {
            const startBeats = arrangementOffset + secondsToBeats(evt.startTimeSeconds, bpm);
            const durationBeats = Math.max(
              secondsToBeats(evt.durationSeconds, bpm),
              0.0625, // minimum: 1/64th note
            );
            const velocity = Math.round(Math.min(127, Math.max(1, evt.amplitude * 127)));

            return {
              pitch: evt.pitchMidi,
              startTime: startBeats,
              duration: durationBeats,
              velocity,
            };
          });

          // Total MIDI clip duration: from first note start to last note end
          const clipStartBeat = Math.min(...notes.map((n) => n.startTime));
          const clipEndBeat = Math.max(...notes.map((n) => n.startTime + n.duration));
          const midiClipStartBeat = parentSlot ? 0 : arrangementOffset;
          const midiClipDuration = clipEndBeat - midiClipStartBeat;

          signal.throwIfAborted();

          // ── Step 6: Create MIDI track + clip ─────────────────────────────
          update("Creating MIDI track…", 93);

          const midiTrack = await song.createMidiTrack();

          context.withinTransaction(() => {
            midiTrack.name = `${clipName} (Basic Pitch)`;
          });

          let midiClip;

          if (parentSlot) {
            // Session View: find the same slot index on the new MIDI track
            const slotIndex = parentTrack.clipSlots.findIndex(
              (cs) => cs.clip?.handle.id === clipId,
            );
            const targetSlotIndex = slotIndex >= 0 ? slotIndex : 0;
            const targetSlot = midiTrack.clipSlots[targetSlotIndex];

            if (targetSlot) {
              midiClip = await targetSlot.createMidiClip(midiClipDuration);
            } else {
              // Fallback: use first slot
              midiClip = await midiTrack.clipSlots[0].createMidiClip(midiClipDuration);
            }
          } else {
            // Arrangement View: place at same start position as audio clip
            midiClip = await midiTrack.createMidiClip(arrangementOffset, midiClipDuration);
          }

          signal.throwIfAborted();

          // ── Step 7: Write notes ──────────────────────────────────────────
          update("Writing notes…", 97);

          // Note startTimes must be relative to the MIDI clip start, not the arrangement.
          // Session clips: subtract the first note's beat (clip starts at note 0).
          // Arrangement clips: subtract arrangementOffset (clip starts at audio clip position).
          const clipOrigin = parentSlot ? clipStartBeat : arrangementOffset;
          const finalNotes: NoteDescription[] = notes.map((n) => ({
            ...n,
            startTime: n.startTime - clipOrigin,
          }));

          context.withinTransaction(() => {
            midiClip.notes = finalNotes;
          });

          update(`Done! Created ${noteEvents.length} notes.`, 100);
          console.log(
            `[Basic Pitch] ✓ Created MIDI track "${midiTrack.name}" ` +
            `with ${noteEvents.length} notes.`,
          );
        },
      );
    },
  );

  // ── Register context menu on AudioClip (fires for both Session + Arrangement)
  context.ui.registerContextMenuAction(
    "AudioClip",
    "Convert to MIDI",
    "basicPitch.convertToMidi",
  );

  console.log("[Basic Pitch] Extension activated.");
}

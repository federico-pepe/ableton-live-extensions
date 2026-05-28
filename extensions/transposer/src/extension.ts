import { initialize, MidiClip, MidiTrack, AudioClip, type ActivationContext, type Handle } from "@ableton/extensions-sdk";
import dialogHtml from "./dialog.html";

export function activate(activation: ActivationContext) {
  const context = initialize(activation, "1.0.0");

  context.commands.registerCommand("transposer.open", async (_arg: unknown) => {
    // Show the transposer dialog
    const dialog = context.createModalDialog();
    let resultJson: string;
    try {
      resultJson = await dialog.show(
        `data:text/html,${encodeURIComponent(dialogHtml)}`,
        320,
        230
      );
    } catch (err) {
      console.error("[Transposer] Dialog error:", err);
      return;
    }

    let result: { action: string; semitones: number };
    try {
      result = JSON.parse(resultJson);
    } catch {
      return;
    }

    if (result.action !== "transpose" || result.semitones === 0) {
      return;
    }

    const semitones = result.semitones;
    const song = context.application.song;
    let midiClipCount = 0;

    await context.withinProgressDialog(
      "Transposing...",
      {},
      async (update, signal) => {
        const tracks = song.tracks;
        let processed = 0;

        for (const track of tracks) {
          signal.throwIfAborted();

          if (track instanceof MidiTrack) {
            // Session clips
            for (const slot of track.clipSlots) {
              if (slot.clip instanceof MidiClip) {
                transposeMidiClip(slot.clip as MidiClip, semitones);
                midiClipCount++;
              }
            }
            // Arrangement clips
            for (const clip of track.arrangementClips) {
              if (clip instanceof MidiClip) {
                transposeMidiClip(clip as MidiClip, semitones);
                midiClipCount++;
              }
            }
          }

          // Audio clips: The SDK does NOT expose a Pitch/Transpose parameter
          // on AudioClip. Only warpMode and warpMarkers are accessible.
          // Pitch-shifting audio requires external audio processing.

          processed++;
          update(
            `Transposing tracks… (${processed}/${tracks.length})`,
            Math.round((processed / tracks.length) * 100)
          );
        }

        console.log(
          `[Transposer] Done — transposed ${midiClipCount} MIDI clip(s) by ${semitones > 0 ? "+" : ""}${semitones} semitones.`
        );
      }
    );
  });

  // Right-click on any track or clip to open the transposer
  ["AudioTrack", "MidiTrack"].forEach((scope) => {
    context.ui.registerContextMenuAction(scope, "Transpose All Clips", "transposer.open");
  });
  context.ui.registerContextMenuAction("MidiClip", "Transpose All Clips", "transposer.open");
  context.ui.registerContextMenuAction("AudioClip", "Transpose All Clips", "transposer.open");
}

/**
 * Transpose all notes in a MidiClip by the given semitones.
 * Pitches are clamped to valid MIDI range [0, 127].
 */
function transposeMidiClip(clip: MidiClip, semitones: number): void {
  const notes = clip.notes;
  if (!notes || notes.length === 0) return;
  clip.notes = notes.map((note) => ({
    ...note,
    pitch: Math.max(0, Math.min(127, note.pitch + semitones)),
  }));
}

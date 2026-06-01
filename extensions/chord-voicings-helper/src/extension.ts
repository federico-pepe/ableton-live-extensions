import type { Handle, NoteDescription } from "@ableton-extensions/sdk";
import { initialize, MidiClip, type ActivationContext } from "@ableton-extensions/sdk";
import { groupChordsByTime } from "./chordDetection.js";
import { preserveTiming } from "./utils.js";
import dialogHtml from "./dialog-compiled.html";

export function activate(activation: ActivationContext) {
  const context = initialize(activation, "1.0.0");

  context.commands.registerCommand(
    "chordVoicing.openDialog",
    (args: unknown) => {
      const handle = args as Handle;
      const clip = context.getObjectFromHandle(handle, MidiClip);
      const originalNotes = clip.notes;

      const chordGroups = groupChordsByTime(originalNotes);

      const payload = { notes: originalNotes, chordGroups };

      const html = dialogHtml.replace(
        "/*__PAYLOAD__*/null",
        JSON.stringify(payload)
      );

      context.ui
        .showModalDialog(`data:text/html,${encodeURIComponent(html)}`, 820, 560)
        .then((resultString: string) => {
          let result: {
            changes: Array<{
              chordName: string;
              newPitches: number[];
              noteIndices: number[];
            }>;
          } | null = null;

          try {
            result = JSON.parse(resultString);
          } catch {
            return;
          }

          if (!result?.changes?.length) return;

          // Apply all group changes in one transaction
          const removedIndices = new Set<number>();
          const addedNotes: NoteDescription[] = [];

          for (const change of result.changes) {
            if (!change.newPitches.length || !change.noteIndices.length) continue;

            const groupNotes = change.noteIndices
              .map((idx) => originalNotes[idx])
              .filter((n): n is NoteDescription => n !== undefined);

            const voicedNotes = preserveTiming(groupNotes, change.newPitches);

            change.noteIndices.forEach((idx) => removedIndices.add(idx));
            addedNotes.push(...voicedNotes);
          }

          const newNotes: NoteDescription[] = [
            ...originalNotes.filter((_, idx) => !removedIndices.has(idx)),
            ...addedNotes,
          ];

          context.withinTransaction(() => {
            clip.notes = newNotes;
          });
        })
        .catch((err: unknown) => {
          console.error("[ChordVoicing] Dialog error:", err);
        });
    }
  );

  context.ui.registerContextMenuAction(
    "MidiClip",
    "Edit voicings",
    "chordVoicing.openDialog"
  );
}

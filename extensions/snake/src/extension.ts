import { initialize, type ActivationContext, type Handle, MidiTrack } from "@ableton-extensions/sdk";
import gameHtml from "./game.html";

interface NoteData {
  pitch: number;
  startTime: number;
  duration: number;
  velocity: number;
}

interface GameResult {
  notes: NoteData[];
  score: number;
}

export async function activate(activation: ActivationContext) {
  const context = initialize(activation, "1.0.0");

  context.commands.registerCommand("snake.play", async (args: unknown) => {
    const handle = args as Handle;
    const track = context.getObjectFromHandle(handle, MidiTrack);

    let raw: string;
    try {
      raw = await context.ui.showModalDialog(
        `data:text/html,${encodeURIComponent(gameHtml)}`,
        440,
        420,
      );
    } catch {
      return;
    }

    const result: GameResult | null = JSON.parse(raw);
    if (!result || result.notes.length === 0) return;

    const { notes } = result;

    const clipStart = track.arrangementClips.reduce(
      (max, c) => Math.max(max, c.endTime),
      0,
    );
    const lastNote = notes[notes.length - 1];
    const clipDuration = lastNote.startTime + lastNote.duration + 1;

    const clip = await context.withinTransaction(() =>
      track.createMidiClip(clipStart, clipDuration),
    );

    try {
      context.withinTransaction(() => {
        clip.notes = notes;
      });
    } catch (e) {
      console.error("Snake: could not write notes — your version of Live may not support midiclipSetNotes yet.", e);
    }
  });

  context.ui.registerContextMenuAction("MidiTrack", "🐍 Play Snake", "snake.play");
}

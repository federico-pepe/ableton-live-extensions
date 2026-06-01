import {
  initialize,
  MidiTrack,
  type Handle,
  type ActivationContext,
  type NoteDescription,
} from "@ableton-extensions/sdk";

import gameHtml from "../ui/interface.html";
import flapB64 from "../ui/FLAP.aif";
import splatB64 from "../ui/SPLAT.aif";

interface GameResult {
  notes: NoteDescription[];
  totalBeats: number;
}

export function activate(activation: ActivationContext) {
  const api = initialize(activation, "1.0.0");

  api.ui.registerContextMenuAction("MidiTrack", "Play Bird Game", "birdGame.play");

  api.commands.registerCommand("birdGame.play", async (args: unknown) => {
    const handle = args as Handle;
    const track = api.getObjectFromHandle(handle, MidiTrack);
    const song = api.application.song;
    const tempo = song.tempo;
    const rootNote = song.rootNote;
    const scaleName = song.scaleName;

    const flapDataUri = `data:audio/x-aiff;base64,${flapB64}`;
    const splatDataUri = `data:audio/x-aiff;base64,${splatB64}`;

    const html = gameHtml
      .replace("__TEMPO__", String(tempo))
      .replace("__ROOT__", String(rootNote))
      .replace("__SCALE__", JSON.stringify(scaleName))
      .replace("__FLAP_DATA__", JSON.stringify(flapDataUri))
      .replace("__SPLAT_DATA__", JSON.stringify(splatDataUri));

    let rawResult: string;
    try {
      rawResult = await api.ui.showModalDialog(`data:text/html,${encodeURIComponent(html)}`, 500, 420);
    } catch {
      return; // dialog closed without a result
    }

    const result: GameResult = JSON.parse(rawResult);
    if (!result.notes || result.notes.length === 0) return;

    const clipLength = Math.max(result.totalBeats, 1);

    const clip = await api.withinTransaction(() =>
      track.createMidiClip(0, clipLength)
    );

    await api.withinTransaction(() => {
      clip.notes = result.notes;
      clip.name = "Bird Game";
    });
  });
}

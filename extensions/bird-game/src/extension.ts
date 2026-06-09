import {
  initialize,
  MidiTrack,
  type Handle,
  type ActivationContext,
  type NoteDescription,
} from "@ableton-extensions/sdk";

import gameHtml from "../ui/interface.html";
import flapB64 from "../ui/FLAP.mp3";
import splatB64 from "../ui/SPLAT.mp3";

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

    const flapDataUri = `data:audio/mpeg;base64,${flapB64}`;
    const splatDataUri = `data:audio/mpeg;base64,${splatB64}`;

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

    // The dialog only sends a payload via "close_and_send". When the user closes
    // the window directly, Windows resolves with an empty string (rather than
    // rejecting like macOS), so guard before parsing — JSON.parse("") would throw
    // an uncaught SyntaxError and crash the extension host.
    if (!rawResult || rawResult.trim() === "") return;

    let result: GameResult;
    try {
      result = JSON.parse(rawResult);
    } catch {
      return; // malformed payload
    }
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

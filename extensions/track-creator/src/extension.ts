import { initialize, type ActivationContext } from "@ableton-extensions/sdk";
import dialogHtml from "./dialog.html";

interface DialogResult {
  count: number;
  prefix: string;
  type: "audio" | "midi";
}

export async function activate(activation: ActivationContext) {
  const context = initialize(activation, "1.0.0");

  context.commands.registerCommand("track-creator.open", async () => {
    const song = context.application.song;
    const html = dialogHtml;

    let raw: string;
    try {
      raw = await context.ui.showModalDialog(`data:text/html,${encodeURIComponent(html)}`, 380, 310);
    } catch {
      return;
    }

    const result: DialogResult | null = JSON.parse(raw);
    if (!result) return;

    const { count, prefix, type } = result;

    const tracks = await context.withinTransaction(() =>
      Promise.all(
        Array.from({ length: count }, () =>
          type === "midi" ? song.createMidiTrack() : song.createAudioTrack(),
        ),
      ),
    );

    context.withinTransaction(() => {
      tracks.forEach((track, i) => {
        track.name = count > 1 ? `${prefix} ${i + 1}` : prefix;
      });
    });
  });

  context.ui.registerContextMenuAction("AudioTrack", "Create tracks...", "track-creator.open");
  context.ui.registerContextMenuAction("MidiTrack", "Create tracks...", "track-creator.open");
}

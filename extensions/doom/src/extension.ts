import { initialize, type ActivationContext } from "@ableton/extensions-sdk";
import doomHtml from "./doom.html";

export function activate(activation: ActivationContext) {
  const context = initialize(activation, "1.0.0");

  // Command: launch Doom dialog
  context.commands.registerCommand("doom.launch", async (_arg: unknown) => {
    try {
      const dialog = context.createModalDialog();

      // Large dialog to give Doom plenty of room (800x640)
      await dialog.show(
        `data:text/html,${encodeURIComponent(doomHtml)}`,
        880,
        600,
      );
    } catch (err) {
      console.error("[Doom] Dialog error:", err);
    }
  });

  // Register on all track types and scene
  const scopes = [
    "AudioTrack",
    "MidiTrack",
    "Scene",
  ] as const;

  for (const scope of scopes) {
    context.ui.registerContextMenuAction(scope, "Play Doom 🔫", "doom.launch");
  }

  console.log("[Doom] Extension activated — right-click a track or scene to launch DOOM!");
}

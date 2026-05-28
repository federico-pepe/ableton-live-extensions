import * as ableton from "@ableton/extensions-sdk";

const COMMAND_ID = "duplicate-track.duplicate-and-clear";

export function activate(activation: ableton.ActivationContext) {
  const context = ableton.initialize(activation, "1.0.0");

  context.ui.registerContextMenuAction(
    "AudioTrack",
    "Duplicate (No clips)",
    COMMAND_ID,
  );
  context.ui.registerContextMenuAction(
    "MidiTrack",
    "Duplicate (No clips)",
    COMMAND_ID,
  );

  context.commands.registerCommand(COMMAND_ID, async (arg: unknown) => {
    const track = context.objects.getObjectFromHandle(
      arg as ableton.Handle,
      ableton.Track,
    );
    const song = context.application.song;

    const duplicate = await song.duplicateTrack(track);

    await context.withinTransaction(() =>
      Promise.all([
        ...duplicate.arrangementClips.map((clip) => duplicate.deleteClip(clip)),
        ...duplicate.clipSlots
          .filter((slot) => slot.clip !== null)
          .map((slot) => slot.deleteClip()),
      ]),
    );
  });
}

# Transpose Clips

![Transpose Clips](../../images/Ableton%20Extension%20-%20Transpose.png)

[⬇️ Download](../../download/transposer.ablx)

Transposes every MIDI clip in the Live Set by a chosen number of semitones, with a cancellable progress dialog.

## Features

- **Global scope** — Transposes all MIDI clips across all tracks, in both Session and Arrangement View
- **Semitone precision** — Positive values transpose up, negative values transpose down
- **Cancellable** — Stop mid-run with the × button in the progress dialog
- **Undo-friendly** — All changes are grouped for a single undo step

## How to use

1. Right-click any **track** or **clip** and choose **Transpose All Clips**.
2. Enter the number of semitones (positive = up, negative = down).
3. Click **Transpose**. A progress bar tracks the operation.
4. Press **Cmd+Z** to undo all changes in one step.

> Note: Audio clips cannot be transposed — the operation applies to MIDI clips only. Pitches are clamped to the valid MIDI range [0–127].

# Basic Pitch

![Ableton Extension Basic Pitch](../../images/Ableton%20Extension%20-%20Basic%20Pitch.png)

[⬇️ Download](../../download/spotify-basic-pitch.ablx)

Converts any audio clip to a MIDI clip using Spotify's Basic Pitch neural network for polyphonic pitch detection. Runs entirely offline — no external software or internet connection required.

## Features

- **Polyphonic transcription** — Detects multiple simultaneous notes from pitched instruments
- **Works in both views** — Session View (same clip slot) and Arrangement View (same position)
- **Pitch bend support** — Fine-grained pitch contour is captured and included in the output
- **Fully offline** — The ML model runs locally; no data leaves your machine

## Usage

1. Right-click any **Audio Clip** in Session or Arrangement View.
2. Choose **Convert to MIDI**.
3. A progress dialog appears while the model runs.
4. A new MIDI track is created next to the original, containing the transcribed notes.

The resulting clip is named `<original clip name> (Basic Pitch)` and placed at the same position as the source clip. Best results on single-instrument recordings with clear pitch content (guitar, piano, voice, bass).

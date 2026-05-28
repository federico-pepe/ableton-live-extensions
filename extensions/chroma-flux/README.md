# ChromaFlux

![ChromaFlux](../../images/Ableton%20Extension%20-%20Chroma%20Flux.png)

[⬇️ Download](../../download/chroma-flux.ablx)

A parameter randomizer for Instrument Racks. Randomizes device parameters across selected tracks with configurable mode and intensity.

## Features

- **Macro-only mode** — Randomizes only Macro controls on Instrument Racks
- **Ninja mode** — Randomizes all device parameters (excluding Device On and Chain Selector)
- **Track scope** — Randomize the current track only, or all tracks at once
- **Intensity control** — Set what percentage of parameters get randomized (0–100%)
- **Undo-friendly** — All changes are grouped in a single transaction for one undo step

## How to use

1. Right-click any **MIDI or Audio Track** and choose **Edit device parameters**.
2. Select a mode:
   - **Macro Only** — Safer; randomizes only Macro controls on Instrument Racks
   - **Ninja** — Randomizes all parameters on all devices
3. Choose a track scope: **Current Track** or **All Tracks**.
4. Set the **Intensity** (0–100%) to control how many parameters are affected.
5. Click **Apply**. Press **Cmd+Z** to undo all changes in one step.

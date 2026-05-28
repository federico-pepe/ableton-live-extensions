import type { Handle } from "@ableton/extensions-sdk";
import {
  initialize,
  Track,
  Device,
  RackDevice,
  type ActivationContext,
  type DeviceParameter,
} from "@ableton/extensions-sdk";

// Import the HTML interface for the modal dialog
import uiHtml from "./ui.html";

interface FluxConfig {
  mode: "macro-only" | "ninja";
  trackScope: "current" | "all";
  paramScope: number; // 0-1: 0 = few params (~30%), 1 = all params (used in ninja mode only)
  intensity: number;
}

/**
 * Shuffles an array in-place (Fisher-Yates)
 */
function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = arr[i] as T;
    arr[i] = arr[j] as T;
    arr[j] = tmp;
  }
  return arr;
}

/**
 * Recursively collects all parameters from a device tree, excluding Device On and Chain Selector.
 * Recurses into RackDevice chains so nested devices are included.
 */
function collectNinjaParams(
  devices: Device<"1.0.0">[],
  out: Array<DeviceParameter<"1.0.0">>
): void {
  for (const device of devices) {
    for (const param of device.parameters) {
      const name = param.name.toLowerCase();
      if (name === "device on" || name === "chain selector") continue;
      out.push(param);
    }
    if (device instanceof RackDevice) {
      for (const chain of device.chains) {
        collectNinjaParams(chain.devices, out);
      }
    }
  }
}

/**
 * Applies the flux randomization to device parameters
 * Mode determines scope: "macro-only" restricts to Macro controls on RackDevices
 * "ninja" mode includes all device parameters (except Device On and Chain Selector)
 */
async function applyFlux(
  song: any,
  currentTrack: Track<"1.0.0">,
  config: FluxConfig
): Promise<void> {
  const tracks = config.trackScope === "all" ? song.tracks : [currentTrack];
  const allSetValuePromises: Promise<void>[] = [];
  const isMacroOnly = config.mode === "macro-only";

  for (const track of tracks) {
    // Collect parameters based on mode
    const allParams: Array<DeviceParameter<"1.0.0">> = [];

    if (isMacroOnly) {
      // Macro Only mode: collect macro parameters from RackDevices.
      // parameters[0] = Device On, parameters[1..N] = up to 16 macros, last = Chain Selector.
      // Skip Device On (index 0) and Chain Selector (fixed system name, cannot be renamed).
      for (const device of track.devices) {
        if (!(device instanceof RackDevice)) continue;
        console.log(`[ChromaFlux] Found RackDevice: ${device.name}`);
        for (const param of device.parameters.slice(1)) {
          if (param.name.toLowerCase() === "chain selector") continue;
          console.log(
            `[ChromaFlux] Including macro param: ${param.name} (min: ${param.min}, max: ${param.max})`
          );
          allParams.push(param);
        }
      }
    } else {
      // Ninja Mode: collect all parameters from all devices (recursing into rack chains),
      // excluding Device On and Chain Selector
      collectNinjaParams(track.devices, allParams);
    }

    // Skip track if no parameters found
    if (allParams.length === 0) {
      console.log(`[ChromaFlux] No parameters found on track: ${track.name}`);
      continue;
    }
    console.log(`[ChromaFlux] Found ${allParams.length} parameters to randomize`);

    // Select subset based on paramScope (0-1 range)
    let paramsToRandomize = allParams;
    const paramRatio = Math.min(config.paramScope, 1);
    const count = Math.max(1, Math.ceil(allParams.length * paramRatio));
    if (paramRatio < 1) {
      paramsToRandomize = shuffle([...allParams]).slice(0, count);
    }

    // Randomize each selected parameter and collect promises
    for (const param of paramsToRandomize) {
      const range = param.max - param.min;
      const randomized = param.min + Math.random() * range * config.intensity;
      // Clamp to valid range just in case
      const clamped = Math.max(param.min, Math.min(param.max, randomized));
      console.log(
        `[ChromaFlux] Setting ${param.name} (range ${param.min}-${param.max}) to ${clamped.toFixed(2)}`
      );
      allSetValuePromises.push(param.setValue(clamped));
    }
  }

  // Wait for all setValue operations to complete
  await Promise.all(allSetValuePromises);
  console.log("[ChromaFlux] All parameters updated");
}

export function activate(activation: ActivationContext) {
  const context = initialize(activation, "1.0.0");
  const song = context.application.song;

  // Register the main command
  context.commands.registerCommand(
    "chromaflux.open",
    (args: unknown) => ((handle: Handle) => {
      const track = context.objects.getObjectFromHandle(handle, Track);

      const dialog = context.createModalDialog();

      // Open the modal dialog
      dialog
        .show(`data:text/html,${encodeURIComponent(uiHtml)}`, 620, 560)
        .then((result) => {
          if (!result) return; // User cancelled

          try {
            const config = JSON.parse(result) as FluxConfig;

            // Apply randomization (async operation)
            applyFlux(song, track, config).catch((error) => {
              console.error("[ChromaFlux] Error during flux application:", error);
            });
          } catch (error) {
            console.error("ChromaFlux: failed to parse config or apply flux", error);
          }
        })
        .catch((error) => {
          console.error("ChromaFlux: dialog error", error);
        });
    })(args as Handle)
  );

  // Register context menu actions for AudioTrack and MidiTrack
  ["AudioTrack", "MidiTrack"].forEach((scope) => {
    context.ui.registerContextMenuAction(
      scope,
      "Edit device parameters",
      "chromaflux.open"
    );
  });
}

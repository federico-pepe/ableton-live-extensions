import {
    initialize,
    AudioTrack,
    MidiTrack,
    AudioClip,
    MidiClip,
    type ActivationContext,
    type NoteDescription,
    Song,
    Track,
} from "@ableton-extensions/sdk";

import dialogHtml from "./dialog.html";

// ── Types ──────────────────────────────────────────────────────────────────

interface WarpMarker {
    sampleTime: number;
    beatTime: number;
}

interface SessionClipData {
    name: string;
    color: number;
    duration: number;
    startMarker: number;
    endMarker: number;
    looping: boolean;
    loopStart: number;
    loopEnd: number;
    filePath?: string;
    warping?: boolean;
    warpMode?: number;
    warpMarkers?: WarpMarker[];
    notes?: NoteDescription[];
}

interface DialogResult {
    mode: "automatic" | "custom" | "cancel";
    order?: Array<{ index: number; multiplier: number }>;
}

interface InitialData {
    scenes: Array<{ index: number; name: string }>;
}

type ExtensionContext = ReturnType<typeof initialize<"1.0.0">>;

// ── Main ───────────────────────────────────────────────────────────────────

export function activate(activation: ActivationContext) {
    const context = initialize(activation, "1.0.0");
    const song = context.application.song;

    context.ui.registerContextMenuAction("Scene", "Build Arrangement", "bridge.open");

    context.commands.registerCommand("bridge.open", async () => {
        try {
            const scenes = song.scenes;
            const tracks = song.tracks.filter(t => t instanceof AudioTrack || t instanceof MidiTrack);

            if (scenes.length === 0) {
                console.warn("[Bridge] No scenes found.");
                return;
            }

            // Open dialog
            const initialData: InitialData = {
                scenes: scenes.map((scene, idx) => ({
                    index: idx,
                    name: scene.name || `Scene ${idx + 1}`,
                })),
            };

            const initScript = `<script>window.INITIAL_DATA=${JSON.stringify(initialData).replace(/<\/script>/gi, "<\\/script>")};<\/script>`;
            const htmlWithData = dialogHtml.replace("</head>", initScript + "</head>");

            let resultStr: string;
            try {
                resultStr = await context.ui.showModalDialog(`data:text/html,${encodeURIComponent(htmlWithData)}`, 640, 480);
            } catch {
                return;
            }

            let result: DialogResult | null;
            try {
                result = JSON.parse(resultStr) as DialogResult;
            } catch {
                return;
            }

            if (!result || result.mode === "cancel") {
                return;
            }

            // Pre-read all session clip data
            console.log(`[Bridge] Found ${tracks.length} valid audio/midi tracks (filtered from ${song.tracks.length} total)`);
            tracks.forEach((t, i) => {
                const trackType = t instanceof AudioTrack ? "audio" : t instanceof MidiTrack ? "midi" : "unknown";
                console.log(`[Bridge] Track ${i}: ${trackType} - ${t.name || "(unnamed)"}`);
            });

            const sessionClipData: (SessionClipData | null)[][] = tracks.map((track, trackIdx) =>
                scenes.map((_, sceneIndex) => {
                    const clipSlot = track.clipSlots[sceneIndex];
                    if (!clipSlot || !clipSlot.clip) return null;

                    const clip = clipSlot.clip;
                    const data: SessionClipData = {
                        name: clip.name,
                        color: clip.color,
                        duration: clip.duration,
                        startMarker: clip.startMarker,
                        endMarker: clip.endMarker,
                        looping: clip.looping,
                        loopStart: clip.loopStart,
                        loopEnd: clip.loopEnd,
                    };

                    // Add audio-specific data
                    if (track instanceof AudioTrack) {
                        const audioClip = context.getObjectFromHandle(clip.handle, AudioClip);
                        data.filePath = audioClip.filePath;
                        data.warping = audioClip.warping;
                        data.warpMode = audioClip.warpMode;
                        data.warpMarkers = audioClip.warpMarkers;
                    }

                    // Add midi-specific data
                    if (track instanceof MidiTrack) {
                        const midiClip = context.getObjectFromHandle(clip.handle, MidiClip);
                        data.notes = midiClip.notes;
                    }

                    return data;
                })
            );

            // Execute based on mode
            if (result.mode === "automatic") {
                // Automatic: all scenes in order, each with multiplier 1
                const order = scenes.map((_, idx) => ({ index: idx, multiplier: 1 }));
                await executeArrangement(context, song, tracks, sessionClipData, scenes, order);
            } else if (result.mode === "custom" && result.order) {
                // Custom: use the order from dialog
                await executeArrangement(context, song, tracks, sessionClipData, scenes, result.order);
            }
        } catch (err) {
            console.error("[Bridge] Error:", err);
        }
    });
}

// ── Execute Arrangement ────────────────────────────────────────────────────

async function executeArrangement(
    context: ExtensionContext,
    song: Song<"1.0.0">,
    tracks: Track<"1.0.0">[],
    sessionClipData: (SessionClipData | null)[][],
    allScenes: any[],
    order: Array<{ index: number; multiplier: number }>
): Promise<void> {
    if (order.length === 0) {
        console.warn("[Bridge] No scenes in arrangement order.");
        return;
    }

    // Step 1: Compute scene durations (once per unique scene index)
    const sceneDurations: number[] = allScenes.map((_, sceneIndex) => {
        let maxDuration = 0;
        for (const trackClips of sessionClipData) {
            const clipData = trackClips[sceneIndex];
            if (clipData && clipData.duration > maxDuration) {
                maxDuration = clipData.duration;
            }
        }
        return maxDuration;
    });

    // Step 2: Compute positions based on the custom order
    const scenePositions: number[] = [];
    let cursor = 0;
    for (const orderItem of order) {
        scenePositions.push(cursor);
        // Each instance of a scene contributes its duration to the total
        cursor += sceneDurations[orderItem.index] * orderItem.multiplier;
    }
    const totalLength = cursor;

    if (totalLength === 0) {
        console.warn("[Bridge] No clips found in Session View.");
        return;
    }

    await context.ui.withinProgressDialog("Session to Arrangement", {}, async (update, signal) => {
        // Step 3: Clear existing state
        await update("Clearing arrangement...", 0);

        for (const cp of song.cuePoints) {
            await song.deleteCuePoint(cp);
        }

        signal.throwIfAborted();

        for (const track of tracks) {
            await track.clearClipsInRange(0, totalLength + 1);
        }

        signal.throwIfAborted();

        // Step 4: Create cue points (locators) for non-empty scenes
        await update("Creating locators...", 10);

        for (let i = 0; i < order.length; i++) {
            const sceneIndex = order[i].index;
            const sceneName = allScenes[sceneIndex].name || `Scene ${sceneIndex + 1}`;
            if (sceneDurations[sceneIndex] > 0) {
                const cp = await song.createCuePoint(scenePositions[i]);
                cp.name = sceneName;
            }
        }

        signal.throwIfAborted();

        // Step 5: Create arrangement clips
        await update("Creating clips...", 20);

        const totalOps = tracks.length * order.length;
        let processed = 0;

        for (let trackIndex = 0; trackIndex < tracks.length; trackIndex++) {
            const track = tracks[trackIndex];

            for (let orderIdx = 0; orderIdx < order.length; orderIdx++) {
                const sceneIndex = order[orderIdx].index;
                const multiplier = order[orderIdx].multiplier;
                const sceneDuration = sceneDurations[sceneIndex];

                // Place this scene `multiplier` times consecutively
                for (let mult = 0; mult < multiplier; mult++) {
                    const sceneStart = scenePositions[orderIdx] + mult * sceneDuration;
                    const clipData = sessionClipData[trackIndex][sceneIndex];

                    if (!clipData || sceneDuration === 0) {
                        processed++;
                        continue;
                    }

                    // Determine arrangement duration based on looping
                    let arrangementDuration = clipData.duration;
                    if (clipData.looping && clipData.duration < sceneDuration) {
                        arrangementDuration = sceneDuration;
                    } else {
                        arrangementDuration = Math.min(clipData.duration, sceneDuration);
                    }

                    try {
                        if (track instanceof AudioTrack) {
                            if (!clipData.filePath) {
                                console.warn(`[Bridge] Audio track ${trackIndex} scene ${sceneIndex}: no filePath`);
                                processed++;
                                continue;
                            }

                            const needsLooping = clipData.looping && clipData.duration < sceneDuration;

                            if (needsLooping) {
                                // For looping clips: create with loop settings
                                const loopLength = clipData.loopEnd - clipData.loopStart;

                                if (loopLength <= 0) {
                                    console.warn(
                                        `[Bridge] Audio track ${trackIndex} scene ${sceneIndex}: invalid loop range ` +
                                        `(loopStart=${clipData.loopStart}, loopEnd=${clipData.loopEnd})`
                                    );
                                    // Fall back to single clip without looping
                                    console.log(
                                        `[Bridge] Creating audio clip (no loop): track=${trackIndex} (${track.name}), ` +
                                        `scene=${sceneIndex}, start=${sceneStart}, duration=${arrangementDuration}, file="${clipData.filePath}"`
                                    );
                                    await track.createAudioClip({
                                        filePath: clipData.filePath,
                                        startTime: sceneStart,
                                        duration: arrangementDuration,
                                        isWarped: clipData.warping ?? true,
                                    });
                                } else {
                                    // Create looping clip using just the loop bracket
                                    const loopSettings = {
                                        looping: true,
                                        startMarker: Math.max(0, clipData.loopStart),
                                        endMarker: Math.max(clipData.loopStart + 0.1, clipData.loopEnd),
                                        loopStart: Math.max(0, clipData.loopStart),
                                        loopEnd: Math.max(clipData.loopStart + 0.1, clipData.loopEnd),
                                    };

                                    console.log(
                                        `[Bridge] Creating looping audio clip: track=${trackIndex} (${track.name}), ` +
                                        `scene=${sceneIndex}, start=${sceneStart}, duration=${arrangementDuration}, ` +
                                        `file="${clipData.filePath}", loopStart=${loopSettings.loopStart}, loopEnd=${loopSettings.loopEnd}`
                                    );
                                    await track.createAudioClip({
                                        filePath: clipData.filePath,
                                        startTime: sceneStart,
                                        duration: arrangementDuration,
                                        isWarped: clipData.warping ?? true,
                                        loopSettings,
                                    });
                                }
                            } else {
                                // Non-looping: create clip as-is without marker settings
                                console.log(
                                    `[Bridge] Creating audio clip: track=${trackIndex} (${track.name}), scene=${sceneIndex}, ` +
                                    `start=${sceneStart}, duration=${arrangementDuration}, file="${clipData.filePath}"`
                                );
                                await track.createAudioClip({
                                    filePath: clipData.filePath,
                                    startTime: sceneStart,
                                    duration: arrangementDuration,
                                    isWarped: clipData.warping ?? true,
                                });
                            }

                            // Set name, color, and warp settings
                            context.withinTransaction(() => {
                                const newClip = track.arrangementClips.find(c => c.startTime === sceneStart);
                                if (newClip && newClip instanceof AudioClip) {
                                    newClip.name = clipData.name;
                                    newClip.color = clipData.color;
                                    // Preserve warp mode
                                    newClip.warpMode = clipData.warpMode || 0;
                                }
                            });
                        } else if (track instanceof MidiTrack) {
                            if (!clipData.notes) {
                                console.warn(`[Bridge] MIDI track ${trackIndex} scene ${sceneIndex}: no notes`);
                                processed++;
                                continue;
                            }

                            // Create MIDI clip
                            const midiClip = await track.createMidiClip(sceneStart, arrangementDuration);

                            // Build and set notes
                            const notes = buildMidiNotes(clipData, arrangementDuration);

                            context.withinTransaction(() => {
                                midiClip.notes = notes;
                                midiClip.name = clipData.name;
                                midiClip.color = clipData.color;
                            });
                        }
                    } catch (clipErr) {
                        console.error(
                            `[Bridge] Failed to create clip at track=${trackIndex} (${track instanceof AudioTrack ? "audio" : "midi"}) scene=${sceneIndex}: duration=${arrangementDuration}, error:`,
                            clipErr
                        );
                    }

                    processed++;
                    await update("Creating clips...", 20 + Math.round((processed / totalOps) * 75));
                    signal.throwIfAborted();
                }
            }
        }

        await update("Done", 100);
    });
}

/**
 * Build MIDI notes for arrangement clip, handling looping if necessary.
 *
 * For non-looping clips: shift notes so they start at 0 and clip at duration.
 * For looping clips: tile the loop region across the full arrangement duration.
 */
function buildMidiNotes(
    clipData: SessionClipData,
    arrangementDuration: number
): NoteDescription[] {
    const notes = clipData.notes || [];
    const { startMarker, loopStart, loopEnd, looping, duration } = clipData;

    // Non-looping or clip fills the entire scene: shift and return as-is
    if (!looping || duration >= arrangementDuration) {
        return notes
            .filter((note) => {
                // Only include notes within the playable range
                return note.startTime >= startMarker && note.startTime < loopEnd;
            })
            .map((note) => {
                const arrStartTime = note.startTime - startMarker;
                if (arrStartTime + note.duration > arrangementDuration) {
                    return {
                        ...note,
                        startTime: arrStartTime,
                        duration: arrangementDuration - arrStartTime,
                    };
                }
                return { ...note, startTime: arrStartTime };
            })
            .filter((note) => note.startTime < arrangementDuration);
    }

    // Looping clip: tile the loop content
    const result: NoteDescription[] = [];
    const loopLength = loopEnd - loopStart;

    if (loopLength <= 0) {
        // Degenerate case: no loop region
        return notes.filter((note) => note.startTime < arrangementDuration);
    }

    // Pre-loop section: from startMarker to loopEnd (played once)
    const preLoopDuration = loopEnd - startMarker;
    const preLoopNotes = notes.filter(
        (note) => note.startTime >= startMarker && note.startTime < loopEnd
    );

    for (const note of preLoopNotes) {
        const arrStartTime = note.startTime - startMarker;
        if (arrStartTime >= arrangementDuration) continue;

        const noteDur = Math.min(note.duration, arrangementDuration - arrStartTime);
        result.push({
            ...note,
            startTime: arrStartTime,
            duration: noteDur,
        });
    }

    // Loop section: repeat [loopStart, loopEnd) content
    const loopNotes = notes.filter(
        (note) => note.startTime >= loopStart && note.startTime < loopEnd
    );

    let iterationStart = preLoopDuration;
    while (iterationStart < arrangementDuration) {
        for (const note of loopNotes) {
            const arrStartTime = iterationStart + (note.startTime - loopStart);
            if (arrStartTime >= arrangementDuration) continue;

            const noteDur = Math.min(
                note.duration,
                arrangementDuration - arrStartTime
            );
            result.push({
                ...note,
                startTime: arrStartTime,
                duration: noteDur,
            });
        }

        iterationStart += loopLength;
    }

    return result;
}

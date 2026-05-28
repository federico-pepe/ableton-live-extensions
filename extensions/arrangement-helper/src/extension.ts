import {
  initialize,
  MidiTrack,
  AudioTrack,
  Track,
  DataModelObject,
  MidiClip,
  AudioClip,
  Clip,
  ApiVersion,
  type NoteDescription,
  type ArrangementSelection,
  type ActivationContext,
  type ClipLoopSettings,
} from "@ableton/extensions-sdk";

import dialogHtml from "./dialog.html";

// ── Types ──────────────────────────────────────────────────────────────────

interface SectionData {
  id: number;
  name: string;
  bars: number;
  color: number;
}

interface DialogResult {
  sections: SectionData[];
  createLocators: boolean;
}

interface InitialSection {
  id: number;
  name: string;
  bars: number;
  color: string; // hex string like "#FC393D"
}

interface OldSectionLayout {
  id: number;
  start: number;
  duration: number;
}

interface NewSectionLayout {
  id: number | undefined;
  name: string;
  start: number;
  duration: number;
  color: number;
}

interface ClipSnapshot {
  type: "midi" | "audio";
  name: string;
  color: number;
  duration: number;
  // MIDI
  notes?: NoteDescription[];
  // Audio
  filePath?: string;
  warping?: boolean;
  warpMode?: number;
  looping?: boolean;
  startMarker?: number;
  endMarker?: number;
  loopStart?: number;
  loopEnd?: number;
}

type CreateOp =
  | {
      kind: "midi";
      track: MidiTrack<"1.0.0">;
      start: number;
      duration: number;
      name: string;
      color: number;
      notes?: NoteDescription[];
    }
  | {
      kind: "audio";
      track: AudioTrack<"1.0.0">;
      filePath: string;
      start: number;
      duration: number;
      isWarped: boolean;
      loopSettings: ClipLoopSettings;
      name: string;
      color: number;
      warpMode?: number;
    };

// ── Helpers ────────────────────────────────────────────────────────────────

const BEATS_PER_BAR = 4;

function colorToHex(color: number): string {
  return "#" + Number(color).toString(16).padStart(6, "0");
}

function snapshotClip<V extends ApiVersion>(clip: Clip<V>): ClipSnapshot {
  const base = { name: clip.name, color: clip.color, duration: clip.duration };
  if (clip instanceof MidiClip) {
    return { type: "midi", ...base, notes: [...clip.notes] };
  }
  if (clip instanceof AudioClip) {
    return {
      type: "audio",
      ...base,
      filePath: clip.filePath,
      warping: clip.warping,
      warpMode: clip.warpMode,
      looping: clip.looping,
      startMarker: clip.startMarker,
      endMarker: clip.endMarker,
      loopStart: clip.loopStart,
      loopEnd: clip.loopEnd,
    };
  }
  return { type: "midi", ...base };
}

// ── Activate ───────────────────────────────────────────────────────────────

export function activate(activation: ActivationContext) {
  const api = initialize(activation, "1.0.0");

  api.commands.registerCommand(
    "arrangementHelper.buildStructure",
    async (args: unknown) => {
      try {
        const selection = args as ArrangementSelection;

        // Resolve the first selected MIDI track
        const lane = selection.selected_lanes
          .map((h) => api.objects.getObjectFromHandle(h, DataModelObject))
          .find((obj) => obj instanceof MidiTrack);

        if (!(lane instanceof MidiTrack)) {
          console.error("[Arrangement Track] No MIDI track found in selection.");
          return;
        }
        const track = lane;

        // ── Detect existing clips (edit mode) ───────────────────────────────
        const existingClips = [...track.arrangementClips].sort(
          (a, b) => a.startTime - b.startTime,
        );
        const firstClip = existingClips[0];
        const isEditMode = firstClip !== undefined;
        const startPosition =
          firstClip?.startTime ?? selection.time_selection_start;

        const oldLayout: OldSectionLayout[] = existingClips.map((clip, i) => ({
          id: i,
          start: clip.startTime,
          duration: clip.duration,
        }));
        const arrangementOldEnd = oldLayout.reduce(
          (max, s) => Math.max(max, s.start + s.duration),
          startPosition,
        );

        // ── Build initial data for dialog ────────────────────────────────────
        const initialSections: InitialSection[] = existingClips.map(
          (clip, i) => ({
            id: i,
            name: clip.name || `Section ${i + 1}`,
            bars: Math.max(1, Math.round(clip.duration / BEATS_PER_BAR)),
            color: colorToHex(clip.color),
          }),
        );

        const initPayload = {
          sections: initialSections,
          nextId: initialSections.length,
          isEditing: isEditMode,
        };

        const initScript = `<script>window.INITIAL_DATA=${JSON.stringify(initPayload).replace(/<\/script>/gi, "<\\/script>")};<\/script>`;
        const htmlWithData = dialogHtml.replace(
          "</head>",
          initScript + "</head>",
        );

        // ── Show dialog ──────────────────────────────────────────────────────
        const resultStr = await api.createModalDialog().show(
          `data:text/html,${encodeURIComponent(htmlWithData)}`,
          580,
          530,
        );

        let result: DialogResult | null = null;
        try {
          result = JSON.parse(resultStr) as DialogResult | null;
        } catch {
          return;
        }
        if (!result?.sections?.length) return;

        const { sections, createLocators } = result;
        const song = api.application.song;

        // ── Compute new layout ───────────────────────────────────────────────
        const newLayout: NewSectionLayout[] = [];
        let cursor = startPosition;
        for (const s of sections) {
          const dur = s.bars * BEATS_PER_BAR;
          newLayout.push({
            id: s.id < initialSections.length ? s.id : undefined,
            name: s.name,
            start: cursor,
            duration: dur,
            color: s.color,
          });
          cursor += dur;
        }
        const arrangementNewEnd = cursor;
        const clearEnd = Math.max(arrangementOldEnd, arrangementNewEnd);

        const moveMap = new Map<
          number,
          { newStart: number; newDuration: number }
        >();
        for (const ns of newLayout) {
          if (ns.id !== undefined) {
            moveMap.set(ns.id, {
              newStart: ns.start,
              newDuration: ns.duration,
            });
          }
        }

        // ── Collect all operations (pure data, no mutations yet) ─────────────
        const clearTargets: Track<"1.0.0">[] = [track];
        const createOps: CreateOp[] = [];

        // Arrangement track: section markers
        for (const s of newLayout) {
          createOps.push({
            kind: "midi",
            track,
            start: s.start,
            duration: s.duration,
            name: s.name,
            color: s.color,
          });
        }

        // Other tracks in edit mode: remap clips to new section positions
        if (isEditMode) {
          for (const anyTrack of song.tracks) {
            if (anyTrack === track) continue;
            clearTargets.push(anyTrack);

            for (const clip of anyTrack.arrangementClips) {
              if (
                clip.startTime < startPosition ||
                clip.startTime >= arrangementOldEnd
              )
                continue;

              const section = oldLayout.find(
                (s) =>
                  clip.startTime >= s.start &&
                  clip.startTime < s.start + s.duration,
              );
              if (!section) continue;

              const move = moveMap.get(section.id);
              if (!move) continue; // section was removed — clip is dropped

              const offsetInSection = clip.startTime - section.start;
              if (offsetInSection >= move.newDuration) continue;

              const clampedDuration = Math.min(
                clip.duration,
                section.duration - offsetInSection,
                move.newDuration - offsetInSection,
              );
              if (clampedDuration <= 0) continue;

              const snapshot = snapshotClip(clip);
              const newStart = move.newStart + offsetInSection;

              if (anyTrack instanceof MidiTrack) {
                createOps.push({
                  kind: "midi",
                  track: anyTrack,
                  start: newStart,
                  duration: clampedDuration,
                  name: snapshot.name,
                  color: snapshot.color,
                  ...(snapshot.notes ? { notes: snapshot.notes } : {}),
                });
              } else if (anyTrack instanceof AudioTrack && snapshot.filePath) {
                createOps.push({
                  kind: "audio",
                  track: anyTrack,
                  filePath: snapshot.filePath,
                  start: newStart,
                  duration: clampedDuration,
                  isWarped: snapshot.warping ?? true,
                  loopSettings: {
                    looping: snapshot.looping ?? false,
                    startMarker: snapshot.startMarker ?? 0,
                    endMarker: snapshot.endMarker ?? clampedDuration,
                    loopStart: snapshot.loopStart ?? 0,
                    loopEnd: snapshot.loopEnd ?? clampedDuration,
                  },
                  name: snapshot.name,
                  color: snapshot.color,
                  ...(snapshot.warpMode !== undefined
                    ? { warpMode: snapshot.warpMode }
                    : {}),
                });
              }
            }
          }
        }

        // ── Phase 1: Clear all tracks ────────────────────────────────────────
        await api.withinTransaction(() =>
          Promise.all(
            clearTargets.map((t) =>
              t.clearClipsInRange(startPosition, clearEnd),
            ),
          ),
        );

        // ── Phase 2: Create all clips ────────────────────────────────────────
        const created = await api.withinTransaction(() =>
          Promise.all(
            createOps.map((op) =>
              op.kind === "midi"
                ? op.track.createMidiClip(op.start, op.duration)
                : op.track.createAudioClip(
                    op.filePath,
                    op.start,
                    op.duration,
                    op.isWarped,
                    op.loopSettings,
                  ),
            ),
          ),
        );

        // ── Phase 3: Set all properties (+ rename track in create mode) ───────
        api.withinTransaction(() => {
          if (!isEditMode) track.name = "Arrangement";
          created.forEach((clip, i) => {
            const op = createOps[i];
            if (!op) return;
            clip.name = op.name;
            clip.color = op.color;
            if (op.kind === "midi" && clip instanceof MidiClip && op.notes)
              clip.notes = op.notes;
            if (
              op.kind === "audio" &&
              clip instanceof AudioClip &&
              op.warpMode !== undefined
            )
              clip.warpMode = op.warpMode;
          });
        });

        // ── Phase 4: Create locators ─────────────────────────────────────────
        if (createLocators) {
          // In edit mode, delete any existing cue points within the old
          // arrangement range before placing the new ones.
          if (isEditMode) {
            const existingCuePoints = song.cuePoints.filter(
              (cp) =>
                cp.time >= startPosition && cp.time < arrangementOldEnd,
            );
            if (existingCuePoints.length > 0) {
              await api.withinTransaction(() =>
                Promise.all(
                  existingCuePoints.map((cp) => song.deleteCuePoint(cp)),
                ),
              );
            }
          }

          await api.withinTransaction(() =>
            Promise.all(
              newLayout.map((s) =>
                song
                  .createCuePoint(s.start)
                  .then((cuePoint) => { cuePoint.name = s.name; }),
              ),
            ),
          );
        }
      } catch (err) {
        console.error("[Arrangement Track] Error:", err);
      }
    },
  );

  api.ui.registerContextMenuAction(
    "MidiTrack.ArrangementSelection",
    "Create Arrangement Track\u2026",
    "arrangementHelper.buildStructure",
  );
}

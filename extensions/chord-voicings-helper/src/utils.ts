import type { NoteDescription } from "@ableton-extensions/sdk";
import { Note } from "tonal";

export function pitchToName(pitch: number): string {
  return Note.fromMidi(pitch) ?? `?${pitch}`;
}

export function pitchToClass(pitch: number): string {
  const name = Note.fromMidi(pitch);
  if (!name) return "C";
  // Strip octave number — keep just the note class, normalized to flats
  return Note.pitchClass(name) ?? name.replace(/\d/g, "");
}

export function nameToPitch(name: string): number {
  return Note.midi(name) ?? 60;
}

/**
 * Normalize a note class to use flats (safer for jazz/tonal contexts).
 * e.g. "D#" → "Eb", "G#" → "Ab"
 */
export function normalizeToFlat(noteClass: string): string {
  return Note.enharmonic(noteClass) === noteClass
    ? noteClass
    : Note.enharmonic(noteClass);
}

/**
 * Given original notes and new pitches, rebuild NoteDescriptions keeping
 * startTime, duration, velocity, muted, probability intact.
 * Matches by ascending sort order (lowest → highest).
 */
export function preserveTiming(
  originalNotes: NoteDescription[],
  newPitches: number[]
): NoteDescription[] {
  const sorted = [...originalNotes].sort((a, b) => a.pitch - b.pitch);
  const sortedPitches = [...newPitches].sort((a, b) => a - b);

  if (sortedPitches.length === sorted.length) {
    return sortedPitches.map((pitch, i): NoteDescription => ({
      ...sorted[i]!,
      pitch,
    }));
  }

  // Count mismatch: all new notes play simultaneously at the original chord's time
  if (sorted.length === 0) {
    return sortedPitches.map((pitch): NoteDescription => ({
      pitch,
      startTime: 0,
      duration: 0.5,
    }));
  }

  const minStart = Math.min(...sorted.map((n) => n.startTime));
  const totalDuration =
    Math.max(...sorted.map((n) => n.startTime + n.duration)) - minStart;
  const refNote = sorted[0]!;

  return sortedPitches.map((pitch): NoteDescription => ({
    ...refNote,
    pitch,
    startTime: minStart,
    duration: totalDuration > 0 ? totalDuration : refNote.duration,
  }));
}

/** Extract unique pitch classes from a set of MIDI pitches. */
export function uniquePitchClasses(pitches: number[]): string[] {
  const seen = new Set<number>();
  const classes: string[] = [];
  for (const p of pitches) {
    const pc = p % 12;
    if (!seen.has(pc)) {
      seen.add(pc);
      classes.push(pitchToClass(p));
    }
  }
  return classes;
}

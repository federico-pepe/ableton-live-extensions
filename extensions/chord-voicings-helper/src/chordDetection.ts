import { Chord, Note } from "tonal";
import type { NoteDescription } from "@ableton/extensions-sdk";
import { pitchToClass } from "./utils";

export interface ChordGroup {
  startTime: number;
  pitches: number[];
  noteIndices: number[]; // indices into the original NoteDescription[]
  candidates: string[];  // best match first; empty if unrecognised
}

/**
 * Group notes by start position and detect a chord for each group.
 * Notes within `tolerance` beats of each other are treated as simultaneous.
 */
export function groupChordsByTime(
  notes: NoteDescription[],
  tolerance = 0.05
): ChordGroup[] {
  if (notes.length === 0) return [];

  const indexed = notes.map((n, i) => ({ note: n, i }));
  indexed.sort((a, b) => a.note.startTime - b.note.startTime);

  const groups: ChordGroup[] = [];
  let bucket = [indexed[0]!];
  let bucketStart = indexed[0]!.note.startTime;

  for (let k = 1; k < indexed.length; k++) {
    const item = indexed[k]!;
    if (item.note.startTime - bucketStart <= tolerance) {
      bucket.push(item);
    } else {
      groups.push(makeGroup(bucketStart, bucket));
      bucket = [item];
      bucketStart = item.note.startTime;
    }
  }
  groups.push(makeGroup(bucketStart, bucket));

  return groups;
}

function makeGroup(
  startTime: number,
  items: { note: NoteDescription; i: number }[]
): ChordGroup {
  const pitches = items.map((x) => x.note.pitch);
  const noteIndices = items.map((x) => x.i);
  const candidates = detectChords(pitches);
  return { startTime, pitches, noteIndices, candidates };
}

/**
 * Detect chord names from MIDI pitches.
 * Returns all Tonal.js candidates, best match first.
 */
export function detectChords(pitches: number[]): string[] {
  if (pitches.length === 0) return [];

  // Normalize to flat enharmonics (safer for jazz)
  const noteClasses = pitches.map((p) => {
    const raw = pitchToClass(p);
    return normalizePitchClass(raw);
  });

  // Deduplicate
  const unique = [...new Set(noteClasses)];

  const candidates = Chord.detect(unique);
  return candidates.length > 0 ? candidates : [];
}

/**
 * Get chord tones (note classes) for a given chord symbol.
 * e.g. "Cm7" → ["C", "Eb", "G", "Bb"]
 */
export function getChordTones(chordName: string): string[] {
  const chord = Chord.get(chordName);
  if (chord.empty || chord.notes.length === 0) return [];
  return chord.notes.map(normalizePitchClass);
}

/**
 * Get the tonic of a chord symbol.
 * e.g. "Cm7" → "C"
 */
export function getChordTonic(chordName: string): string {
  const chord = Chord.get(chordName);
  return chord.tonic ? normalizePitchClass(chord.tonic) : "C";
}

/**
 * Get quality string for display.
 * e.g. "Cm7" → "Minor Seventh"
 */
export function getChordQuality(chordName: string): string {
  return Chord.get(chordName).quality ?? "";
}

/**
 * Normalize a pitch class to use flats consistently.
 * "D#" → "Eb", "G#" → "Ab", etc.
 */
function normalizePitchClass(pc: string): string {
  const sharpToFlat: Record<string, string> = {
    "C#": "Db",
    "D#": "Eb",
    "F#": "Gb",
    "G#": "Ab",
    "A#": "Bb",
  };
  return sharpToFlat[pc] ?? pc;
}

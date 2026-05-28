import { Note } from "tonal";
import { getChordTones, getChordTonic } from "./chordDetection";

export type Register = "low" | "mid" | "high";
export type VoicingStrategy =
  | "close"
  | "open"
  | "shell"
  | "drop2"
  | "drop3"
  | "guidetones";

export interface VoicingOptions {
  register?: Register;
}

const REGISTER_ROOT: Record<Register, number> = {
  low: 48,  // C3
  mid: 60,  // C4
  high: 72, // C5
};

/**
 * Place a set of note classes (e.g. ["C","E","G"]) into ascending MIDI pitches
 * starting from the given root MIDI pitch.
 */
function buildAscending(noteClasses: string[], rootPitch: number): number[] {
  if (noteClasses.length === 0) return [];

  const pitches: number[] = [];
  let cursor = rootPitch;

  for (const nc of noteClasses) {
    const pc = Note.chroma(nc) ?? 0;
    const cursorPc = cursor % 12;
    let semitones = pc - cursorPc;
    if (semitones < 0) semitones += 12;
    if (semitones === 0 && pitches.length > 0) semitones = 12;
    const pitch = cursor + semitones;
    pitches.push(pitch);
    cursor = pitch;
  }

  return pitches;
}

/**
 * Given a chord name and register, compute the root MIDI pitch so that
 * the root note lands near the center of the register.
 */
function rootPitchFor(chordName: string, register: Register): number {
  const tonic = getChordTonic(chordName);
  const tonicPc = Note.chroma(tonic) ?? 0;
  const base = REGISTER_ROOT[register];
  const basePc = base % 12;
  let offset = tonicPc - basePc;
  if (offset < 0) offset += 12;
  return base + offset;
}

// ─── Voicing strategies ───────────────────────────────────────────────────────

/** Stack all chord tones within one octave, ascending. */
export function closeVoicing(
  chordName: string,
  options: VoicingOptions = {}
): number[] {
  const register = options.register ?? "mid";
  const tones = getChordTones(chordName);
  if (tones.length === 0) return [];
  const root = rootPitchFor(chordName, register);
  return buildAscending(tones, root);
}

/** Spread tones across two octaves by alternating up/down from center. */
export function openVoicing(
  chordName: string,
  options: VoicingOptions = {}
): number[] {
  const register = options.register ?? "mid";
  const tones = getChordTones(chordName);
  if (tones.length === 0) return [];

  const root = rootPitchFor(chordName, register);
  const close = buildAscending(tones, root);

  if (close.length < 3) return close;

  // Move every other note (starting from index 1) up an octave
  return close.map((p, i) => (i % 2 === 1 ? p + 12 : p));
}

/** Root + 3rd + 7th. Falls back to root + 3rd for triads. */
export function shellVoicing(
  chordName: string,
  options: VoicingOptions = {}
): number[] {
  const register = options.register ?? "mid";
  const tones = getChordTones(chordName);
  if (tones.length === 0) return [];

  const root = rootPitchFor(chordName, register);
  const close = buildAscending(tones, root);

  if (close.length >= 4) {
    // root (index 0), 3rd (index 1), 7th (index 3)
    return [close[0]!, close[1]!, close[3]!];
  }
  if (close.length >= 2) {
    // root + 3rd
    return [close[0]!, close[1]!];
  }
  return close;
}

/** Drop 2: take close voicing, drop the second-highest note one octave. */
export function drop2Voicing(
  chordName: string,
  options: VoicingOptions = {}
): number[] {
  const close = closeVoicing(chordName, options);
  if (close.length < 3) return close;

  const result = [...close];
  const idx = result.length - 2; // second-highest
  result[idx] = (result[idx] ?? 0) - 12;
  return result.sort((a, b) => a - b);
}

/** Drop 3: take close voicing, drop the third-highest note one octave. */
export function drop3Voicing(
  chordName: string,
  options: VoicingOptions = {}
): number[] {
  const close = closeVoicing(chordName, options);
  if (close.length < 4) return close;

  const result = [...close];
  const idx = result.length - 3; // third-highest
  result[idx] = (result[idx] ?? 0) - 12;
  return result.sort((a, b) => a - b);
}

/** Guide tones: 3rd and 7th only. Falls back to 3rd if no 7th. */
export function guideTonesVoicing(
  chordName: string,
  options: VoicingOptions = {}
): number[] {
  const register = options.register ?? "mid";
  const tones = getChordTones(chordName);
  if (tones.length < 2) return [];

  const root = rootPitchFor(chordName, register);
  const close = buildAscending(tones, root);

  if (close.length >= 4) {
    return [close[1]!, close[3]!]; // 3rd and 7th
  }
  if (close.length >= 2) {
    return [close[1]!]; // just the 3rd
  }
  return [];
}

/** Dispatch to the appropriate strategy function. */
export function applyVoicing(
  strategy: VoicingStrategy,
  chordName: string,
  options: VoicingOptions = {}
): number[] {
  switch (strategy) {
    case "close":      return closeVoicing(chordName, options);
    case "open":       return openVoicing(chordName, options);
    case "shell":      return shellVoicing(chordName, options);
    case "drop2":      return drop2Voicing(chordName, options);
    case "drop3":      return drop3Voicing(chordName, options);
    case "guidetones": return guideTonesVoicing(chordName, options);
    default:           return closeVoicing(chordName, options);
  }
}

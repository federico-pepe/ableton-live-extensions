import { getChordTones } from "./chordDetection.js";
import { closeVoicing, type Register } from "./voicingEngine.js";
import { Note } from "tonal";

// ─── Inversion / variant generation ──────────────────────────────────────────

/**
 * Generate all inversions of a set of pitches by cycling the bottom note up
 * an octave repeatedly.
 */
function allInversions(pitches: number[]): number[][] {
  const results: number[][] = [];
  let current = [...pitches].sort((a, b) => a - b);
  for (let i = 0; i < pitches.length; i++) {
    results.push([...current]);
    // Rotate: move lowest note up an octave
    const lowest = current[0] ?? 0;
    current = [...current.slice(1), lowest + 12].sort((a, b) => a - b);
  }
  return results;
}

/**
 * Generate octave variants: shift the entire voicing ±1 octave.
 */
function octaveVariants(pitches: number[]): number[][] {
  return [
    pitches,
    pitches.map((p) => p + 12),
    pitches.map((p) => p - 12),
  ].filter((v) => v.every((p) => p >= 21 && p <= 108)); // stay on piano keyboard
}

/**
 * Expand a voicing into all inversions and octave variants.
 */
function expandCandidates(pitches: number[]): number[][] {
  const results: number[][] = [];
  for (const inv of allInversions(pitches)) {
    for (const variant of octaveVariants(inv)) {
      results.push(variant);
    }
  }
  return results;
}

// ─── Scoring helpers ──────────────────────────────────────────────────────────

/** Sum of minimum semitone distances from each current pitch to any next pitch. */
function totalMovement(current: number[], next: number[]): number {
  return current.reduce((sum, cp) => {
    const minDist = Math.min(...next.map((np) => Math.abs(np - cp)));
    return sum + minDist;
  }, 0);
}

/** Check for parallel 5ths or octaves between two voicings. */
function hasParallelFifthsOrOctaves(prev: number[], next: number[]): boolean {
  const sorted1 = [...prev].sort((a, b) => a - b);
  const sorted2 = [...next].sort((a, b) => a - b);
  const len = Math.min(sorted1.length, sorted2.length);

  for (let i = 0; i < len; i++) {
    for (let j = i + 1; j < len; j++) {
      const interval1 = Math.abs((sorted1[j] ?? 0) - (sorted1[i] ?? 0)) % 12;
      const interval2 = Math.abs((sorted2[j] ?? 0) - (sorted2[i] ?? 0)) % 12;
      // Motion is parallel if both voices move in the same direction
      const motion1 = (sorted2[i] ?? 0) - (sorted1[i] ?? 0);
      const motion2 = (sorted2[j] ?? 0) - (sorted1[j] ?? 0);
      if (
        Math.sign(motion1) === Math.sign(motion2) &&
        motion1 !== 0 &&
        (interval1 === 7 || interval1 === 0) &&
        interval1 === interval2
      ) {
        return true;
      }
    }
  }
  return false;
}

/** Penalty if voices leave comfortable range (roughly E2–G5). */
function registerPenalty(pitches: number[]): number {
  return pitches.reduce((pen, p) => {
    if (p < 40 || p > 79) return pen + 3;
    return pen;
  }, 0);
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Minimal Movement: pick the inversion/octave variant of the next chord's
 * close voicing that has the least total semitone distance from current pitches.
 */
export function minimalMovement(
  currentPitches: number[],
  nextChordName: string,
  register: Register = "mid"
): number[] {
  const base = closeVoicing(nextChordName, { register });
  if (base.length === 0) return [];

  const candidates = expandCandidates(base);
  let best: number[] = candidates[0] ?? base;
  let bestScore = Infinity;

  for (const candidate of candidates) {
    const score = totalMovement(currentPitches, candidate);
    if (score < bestScore) {
      bestScore = score;
      best = candidate;
    }
  }

  return best;
}

/**
 * Best Mix: enumerate all ways to place each chord tone within range of the
 * current pitches, then pick the combination with minimum total voice movement.
 *
 * Works chord-by-chord: pass the previous chord's result as `fromPitches` for
 * sequential voice leading across multiple chords.
 */
export function bestMix(
  fromPitches: number[],
  chordName: string,
  register: Register = "mid"
): number[] {
  const tones = getChordTones(chordName);
  if (tones.length === 0) return [];

  // No reference → fall back to close voicing
  if (fromPitches.length === 0) return closeVoicing(chordName, { register });

  const sorted = [...fromPitches].sort((a, b) => a - b);
  const lo = Math.max(24, sorted[0]! - 12);
  const hi = Math.min(96, sorted[sorted.length - 1]! + 12);

  // For each chord tone, collect all MIDI pitches in [lo, hi] with that chroma
  const pools: number[][] = tones.map((nc) => {
    const chroma = Note.chroma(nc) ?? 0;
    const pitches: number[] = [];
    for (let midi = lo; midi <= hi; midi++) {
      if (midi % 12 === chroma) pitches.push(midi);
    }
    return pitches;
  });

  // Enumerate all combinations and find the one with minimum movement
  const fallback = closeVoicing(chordName, { register });
  let best: number[] = fallback;
  let bestScore = Infinity;

  function enumerate(idx: number, current: number[]): void {
    if (idx === pools.length) {
      const voicing = [...current].sort((a, b) => a - b);
      const score = movementCost(sorted, voicing) + registerPenalty(voicing) * 0.3;
      if (score < bestScore) {
        bestScore = score;
        best = voicing;
      }
      return;
    }
    for (const pitch of pools[idx]!) {
      current.push(pitch);
      enumerate(idx + 1, current);
      current.pop();
    }
  }

  enumerate(0, []);
  return best;
}

/**
 * Total movement cost between two sorted voicings (pairwise by voice position).
 */
function movementCost(from: number[], to: number[]): number {
  const len = Math.min(from.length, to.length);
  let cost = 0;
  for (let i = 0; i < len; i++) cost += Math.abs((to[i] ?? 0) - (from[i] ?? 0));
  cost += Math.abs(from.length - to.length) * 8; // count mismatch penalty
  return cost;
}

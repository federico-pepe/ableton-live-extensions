/**
 * Guitar chord diagram renderer using vexchords (bundled by esbuild).
 * Falls back gracefully for chords not in the static map.
 */
import { ChordBox } from "vexchords";

export interface GuitarFingering {
  chord: [number, number][]; // [string, fret] pairs (1-indexed from low E)
  position?: number;         // starting fret position
  barres?: { fromString: number; toString: number; fret: number }[];
}

// Static fingering map — 50 most common jazz chord shapes
// Strings: 6=low E, 1=high e. Fret 0 = open, -1 = muted (x).
const FINGERINGS: Record<string, GuitarFingering> = {
  // Major 7
  "Cmaj7":  { chord: [[5,3],[4,2],[3,0],[2,0],[1,0]], position: 1 },
  "Dbmaj7": { chord: [[6,9],[5,8],[4,10],[3,10],[2,9]], position: 8 },
  "Dmaj7":  { chord: [[5,5],[4,4],[3,6],[2,6],[1,5]], position: 4 },
  "Ebmaj7": { chord: [[6,6],[5,5],[4,7],[3,7],[2,6]], position: 5 },
  "Emaj7":  { chord: [[6,0],[5,2],[4,1],[3,1],[2,0],[1,0]], position: 1 },
  "Fmaj7":  { chord: [[6,1],[5,3],[4,2],[3,2],[2,1],[1,0]], position: 1 },
  "Gbmaj7": { chord: [[6,2],[5,4],[4,3],[3,3],[2,2]], position: 1 },
  "Gmaj7":  { chord: [[6,3],[5,5],[4,4],[3,4],[2,3],[1,2]], position: 1 },
  "Abmaj7": { chord: [[6,4],[5,6],[4,5],[3,5],[2,4]], position: 1 },
  "Amaj7":  { chord: [[5,0],[4,2],[3,1],[2,1],[1,0]], position: 1 },
  "Bbmaj7": { chord: [[5,1],[4,3],[3,2],[2,2],[1,1]], position: 1 },
  "Bmaj7":  { chord: [[5,2],[4,4],[3,3],[3,3],[1,2]], position: 1 },

  // Minor 7
  "Cm7":  { chord: [[5,3],[4,1],[3,3],[2,4],[1,3]], position: 1 },
  "Dbm7": { chord: [[6,9],[5,7],[4,9],[3,9],[2,9]], position: 7 },
  "Dm7":  { chord: [[5,5],[4,3],[3,5],[2,6],[1,5]], position: 3 },
  "Ebm7": { chord: [[6,6],[5,4],[4,6],[3,6],[2,6]], position: 4 },
  "Em7":  { chord: [[6,0],[5,2],[4,0],[3,0],[2,0],[1,0]], position: 1 },
  "Fm7":  { chord: [[6,1],[5,3],[4,1],[3,1],[2,1],[1,1]], position: 1 },
  "Gbm7": { chord: [[6,2],[5,4],[4,2],[3,2],[2,2]], position: 1 },
  "Gm7":  { chord: [[6,3],[5,5],[4,3],[3,3],[2,3],[1,3]], position: 1 },
  "Abm7": { chord: [[6,4],[5,6],[4,4],[3,4],[2,4]], position: 1 },
  "Am7":  { chord: [[5,0],[4,2],[3,0],[2,1],[1,0]], position: 1 },
  "Bbm7": { chord: [[5,1],[4,3],[3,1],[2,2],[1,1]], position: 1 },
  "Bm7":  { chord: [[5,2],[4,4],[3,2],[2,3],[1,2]], position: 1 },

  // Dominant 7
  "C7":  { chord: [[5,3],[4,2],[3,3],[2,1],[1,0]], position: 1 },
  "D7":  { chord: [[5,5],[4,4],[3,5],[2,3],[1,2]], position: 3 },
  "E7":  { chord: [[6,0],[5,2],[4,0],[3,1],[2,0],[1,0]], position: 1 },
  "F7":  { chord: [[6,1],[5,3],[4,1],[3,2],[2,1],[1,1]], position: 1 },
  "G7":  { chord: [[6,3],[5,5],[4,3],[3,4],[2,3],[1,3]], position: 1 },
  "A7":  { chord: [[5,0],[4,2],[3,0],[2,2],[1,0]], position: 1 },
  "B7":  { chord: [[5,2],[4,4],[3,2],[2,4],[1,2]], position: 1 },
  "Bb7": { chord: [[5,1],[4,3],[3,1],[2,3],[1,1]], position: 1 },
  "Eb7": { chord: [[6,6],[5,8],[4,6],[3,7],[2,6]], position: 6 },
  "Gb7": { chord: [[6,2],[5,4],[4,2],[3,3],[2,2]], position: 2 },
  "Ab7": { chord: [[6,4],[5,6],[4,4],[3,5],[2,4]], position: 4 },

  // Minor 7 b5 (half-diminished)
  "Cm7b5":  { chord: [[5,3],[4,1],[3,3],[2,4],[1,2]], position: 1 },
  "Dm7b5":  { chord: [[5,5],[4,3],[3,4],[2,4],[1,3]], position: 3 },
  "Em7b5":  { chord: [[5,7],[4,5],[3,6],[2,6],[1,5]], position: 5 },
  "Am7b5":  { chord: [[5,0],[4,1],[3,0],[2,1],[1,0]], position: 1 },
  "Bm7b5":  { chord: [[5,2],[4,3],[3,2],[2,3],[1,2]], position: 2 },

  // Diminished 7
  "Cdim7": { chord: [[5,3],[4,4],[3,2],[2,3]], position: 1 },
  "Ddim7": { chord: [[5,5],[4,6],[3,4],[2,5]], position: 4 },
  "Edim7": { chord: [[5,7],[4,8],[3,6],[2,7]], position: 6 },
  "Adim7": { chord: [[5,0],[4,1],[3,2],[2,0]], position: 1 },
  "Bdim7": { chord: [[5,2],[4,3],[3,4],[2,2]], position: 2 },
};

/**
 * Render a guitar chord diagram into the given container element.
 * chordName: e.g. "Cm7", "G7", "Amaj7"
 */
export function renderGuitar(container: HTMLElement, chordName: string): void {
  container.innerHTML = "";

  const fingering = FINGERINGS[chordName];

  if (!fingering) {
    container.innerHTML = `<div style="color:#888;font-size:11px;padding:8px;text-align:center;">
      Guitar diagram not available for<br><strong>${chordName}</strong>
    </div>`;
    return;
  }

  try {
    const chordBox = new ChordBox(container, {
      width: 120,
      height: 140,
      showTuning: false,
      defaultColor: "#DDDDDD",
      bgColor: "transparent",
      strokeColor: "#DDDDDD",
      textColor: "#DDDDDD",
      fontFamily: "Lucida Grande, sans-serif",
      fontSize: 11,
      fontStyle: "normal",
      fontWeight: "normal",
      labelColor: "#222222",
      numStrings: 6,
      numFrets: 5,
    });

    chordBox.draw({
      chord: fingering.chord,
      position: fingering.position ?? 1,
      barres: fingering.barres ?? [],
    });
  } catch {
    container.innerHTML = `<div style="color:#888;font-size:11px;padding:8px;text-align:center;">
      Could not render diagram for <strong>${chordName}</strong>
    </div>`;
  }
}

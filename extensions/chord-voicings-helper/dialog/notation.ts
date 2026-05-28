/**
 * Minimal SVG staff notation renderer — no external dependencies.
 * Draws a treble/bass clef stave with noteheads at correct diatonic positions.
 */

const SVG_NS = "http://www.w3.org/2000/svg";
const LINE_SPACING = 8;    // px between staff lines
const NOTEHEAD_RX = 5;
const NOTEHEAD_RY = 3.5;
const LEDGER_HALF_WIDTH = 10;
const STAFF_COLOR = "#AAAAAA";
const NOTE_COLOR = "#FF8C00";
const ACCIDENTAL_COLOR = "#DDDDDD";

// Chromatic pitch class → diatonic step within octave (C=0)
// Accidentals are treated as their lower neighbour (flat convention)
const CHROMA_TO_DIA = [0, 0, 1, 1, 2, 3, 3, 4, 4, 5, 5, 6];

// Which chroma values have a flat accidental
const HAS_FLAT = new Set([1, 3, 6, 8, 10]);

function midiToDiatonicStep(midi: number): number {
  // Steps from E4 (midi 64), treble clef bottom line = step 0
  const octave = Math.floor(midi / 12) - 1;
  const chroma = midi % 12;
  const diaInOct = CHROMA_TO_DIA[chroma] ?? 0;
  return octave * 7 + diaInOct - 30; // E4 = 4*7+2 = 30
}

function el(tag: string): SVGElement {
  return document.createElementNS(SVG_NS, tag) as SVGElement;
}

function line(svg: SVGElement, x1: number, y1: number, x2: number, y2: number, color: string, width = 0.7): void {
  const l = el("line");
  l.setAttribute("x1", String(x1));
  l.setAttribute("y1", String(y1));
  l.setAttribute("x2", String(x2));
  l.setAttribute("y2", String(y2));
  l.setAttribute("stroke", color);
  l.setAttribute("stroke-width", String(width));
  svg.appendChild(l);
}

export function renderNotation(container: HTMLElement, pitches: number[]): void {
  container.innerHTML = "";

  if (pitches.length === 0) {
    container.innerHTML = `<div style="color:#888;font-size:11px;padding:8px;">No notes.</div>`;
    return;
  }

  const sorted = [...pitches].sort((a, b) => a - b);
  const lowest = sorted[0] ?? 60;
  const useBass = lowest < 48; // C3

  // If spanning both clefs, split into bass (< 60) and treble (>= 60)
  // For simplicity, render one stave covering the range
  const clef = useBass ? "bass" : "treble";

  // For bass clef, bottom line = G2 (midi 43), step 0
  // G2 = octave 2, chroma 7 (G), diatonic 4 → 2*7+4 = 18
  // E4 ref = 30, so bassBottomStep = 18 - 30 = -12 relative to E4
  // We'll use a separate reference for bass: bottom line of bass clef
  // Bass clef bottom line = G2 (midi 43)

  const TREBLE_BOTTOM_MIDI = 64; // E4
  const BASS_BOTTOM_MIDI = 43;   // G2

  function stepFromBottomLine(midi: number): number {
    const ref = clef === "bass" ? BASS_BOTTOM_MIDI : TREBLE_BOTTOM_MIDI;
    const refOct = Math.floor(ref / 12) - 1;
    const refDia = (CHROMA_TO_DIA[ref % 12] ?? 0) + refOct * 7;
    const noteOct = Math.floor(midi / 12) - 1;
    const noteDia = (CHROMA_TO_DIA[midi % 12] ?? 0) + noteOct * 7;
    return noteDia - refDia;
  }

  const width = 220;
  const height = 120;
  const staffLeft = 28;
  const staffRight = width - 10;
  const staffTop = 28; // top line Y
  const bottomLineY = staffTop + 4 * LINE_SPACING; // line 1 (bottom)

  const svg = el("svg");
  svg.setAttribute("width", String(width));
  svg.setAttribute("height", String(height));
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);

  // ── Staff lines ──────────────────────────────────────────────────────────
  for (let i = 0; i < 5; i++) {
    const y = staffTop + i * LINE_SPACING;
    line(svg, staffLeft, y, staffRight, y, STAFF_COLOR);
  }

  // ── Clef symbol ──────────────────────────────────────────────────────────
  const clefText = el("text");
  clefText.textContent = clef === "bass" ? "𝄢" : "𝄞";
  clefText.setAttribute("x", "2");
  clefText.setAttribute("y", clef === "bass" ? String(bottomLineY - 4) : String(staffTop + 30));
  clefText.setAttribute("font-size", clef === "bass" ? "26" : "46");
  clefText.setAttribute("fill", STAFF_COLOR);
  clefText.setAttribute("font-family", "serif");
  svg.appendChild(clefText);

  // ── Noteheads ────────────────────────────────────────────────────────────
  // Stack notes horizontally if they're on adjacent lines/spaces
  const steps = sorted.map(stepFromBottomLine);
  const noteX = staffLeft + 80;

  // Detect adjacent steps (would collide) → offset alternate ones right
  const xOffsets: number[] = new Array(sorted.length).fill(0);
  for (let i = 1; i < steps.length; i++) {
    if (Math.abs((steps[i] ?? 0) - (steps[i - 1] ?? 0)) <= 1) {
      xOffsets[i] = NOTEHEAD_RX * 2 + 2;
    }
  }

  // Ledger lines needed
  const drawnLedgers = new Set<number>();

  sorted.forEach((midi, i) => {
    const step = steps[i] ?? 0;
    const xOff = xOffsets[i] ?? 0;
    const cx = noteX + xOff;
    const cy = bottomLineY - step * (LINE_SPACING / 2);

    // Ledger lines below staff (step < 0, even steps are lines)
    for (let s = -2; s >= step; s -= 2) {
      if (!drawnLedgers.has(s)) {
        drawnLedgers.add(s);
        const ly = bottomLineY - s * (LINE_SPACING / 2);
        line(svg, cx - LEDGER_HALF_WIDTH, ly, cx + LEDGER_HALF_WIDTH, ly, STAFF_COLOR, 0.8);
      }
    }
    // Ledger lines above staff (step > 8)
    for (let s = 10; s <= step; s += 2) {
      if (!drawnLedgers.has(s)) {
        drawnLedgers.add(s);
        const ly = bottomLineY - s * (LINE_SPACING / 2);
        line(svg, cx - LEDGER_HALF_WIDTH, ly, cx + LEDGER_HALF_WIDTH, ly, STAFF_COLOR, 0.8);
      }
    }

    // Notehead
    const noteEl = el("ellipse");
    noteEl.setAttribute("cx", String(cx));
    noteEl.setAttribute("cy", String(cy));
    noteEl.setAttribute("rx", String(NOTEHEAD_RX));
    noteEl.setAttribute("ry", String(NOTEHEAD_RY));
    noteEl.setAttribute("fill", NOTE_COLOR);
    noteEl.setAttribute("transform", `rotate(-15 ${cx} ${cy})`);
    svg.appendChild(noteEl);

    // Accidental
    const chroma = midi % 12;
    if (HAS_FLAT.has(chroma)) {
      const acc = el("text");
      acc.textContent = "♭";
      acc.setAttribute("x", String(cx - NOTEHEAD_RX - 7));
      acc.setAttribute("y", String(cy + 3));
      acc.setAttribute("font-size", "10");
      acc.setAttribute("fill", ACCIDENTAL_COLOR);
      acc.setAttribute("font-family", "serif");
      svg.appendChild(acc);
    }
  });

  container.appendChild(svg);
}

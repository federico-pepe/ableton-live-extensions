/**
 * Pure SVG piano keyboard renderer.
 */

const WHITE_KEY_HEIGHT = 80;
const BLACK_KEY_HEIGHT = 50;

function blackOffsets(wkw: number, bkw: number): Record<number, number> {
  return {
    1:  wkw     - bkw / 2,  // C#
    3:  wkw * 2 - bkw / 2,  // D#
    6:  wkw * 4 - bkw / 2,  // F#
    8:  wkw * 5 - bkw / 2,  // G#
    10: wkw * 6 - bkw / 2,  // A#
  };
}

const WHITE_SEMITONES = [0, 2, 4, 5, 7, 9, 11];

const ACTIVE_COLOR = "#FF8C00";
const WHITE_DEFAULT = "#DDDDDD";
const BLACK_DEFAULT = "#222222";
const BORDER_COLOR = "#111111";

export function renderPiano(
  container: HTMLElement,
  activePitches: number[],
  options: { keyWidth?: number; numOctaves?: number; startMidi?: number } = {}
): void {
  const activeSet = new Set(activePitches);
  const numOctaves = options.numOctaves ?? 4;
  const startMidi = options.startMidi ?? 36; // C2 by default

  const numWhiteKeys = numOctaves * 7;
  const WHITE_KEY_WIDTH = options.keyWidth ??
    Math.max(14, Math.floor((container.clientWidth - 16) / numWhiteKeys));
  const BLACK_KEY_WIDTH = Math.round(WHITE_KEY_WIDTH * 0.58);
  const OFFSETS = blackOffsets(WHITE_KEY_WIDTH, BLACK_KEY_WIDTH);

  const width = numWhiteKeys * WHITE_KEY_WIDTH;
  const height = WHITE_KEY_HEIGHT + 10;

  const svg = mksvg("svg");
  svg.setAttribute("width", String(width));
  svg.setAttribute("height", String(height));
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);

  // White keys first
  for (let octave = 0; octave < numOctaves; octave++) {
    let wi = 0;
    for (const semitone of WHITE_SEMITONES) {
      const midi = startMidi + octave * 12 + semitone;
      const x = (octave * 7 + wi) * WHITE_KEY_WIDTH;
      const rect = mksvg("rect");
      rect.setAttribute("x", String(x));
      rect.setAttribute("y", "0");
      rect.setAttribute("width", String(WHITE_KEY_WIDTH - 1));
      rect.setAttribute("height", String(WHITE_KEY_HEIGHT));
      rect.setAttribute("fill", activeSet.has(midi) ? ACTIVE_COLOR : WHITE_DEFAULT);
      rect.setAttribute("stroke", BORDER_COLOR);
      rect.setAttribute("stroke-width", "1");
      rect.setAttribute("rx", "2");
      svg.appendChild(rect);
      wi++;
    }
  }

  // Black keys on top
  for (let octave = 0; octave < numOctaves; octave++) {
    const octaveX = octave * 7 * WHITE_KEY_WIDTH;
    for (const [semitoneStr, xOffset] of Object.entries(OFFSETS)) {
      const semitone = parseInt(semitoneStr, 10);
      const midi = startMidi + octave * 12 + semitone;
      const rect = mksvg("rect");
      rect.setAttribute("x", String(octaveX + xOffset));
      rect.setAttribute("y", "0");
      rect.setAttribute("width", String(BLACK_KEY_WIDTH));
      rect.setAttribute("height", String(BLACK_KEY_HEIGHT));
      rect.setAttribute("fill", activeSet.has(midi) ? ACTIVE_COLOR : BLACK_DEFAULT);
      rect.setAttribute("stroke", BORDER_COLOR);
      rect.setAttribute("stroke-width", "1");
      rect.setAttribute("rx", "1");
      svg.appendChild(rect);
    }
  }

  // Octave labels (C notes)
  for (let octave = 0; octave < numOctaves; octave++) {
    const x = octave * 7 * WHITE_KEY_WIDTH + 2;
    const midiC = startMidi + octave * 12;
    const octaveNum = Math.floor(midiC / 12) - 1;
    const label = mksvg("text");
    label.textContent = `C${octaveNum}`;
    label.setAttribute("x", String(x));
    label.setAttribute("y", String(WHITE_KEY_HEIGHT + 9));
    label.setAttribute("font-size", "8");
    label.setAttribute("fill", "#888888");
    label.setAttribute("font-family", "monospace");
    svg.appendChild(label);
  }

  svg.style.display = "block";
  svg.style.margin = "0 auto";
  container.innerHTML = "";
  container.appendChild(svg);
}

function mksvg(tag: string): SVGElement {
  return document.createElementNS("http://www.w3.org/2000/svg", tag) as SVGElement;
}

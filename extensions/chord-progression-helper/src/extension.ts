import {
  initialize,
  MidiTrack,
  type ActivationContext,
  type Handle,
} from "@ableton-extensions/sdk";
import { Scale, Note, Interval, Chord } from "tonal";
import dialogHtml from "./dialog.html";

// ── Types ──────────────────────────────────────────────────────────────────
interface ChordInfo {
  name: string;
  roman: string;
  notes: string;
  midiNotes: number[];
  sameAs?: string;
  neapolitan?: boolean;
}

interface ColumnData {
  secondary: ChordInfo | null;
  diatonic: ChordInfo;
  borrowed: ChordInfo | null;
}

// ── MIDI Voicings ──────────────────────────────────────────────────────────
const BASE_VOICINGS: Record<string, number[]> = {
  maj7:  [60, 64, 67, 71],
  m7:    [57, 60, 64, 67],
  "7":   [55, 59, 62, 65],
  m7b5:  [59, 62, 65, 69],
  dim7:  [62, 65, 68, 71],
  dim:   [68, 71, 74, 77],
  augM7: [60, 64, 68, 71],
};

const BASE_ROOT_CHROMA: Record<string, number> = {
  maj7: 0, m7: 9, "7": 7, m7b5: 11, dim7: 2, dim: 8, augM7: 0,
};

function buildVoicing(root: string, type: string): number[] {
  const base = BASE_VOICINGS[type] ?? BASE_VOICINGS["maj7"];
  const baseChroma = BASE_ROOT_CHROMA[type] ?? 0;
  const targetChroma = Note.chroma(root) ?? 0;
  let offset = targetChroma - baseChroma;
  if (offset < 0) offset += 12;
  return base.map((n) => n + offset);
}

function chordNotes(root: string, type: string): string {
  try {
    const c = Chord.get(root + type);
    if (c?.notes?.length) return c.notes.join(" ");
  } catch {}
  return "";
}

function makeChordInfo(
  root: string,
  type: string,
  roman: string,
  overrideName?: string,
  extra?: Partial<ChordInfo>
): ChordInfo {
  return {
    name: overrideName ?? root + type,
    roman,
    notes: chordNotes(root, type),
    midiNotes: buildVoicing(root, type),
    ...extra,
  };
}

// ── Progression II ─────────────────────────────────────────────────────────
const P2_DEGREE_IDX = [0, 5, 3, 1, 4, 2, 6];
const P2_DIA_TYPES  = ["maj7", "m7", "maj7", "m7", "7", "m7", "m7b5"];
const P2_DIA_ROMAN  = ["Imaj7", "vim7", "IVmaj7", "iim7", "V7", "iiim7", "vii°7"];
const P2_SEC_ROMAN  = ["V7/I", "V7/vi", "V7/IV", "V7/ii", "V7/V", "V7/iii", "V7/vii"];
const P2_BORROWED: ([number, string, string] | null)[] = [
  [3,  "maj7", "♭IIImaj7"],
  null,
  [8,  "maj7", "♭VImaj7"],
  [5,  "m7",   "ivm7"],
  [10, "7",    "♭VII7"],
  null,
  [2,  "m7b5", "iim7b5"],
];

function buildP2Columns(key: string): ColumnData[] {
  const scale = Scale.get(key + " major").notes;
  if (!scale || scale.length < 7) return [];

  return P2_DEGREE_IDX.map((degIdx, col) => {
    const diaRoot = Note.pitchClass(scale[degIdx]);
    const diaType = P2_DIA_TYPES[col];
    const secRoot = Note.pitchClass(Note.transpose(diaRoot + "4", "5P"));

    let borrowed: ChordInfo | null = null;
    const bd = P2_BORROWED[col];
    if (bd) {
      const bRoot = Note.pitchClass(
        Note.transpose(key + "4", Interval.fromSemitones(bd[0]))
      );
      borrowed = makeChordInfo(bRoot, bd[1], bd[2]);
    }

    return {
      secondary: makeChordInfo(secRoot, "7", P2_SEC_ROMAN[col]),
      diatonic:  makeChordInfo(diaRoot, diaType, P2_DIA_ROMAN[col]),
      borrowed,
    };
  });
}

// ── Dark Harmony ───────────────────────────────────────────────────────────
const DH_MID_INT   = [0, 3, 5, 8, 7, 11, 2];
const DH_MID_TYPES = ["m7", "augM7", "m7", "maj7", "7", "dim", "m7b5"];
const DH_MID_ROMAN = ["im7", "♭IIIaugM7", "ivm7", "♭VImaj7", "V7", "vii°", "ii°7"];
const DH_TOP_INT   = [6, 9, 0, 3];
const DH_BOT_INT   = [10, 1, 4, 7];
const DH_BOT_ROMAN = ["♭VIIdim7", "♭IIdim7", "♭IVdim7", "♭Vdim7"];

function buildDHColumns(key: string): ColumnData[] {
  const dim7Roots = DH_TOP_INT.map((st) =>
    Note.pitchClass(Note.transpose(key + "4", Interval.fromSemitones(st)))
  );
  const dim7SameAs = dim7Roots.map((r) => r + "dim7").join(" = ");

  return Array.from({ length: 7 }, (_, col) => {
    const midRoot = Note.pitchClass(
      Note.transpose(key + "4", Interval.fromSemitones(DH_MID_INT[col]))
    );

    let secondary: ChordInfo | null = null;
    if (col < 4) {
      secondary = makeChordInfo(dim7Roots[col], "dim7", "°7", undefined, {
        sameAs: dim7SameAs,
      });
    } else if (col === 4) {
      const secRoot = Note.pitchClass(
        Note.transpose(key + "4", Interval.fromSemitones(1))
      );
      const bassNote = Note.pitchClass(Note.transpose(secRoot + "4", "3M"));
      secondary = makeChordInfo(
        secRoot, "maj7", "♭IImaj7",
        `${secRoot}maj7/${bassNote}`,
        { neapolitan: true }
      );
    }

    let borrowed: ChordInfo | null = null;
    if (col < 4) {
      const botRoot = Note.pitchClass(
        Note.transpose(key + "4", Interval.fromSemitones(DH_BOT_INT[col]))
      );
      borrowed = makeChordInfo(botRoot, "dim7", DH_BOT_ROMAN[col]);
    }

    return {
      secondary,
      diatonic: makeChordInfo(midRoot, DH_MID_TYPES[col], DH_MID_ROMAN[col]),
      borrowed,
    };
  });
}

// ── Key lists ──────────────────────────────────────────────────────────────
const MAJOR_KEYS = ["C","Db","D","Eb","E","F","F#","G","Ab","A","Bb","B"];
const MINOR_KEYS = ["A","Bb","B","C","C#","D","Eb","E","F","F#","G","Ab"];

// ── Activation ─────────────────────────────────────────────────────────────
export function activate(activation: ActivationContext) {
  const context = initialize(activation, "1.0.0");

  // Pre-compute all grids for every key at startup
  const allP2: Record<string, ColumnData[]> = {};
  const allDH: Record<string, ColumnData[]> = {};
  for (const k of MAJOR_KEYS) allP2[k] = buildP2Columns(k);
  for (const k of MINOR_KEYS) allDH[k] = buildDHColumns(k);

  const allData = { p2: allP2, dh: allDH, majorKeys: MAJOR_KEYS, minorKeys: MINOR_KEYS };

  context.commands.registerCommand("cph.open", async (arg: unknown) => {
    const handle = arg as Handle;
    const track = context.getObjectFromHandle(handle, MidiTrack);

    // Bake pre-computed data into the dialog HTML
    const html = dialogHtml.replace(
      "/*__ALL_DATA__*/null",
      JSON.stringify(allData)
    );

    let resultJson: string;
    try {
      resultJson = await context.ui.showModalDialog(
        `data:text/html,${encodeURIComponent(html)}`,
        920,
        580
      );
    } catch (err) {
      console.error("[CPH] Dialog closed:", err);
      return;
    }

    let result: {
      action: string;
      progression: Array<{ name: string; roman: string; midiNotes: number[] }>;
    };
    try {
      result = JSON.parse(resultJson);
    } catch {
      return;
    }

    if (result.action !== "write" || !result.progression?.length) return;

    await writeProgressionToTrack(context, track, result.progression);
  });

  context.ui.registerContextMenuAction(
    "MidiTrack",
    "Create Chord Progression…",
    "cph.open"
  );
}

// ── Write MIDI clip ─────────────────────────────────────────────────────────
async function writeProgressionToTrack(
  context: ReturnType<typeof initialize>,
  track: MidiTrack<"1.0.0">,
  progression: Array<{ name: string; roman: string; midiNotes: number[] }>
): Promise<void> {
  const song = context.application.song;
  const midiTrack = song.tracks.find(
    (t) => t.handle.id === track.handle.id
  ) as MidiTrack<"1.0.0"> | undefined;

  if (!midiTrack) {
    console.error("[CPH] Track not found.");
    return;
  }

  const emptySlot = midiTrack.clipSlots.find((slot) => !slot.clip);
  if (!emptySlot) {
    console.error("[CPH] No empty clip slots on this track.");
    return;
  }

  const beatsPerBar = 4;
  const clip = await emptySlot.createMidiClip(progression.length * beatsPerBar);
  clip.name = progression.map((c) => c.name).join(" – ");

  const notes = [];
  for (let i = 0; i < progression.length; i++) {
    for (const pitch of progression[i].midiNotes) {
      notes.push({
        pitch,
        startTime: i * beatsPerBar,
        duration: beatsPerBar - 0.05,
        velocity: 80,
      });
    }
  }
  clip.notes = notes;

  console.log(`[CPH] Created "${clip.name}" — ${progression.length} chord(s).`);
}

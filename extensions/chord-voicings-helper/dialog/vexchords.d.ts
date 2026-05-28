declare module "vexchords" {
  export interface ChordBoxOptions {
    width?: number;
    height?: number;
    numStrings?: number;
    numFrets?: number;
    showTuning?: boolean;
    defaultColor?: string;
    bgColor?: string;
    strokeColor?: string;
    textColor?: string;
    fontFamily?: string;
    fontSize?: number;
    fontStyle?: string;
    fontWeight?: string;
    labelColor?: string;
    bridgeColor?: string;
    stringColor?: string;
    fretColor?: string;
    strokeWidth?: number;
    stringWidth?: number;
    fretWidth?: number;
  }

  export interface DrawOptions {
    chord: [number, number][];
    position?: number;
    barres?: { fromString: number; toString: number; fret: number }[];
    positionText?: number;
    tuning?: string[];
  }

  export class ChordBox {
    constructor(sel: string | HTMLElement, params?: ChordBoxOptions);
    draw(opts: DrawOptions): void;
  }
}

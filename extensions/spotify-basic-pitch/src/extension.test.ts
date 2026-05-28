import { describe, it, expect } from "vitest";

// Unit-testable helpers extracted from extension logic

function secondsToBeats(seconds: number, bpm: number): number {
  return (seconds / 60) * bpm;
}

describe("secondsToBeats", () => {
  it("converts correctly at 120 BPM", () => {
    expect(secondsToBeats(1, 120)).toBeCloseTo(2);
    expect(secondsToBeats(0.5, 120)).toBeCloseTo(1);
    expect(secondsToBeats(2, 120)).toBeCloseTo(4);
  });

  it("converts correctly at 60 BPM", () => {
    expect(secondsToBeats(1, 60)).toBeCloseTo(1);
    expect(secondsToBeats(4, 60)).toBeCloseTo(4);
  });

  it("handles fractional BPM", () => {
    expect(secondsToBeats(1, 90)).toBeCloseTo(1.5);
  });

  it("converts zero seconds to zero beats", () => {
    expect(secondsToBeats(0, 120)).toBe(0);
  });
});

describe("note velocity clamping", () => {
  function amplitudeToVelocity(amplitude: number): number {
    return Math.round(Math.min(127, Math.max(1, amplitude * 127)));
  }

  it("clamps to 1 at minimum", () => {
    expect(amplitudeToVelocity(0)).toBe(1);
    expect(amplitudeToVelocity(-1)).toBe(1);
  });

  it("clamps to 127 at maximum", () => {
    expect(amplitudeToVelocity(1)).toBe(127);
    expect(amplitudeToVelocity(2)).toBe(127);
  });

  it("maps mid-range amplitude correctly", () => {
    expect(amplitudeToVelocity(0.5)).toBe(64);
  });
});

import { describe, expect, it } from "vitest";

import { colorMix, getBgDark, getColorfulness, getHSP } from "../../lib/bar/utils.js";

describe("bar colour helpers", () => {
  it("measures perceived brightness from a triplet or separate channels", () => {
    expect(getHSP([0, 0, 0])).toBe(0);
    expect(getHSP([255, 255, 255])).toBeCloseTo(255);
    expect(getHSP(10, 128, 250)).toBe(getHSP([10, 128, 250]));
  });

  it("classifies Open Bar's default background as dark and white as light", () => {
    expect(getBgDark(31, 31, 31)).toBe(true);
    expect(getBgDark(255, 255, 255)).toBe(false);
  });

  it("mixes and clamps a channel", () => {
    expect(colorMix(100, 200, 0.5)).toBe(150);
    expect(colorMix(250, 200, -0.12)).toBe(255);
    expect(colorMix(5, 200, -0.12)).toBe(0);
  });

  it("measures colourfulness as the channel spread", () => {
    expect(getColorfulness([10, 10, 10])).toBe(0);
    expect(getColorfulness([0, 128, 255])).toBe(255);
  });
});

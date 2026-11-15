import { describe, expect, it } from "vitest";

import {
  DEFAULT_THEME,
  MIN_FILL_ALPHA,
  cssRgba,
  parseRgb,
  relativeLuminance,
  themeFromBar,
} from "../../lib/engine/island-theme.js";
import { islandOutline, islandPath } from "../../lib/engine/shape.js";

// Open Bar's defaults.
const OPEN_BAR = {
  bartype: "Floating",
  bgcolor: ["0.125", "0.125", "0.125"],
  bgalpha: 0.95,
  iscolor: ["0.125", "0.125", "0.125"],
  isalpha: 0.95,
  fgcolor: ["1.0", "1.0", "1.0"],
  fgalpha: 1.0,
  bcolor: ["1.0", "1.0", "1.0"],
  balpha: 0.85,
  bwidth: 2,
};

describe("island-theme", () => {
  it("parses Open Bar colour triplets defensively", () => {
    expect(parseRgb(["0.125", "0.5", "1"])).toEqual([0.125, 0.5, 1]);
    expect(parseRgb(["2", "-1", "0.5"])).toEqual([1, 0, 0.5]);
    expect(parseRgb(["x", "0", "0"])).toBe(null);
    expect(parseRgb(null)).toBe(null);
  });

  it("follows Open Bar's default dark bar", () => {
    expect(themeFromBar(OPEN_BAR)).toEqual({
      fill: [0.125, 0.125, 0.125, 0.95],
      fg: [1, 1, 1, 1],
      border: { color: [1, 1, 1, 0.85], width: 2 },
      light: false,
    });
  });

  it("uses the island colour for Islands and Trilands bars", () => {
    const t = themeFromBar({
      ...OPEN_BAR,
      bartype: "Islands",
      iscolor: ["0.2", "0.4", "0.6"],
      isalpha: 1,
    });
    expect(t.fill).toEqual([0.2, 0.4, 0.6, 1]);
  });

  it("keeps a nearly transparent bar's island readable", () => {
    expect(themeFromBar({ ...OPEN_BAR, bgalpha: 0.1 }).fill[3]).toBe(MIN_FILL_ALPHA);
    expect(themeFromBar({ ...OPEN_BAR, fgalpha: 0.1 }).fg[3]).toBe(0.6);
  });

  it("detects light bars and drops zero-width or transparent borders", () => {
    const light = themeFromBar({ ...OPEN_BAR, bgcolor: ["0.95", "0.95", "0.95"], fgcolor: null });
    expect(light.light).toBe(true);
    expect(light.fg.slice(0, 3)).toEqual([0, 0, 0]);
    expect(themeFromBar({ ...OPEN_BAR, bwidth: 0 }).border).toBe(null);
    expect(themeFromBar({ ...OPEN_BAR, balpha: 0 }).border).toBe(null);
    expect(themeFromBar({ ...OPEN_BAR, bwidth: 20 }).border.width).toBe(6);
  });

  it("falls back to the default theme without a usable background", () => {
    expect(themeFromBar({})).toBe(DEFAULT_THEME);
  });

  it("formats colours for St and computes luminance", () => {
    expect(cssRgba([1, 0.5, 0, 0.854321])).toBe("rgba(255, 128, 0, 0.854)");
    expect(relativeLuminance([1, 1, 1])).toBeCloseTo(1, 6);
    expect(relativeLuminance([0, 0, 0])).toBe(0);
  });
});

describe("islandOutline", () => {
  const geom = { width: 300, height: 32, radius: 14, ear: 6 };

  it("leaves out the top edge of an attached island", () => {
    const outline = islandOutline(geom);
    expect(outline[0]).toEqual({ op: "move", x: 312, y: 0 });
    expect(outline.some((c) => c.op === "close")).toBe(false);
    expect(outline.some((c) => c.op === "line" && c.y === 0)).toBe(false);
    expect(outline.length).toBe(islandPath(geom).length - 2);
  });

  it("outlines a floating island all round", () => {
    const p = { ...geom, style: "floating" };
    expect(islandOutline(p)).toEqual(islandPath(p));
  });
});

describe("merged shape", () => {
  it("is a rounded rectangle with separate top and bottom radii", () => {
    const cmds = islandPath({ width: 180, height: 26, radius: 18, topRadius: 0, style: "merged" });
    expect(cmds[0]).toEqual({ op: "move", x: 0, y: 0 }); // square top-left
    const bottomArcs = cmds.filter((c) => c.op === "arc" && c.r === 18);
    expect(bottomArcs.length).toBe(2);
    expect(
      islandOutline({ width: 180, height: 26, radius: 18, topRadius: 0, style: "merged" }),
    ).toEqual(cmds);
  });

  it("gives the top corners what height the bottom ones leave", () => {
    const cmds = islandPath({ width: 300, height: 30, radius: 20, topRadius: 20, style: "merged" });
    const radii = cmds.filter((c) => c.op === "arc").map((c) => c.r);
    expect(radii).toEqual([10, 20, 20, 10]);
  });
});

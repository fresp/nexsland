import { describe, expect, it } from "vitest";

import { islandPath, outerSize } from "../../lib/engine/shape.js";

/** Endpoint of each command, to check the outline is continuous. */
function endpoints(cmds) {
  return cmds
    .filter((c) => c.op !== "close")
    .map((c) =>
      c.op === "move" || c.op === "line"
        ? { x: c.x, y: c.y, start: null }
        : {
            x: c.xc + c.r * Math.cos(c.a2),
            y: c.yc + c.r * Math.sin(c.a2),
            start: { x: c.xc + c.r * Math.cos(c.a1), y: c.yc + c.r * Math.sin(c.a1) },
          },
    );
}

function expectContinuous(cmds) {
  const pts = endpoints(cmds);
  for (let i = 1; i < pts.length; i++) {
    if (pts[i].start) {
      expect(pts[i].start.x).toBeCloseTo(pts[i - 1].x, 6);
      expect(pts[i].start.y).toBeCloseTo(pts[i - 1].y, 6);
    }
  }
  // Closes back onto the starting point.
  expect(pts.at(-1).x).toBeCloseTo(pts[0].x, 6);
  expect(pts.at(-1).y).toBeCloseTo(pts[0].y, 6);
}

describe("shape", () => {
  it("attached outline is continuous, flat on top and spans body + ears", () => {
    const cmds = islandPath({ width: 300, height: 32, radius: 14, ear: 6 });
    expectContinuous(cmds);
    expect(cmds[1]).toEqual({ op: "line", x: 312, y: 0 });
    expect(Math.max(...endpoints(cmds).map((p) => p.y))).toBeCloseTo(32, 6);
  });

  it("floating outline is a continuous rounded rectangle", () => {
    expectContinuous(islandPath({ width: 260, height: 36, radius: 18, style: "floating" }));
  });

  it("clamps radii so tiny shapes stay valid", () => {
    const cmds = islandPath({ width: 20, height: 6, radius: 50, ear: 50 });
    expectContinuous(cmds);
    for (const c of cmds) if ("r" in c) expect(c.r).toBeLessThanOrEqual(3);
  });

  it("returns nothing for an empty body", () => {
    expect(islandPath({ width: 0, height: 10, radius: 4 })).toEqual([]);
  });

  it("outerSize adds ears only when attached", () => {
    expect(outerSize({ width: 300, height: 32, ear: 6 })).toEqual({
      width: 312,
      height: 32,
      ear: 6,
    });
    expect(outerSize({ width: 300, height: 32, ear: 6, style: "floating" })).toEqual({
      width: 300,
      height: 32,
      ear: 0,
    });
  });
});

import { describe, expect, it } from "vitest";

import { colorShade } from "../../lib/bar/utils.js";

// Upstream Open Bar's colorShade, verbatim, as the reference behaviour.
function upstreamColorShade(c, p) {
  var i = parseInt,
    r = Math.round,
    [a, b, c, d] = c.split(","),
    P = p < 0,
    t = P ? 0 : 255 * p,
    P = P ? 1 + p : 1 - p;
  return (
    "rgb" +
    (d ? "a(" : "(") +
    r(i(a[3] == "a" ? a.slice(5) : a.slice(4)) * P + t) +
    "," +
    r(i(b) * P + t) +
    "," +
    r(i(c) * P + t) +
    (d ? "," + d : ")")
  );
}

describe("colorShade", () => {
  it("matches upstream for rgb and rgba input across shade amounts", () => {
    const colors = [
      "rgb(10,128,250)",
      "rgb(0,0,0)",
      "rgb(255,255,255)",
      "rgba(40,80,120,0.5)",
      "rgba(200,10,90,1)",
    ];
    for (const color of colors) {
      for (const p of [-1, -0.6, -0.2, -0.05, 0, 0.05, 0.3, 0.75, 1]) {
        expect(colorShade(color, p)).toBe(upstreamColorShade(color, p));
      }
    }
  });
});

/*
 * This file is part of the Nexsland GNOME extension.
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Island outline geometry, GI-free so it is unit-testable. island.js replays the
 * commands on a Cairo context.
 *
 * "attached" (default) hangs the island from the bottom edge of the top bar, the
 * way a notch hangs from the top of a MacBook screen (the look Atoll uses): a flat
 * top, concave "ears" that flare into the bar, and rounded bottom corners. The ears
 * sit OUTSIDE the body, so the drawn width is body width + 2 * ear.
 *
 * "floating" is a plain rounded rectangle (pill when radius >= height / 2).
 *
 * "merged" takes over a pill-shaped bar island (the clock on an Islands bar): the
 * pill's own background and border are hidden and the island draws them, so pill
 * and island are one outline. The shape is the pill (`cap`, at the top, with round
 * ends) on top of a body that starts at the pill's vertical middle and may be
 * wider; where the body is wider its top corners (`topRadius`) show beside the
 * pill. As wide as the pill, it is simply a taller capsule.
 */

/**
 * @typedef {{ op: "move" | "line", x: number, y: number }
 *   | { op: "arc" | "arcNegative", xc: number, yc: number, r: number, a1: number, a2: number }
 *   | { op: "close" }} PathCommand
 */

const HALF_PI = Math.PI / 2;

/**
 * Drawn size for a body of `width` x `height`.
 * @param {{ width: number, height: number, ear?: number, style?: "attached" | "floating" }} p
 */
export function outerSize({ width, height, ear = 0, style = "attached" }) {
  // Only the attached style has ears; floating and merged are drawn as they are.
  const e = style === "attached" ? clampEar(ear, height) : 0;
  return { width: Math.max(0, width) + 2 * e, height: Math.max(0, height), ear: e };
}

function clampEar(ear, height) {
  return Math.max(0, Math.min(ear, height / 2));
}

/**
 * Outline of the island as path commands in the actor's coordinate space
 * (origin top-left of the drawn area, including ears).
 *
 * @param {{ width: number, height: number, radius: number, ear?: number, style?: "attached" | "floating" | "merged", topRadius?: number, cap?: { x: number, width: number, height: number } | null }} p
 *   width/height: body size; radius: bottom corner radius (all corners when floating);
 *   ear: concave top-corner radius (attached only); topRadius, cap: merged only.
 * @returns {PathCommand[]}
 */
export function islandPath({
  width,
  height,
  radius,
  ear = 0,
  style = "attached",
  topRadius = radius,
  cap = null,
}) {
  const W = Math.max(0, width);
  const H = Math.max(0, height);
  if (W === 0 || H === 0) return [];
  const r = Math.max(0, Math.min(radius, H / 2, W / 2));

  if (style === "merged" && cap) return mergedPath(W, H, radius, topRadius, cap);

  if (style === "floating" || style === "merged") {
    const rb = r;
    const rt = r;
    return [
      { op: "move", x: rt, y: 0 },
      { op: "line", x: W - rt, y: 0 },
      { op: "arc", xc: W - rt, yc: rt, r: rt, a1: -HALF_PI, a2: 0 },
      { op: "line", x: W, y: H - rb },
      { op: "arc", xc: W - rb, yc: H - rb, r: rb, a1: 0, a2: HALF_PI },
      { op: "line", x: rb, y: H },
      { op: "arc", xc: rb, yc: H - rb, r: rb, a1: HALF_PI, a2: Math.PI },
      { op: "line", x: 0, y: rt },
      { op: "arc", xc: rt, yc: rt, r: rt, a1: Math.PI, a2: Math.PI + HALF_PI },
      { op: "close" },
    ];
  }

  const e = clampEar(ear, H);
  const T = W + 2 * e; // total drawn width
  // Bottom corners must not climb into the ears.
  const b = Math.min(r, H - e);
  return [
    { op: "move", x: 0, y: 0 },
    { op: "line", x: T, y: 0 },
    // Right ear: concave quarter circle centred outside the body, (T,0) -> (T-e,e).
    { op: "arcNegative", xc: T, yc: e, r: e, a1: -HALF_PI, a2: -Math.PI },
    { op: "line", x: T - e, y: H - b },
    { op: "arc", xc: T - e - b, yc: H - b, r: b, a1: 0, a2: HALF_PI },
    { op: "line", x: e + b, y: H },
    { op: "arc", xc: e + b, yc: H - b, r: b, a1: HALF_PI, a2: Math.PI },
    { op: "line", x: e, y: e },
    // Left ear: (e,e) -> (0,0).
    { op: "arcNegative", xc: 0, yc: e, r: e, a1: 0, a2: -HALF_PI },
    { op: "close" },
  ];
}

/**
 * Pill on top of a body, clockwise from the pill's top-left. The pill's ends are
 * half circles of radius cap.height (its half height); the body's top edge lies on
 * their widest points, so where the body is no wider than the pill the sides run
 * straight on from the round ends.
 * @param {{ x: number, width: number, height: number }} cap
 *   x/width: the pill within the drawn width; height: its half height
 */
function mergedPath(W, H, radius, topRadius, cap) {
  const pr = Math.max(0, Math.min(cap.height, H, cap.width / 2));
  const x0 = Math.max(0, Math.min(cap.x, W));
  const x1 = Math.max(x0, Math.min(cap.x + cap.width, W));
  const bodyH = H - pr;
  const rb = Math.max(0, Math.min(radius, bodyH, W / 2));
  // Top corners only where the body shows beside the pill.
  const rt = Math.max(0, Math.min(topRadius, x0, W - x1, bodyH - rb));
  return [
    { op: "move", x: x0 + pr, y: 0 },
    { op: "line", x: x1 - pr, y: 0 },
    { op: "arc", xc: x1 - pr, yc: pr, r: pr, a1: -HALF_PI, a2: 0 },
    { op: "line", x: W - rt, y: pr },
    { op: "arc", xc: W - rt, yc: pr + rt, r: rt, a1: -HALF_PI, a2: 0 },
    { op: "line", x: W, y: H - rb },
    { op: "arc", xc: W - rb, yc: H - rb, r: rb, a1: 0, a2: HALF_PI },
    { op: "line", x: rb, y: H },
    { op: "arc", xc: rb, yc: H - rb, r: rb, a1: HALF_PI, a2: Math.PI },
    { op: "line", x: 0, y: pr + rt },
    { op: "arc", xc: rt, yc: pr + rt, r: rt, a1: Math.PI, a2: Math.PI + HALF_PI },
    { op: "line", x: x0, y: pr },
    { op: "arc", xc: x0 + pr, yc: pr, r: pr, a1: Math.PI, a2: Math.PI + HALF_PI },
    { op: "close" },
  ];
}

/**
 * The part of the outline that carries a border. For the attached style that is
 * the ears, sides and bottom but not the top edge, which meets the bar (whose own
 * border then appears to flow into the island). Floating islands are outlined all
 * round.
 * @param {Parameters<typeof islandPath>[0]} p
 * @returns {PathCommand[]}
 */
export function islandOutline(p) {
  const path = islandPath(p);
  if ((p.style ?? "attached") !== "attached" || path.length === 0) return path;
  // Attached: [move(0,0), line(T,0), ...edges..., close] -> start at (T,0), drop
  // the top line and the closing segment back along the top.
  const [, top, ...rest] = path;
  return [{ op: "move", x: top.x, y: top.y }, ...rest.filter((c) => c.op !== "close")];
}

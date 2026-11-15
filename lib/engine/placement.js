/*
 * This file is part of the Nexsland GNOME extension.
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Which monitor the island lives on, and how far below that monitor's top edge.
 */

/**
 * @param {{ mode: string, primaryIndex: number, focusIndex: number, nMonitors: number }} p
 *   mode "primary" (default) or "focused": the monitor of the focused window.
 */
export function islandMonitor({ mode, primaryIndex, focusIndex, nMonitors }) {
  if (
    mode === "focused" &&
    Number.isInteger(focusIndex) &&
    focusIndex >= 0 &&
    focusIndex < nMonitors
  ) {
    return focusIndex;
  }
  return primaryIndex;
}

/**
 * Distance from the monitor's top edge to where the island hangs.
 *
 * The top bar only exists on the primary monitor; elsewhere the island hangs from
 * the screen edge. On the primary monitor it hangs from the bar's visible bottom
 * edge (`panelTop` + `panelHeight`, relative to the monitor), which differs from
 * the panel box when the bar floats with a margin (Bar module, Open Bar). A bar
 * moved to the bottom of the screen leaves the island at the top edge.
 *
 * @param {{ monitorIndex: number, primaryIndex: number, panelTop?: number, panelHeight: number, monitorHeight?: number }} p
 */
export function topInset({
  monitorIndex,
  primaryIndex,
  panelTop = 0,
  panelHeight,
  monitorHeight = Infinity,
}) {
  if (monitorIndex !== primaryIndex) return 0;
  const top = Number.isFinite(panelTop) ? panelTop : 0;
  if (top > monitorHeight / 2) return 0; // bar at the bottom
  return Math.max(0, Math.round(top + panelHeight));
}

/**
 * The "notch" style: the island sits in the top bar itself, from the bar's top
 * edge (the screen edge for a bar without a margin), and is at least as tall as
 * the bar. null where there is no bar to sit in (another monitor, a hidden bar,
 * a bar at the bottom): the island then hangs from the screen edge as "attached".
 *
 * @param {{ monitorIndex: number, primaryIndex: number, panelTop?: number, panelHeight: number, monitorHeight?: number }} p
 * @returns {{ top: number, height: number } | null}
 */
export function notchPlacement({
  monitorIndex,
  primaryIndex,
  panelTop = 0,
  panelHeight,
  monitorHeight = Infinity,
}) {
  if (monitorIndex !== primaryIndex) return null;
  const top = Number.isFinite(panelTop) ? Math.max(0, Math.round(panelTop)) : 0;
  const height = Math.round(panelHeight);
  if (!(height > 0) || top > monitorHeight / 2) return null;
  return { top, height };
}

/**
 * Size of a notch-style island for content of `target` size: never shorter than
 * the bar. While it fits in the bar it keeps the notch's own corner and ear
 * radii, so idle, HUDs and activities all read as the same notch; taller (the
 * open panel) it takes the content's radius.
 *
 * @param {{ target: { width: number, height: number, radius?: number, ear?: number }, barHeight: number }} p
 */
export function notchSize({ target, barHeight }) {
  const inBar = target.height <= barHeight;
  return {
    width: target.width,
    height: Math.max(target.height, barHeight),
    radius: inBar ? Math.min(NOTCH_RADIUS, barHeight / 2) : (target.radius ?? target.height / 2),
    ear: Math.max(target.ear ?? 0, NOTCH_EAR),
  };
}

const NOTCH_RADIUS = 14;
const NOTCH_EAR = 8;

/**
 * Placement of an island merged with a pill-shaped anchor (the clock island of an
 * Islands/Trilands bar). The island covers the pill and draws it (lib/engine/
 * shape.js, "merged"), with its body starting at the pill's vertical middle; it is
 * at least as wide as the pill and centred on it.
 *
 * @param {{ anchor: { x: number, y: number, width: number, height: number }, width: number }} p
 *   width: the island's own (content) width
 * @returns {{ overlap: number, cap: { x: number, width: number, height: number }, width: number, x: number, y: number }}
 *   overlap: how far down the content starts (below the pill); cap: the pill within
 *   the island, for the shape
 */
export function mergedPlacement({ anchor, width }) {
  const pillWidth = Math.round(anchor.width);
  const bodyWidth = Math.max(Math.round(width), pillWidth);
  const x = Math.round(anchor.x + (anchor.width - bodyWidth) / 2);
  return {
    overlap: Math.round(anchor.height),
    cap: {
      x: Math.round(anchor.x) - x,
      width: pillWidth,
      height: Math.round(anchor.height / 2),
    },
    width: bodyWidth,
    x,
    y: Math.round(anchor.y),
  };
}

/**
 * Placement of an island that takes a pill-shaped bar island's place (the clock's,
 * with clock-in-island): from the pill's top edge, at least as wide as the pill
 * and centred on it.
 * @param {{ anchor: { x: number, y: number, width: number, height: number }, width: number }} p
 */
export function pillPlacement({ anchor, width }) {
  const bodyWidth = Math.max(Math.round(width), Math.round(anchor.width));
  return {
    width: bodyWidth,
    x: Math.round(anchor.x + (anchor.width - bodyWidth) / 2),
    y: Math.round(anchor.y),
  };
}

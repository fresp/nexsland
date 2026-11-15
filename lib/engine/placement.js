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
 * Placement of an island merged with a pill-shaped anchor (the clock island of an
 * Islands/Trilands bar). The island starts at the pill's vertical middle, behind
 * it, so its straight sides continue the pill's round ends; it is at least as wide
 * as the pill and centred on it. `overlap` is how much of the island's height is
 * hidden behind the pill (content goes below it).
 *
 * @param {{ anchor: { x: number, y: number, width: number, height: number }, width: number }} p
 *   width: the island's own (content) width
 */
export function mergedPlacement({ anchor, width }) {
  const overlap = Math.round(anchor.height / 2);
  const bodyWidth = Math.max(width, Math.round(anchor.width));
  return {
    overlap,
    width: bodyWidth,
    x: Math.round(anchor.x + (anchor.width - bodyWidth) / 2),
    y: Math.round(anchor.y + anchor.height - overlap),
    // Square top corners while exactly as wide as the pill (they are behind it);
    // rounded once the island is wider and its top corners show beside the pill.
    squareTop: bodyWidth <= Math.round(anchor.width) + 1,
  };
}

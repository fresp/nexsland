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

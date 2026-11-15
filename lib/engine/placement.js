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

/** The top bar only exists on the primary monitor; elsewhere the island hangs from the edge. */
export function topInset({ monitorIndex, primaryIndex, panelHeight }) {
  return monitorIndex === primaryIndex ? Math.max(0, panelHeight) : 0;
}

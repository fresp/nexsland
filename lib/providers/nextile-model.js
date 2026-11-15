/*
 * This file is part of the Nexsland GNOME extension.
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * GI-free side of the NexTile integration. NexTile exports
 * org.gnome.Shell.Extensions.NexTile.Control on GNOME Shell's bus name when the
 * user turns on its external control; GetState() returns JSON:
 *   { tiling, workspace, scratchpad: { windows, hidden },
 *     focus: { wmClass, floating, layout } | null }
 */

export const NEXTILE_BUS_NAME = "org.gnome.Shell";
export const NEXTILE_PATH = "/org/gnome/Shell/Extensions/NexTile";
export const NEXTILE_IFACE = "org.gnome.Shell.Extensions.NexTile.Control";

/** Actions the Tiling tab offers, by NexTile keybinding key. */
export const NEXTILE_ACTIONS = Object.freeze([
  "prefs-tiling-toggle",
  "con-split-layout-toggle",
  "con-tabbed-layout-toggle",
  "con-stacked-layout-toggle",
  "window-toggle-float",
  "workspace-monocle-toggle",
]);

/** @returns {{ tiling: boolean, workspace: number, scratchpad: { windows: number, hidden: number }, focus: { wmClass: string, floating: boolean, layout: string | null } | null } | null} */
export function parseNexTileState(json) {
  let raw;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object") return null;
  const f = raw.focus;
  return {
    tiling: raw.tiling === true,
    workspace: Number.isInteger(raw.workspace) ? raw.workspace : 0,
    scratchpad: {
      windows: Number(raw.scratchpad?.windows) || 0,
      hidden: Number(raw.scratchpad?.hidden) || 0,
    },
    focus:
      f && typeof f === "object"
        ? {
            wmClass: typeof f.wmClass === "string" ? f.wmClass : "",
            floating: f.floating === true,
            layout: typeof f.layout === "string" ? f.layout : null,
          }
        : null,
  };
}

/**
 * Changes worth a HUD. Layout and float changes only count for the same focused
 * window class on the same workspace, so moving focus is not reported as a change.
 * @returns {({ kind: "tiling", on: boolean } | { kind: "layout", layout: string } | { kind: "float", floating: boolean })[]}
 */
export function nextileEvents(prev, next) {
  if (!prev || !next) return [];
  const events = [];
  if (prev.tiling !== next.tiling) events.push({ kind: "tiling", on: next.tiling });
  const a = prev.focus;
  const b = next.focus;
  if (a && b && a.wmClass === b.wmClass && prev.workspace === next.workspace) {
    if (b.layout && a.layout !== b.layout) events.push({ kind: "layout", layout: b.layout });
    if (a.floating !== b.floating) events.push({ kind: "float", floating: b.floating });
  }
  return events;
}

/** Reachability from a D-Bus error name. */
export function statusFromErrorName(name) {
  if (typeof name !== "string") return "error";
  if (name.endsWith("NexTile.Error.Disabled")) return "disabled";
  if (
    name === "org.freedesktop.DBus.Error.UnknownMethod" ||
    name === "org.freedesktop.DBus.Error.UnknownObject" ||
    name === "org.freedesktop.DBus.Error.UnknownInterface"
  ) {
    return "absent";
  }
  return "error";
}

/*
 * This file is part of the Nexsland GNOME extension.
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * GI-free classification of GNOME Shell OSD requests. gnome-settings-daemon and
 * the shell's own sliders call Main.osdWindowManager.show(monitor, icon, label,
 * level, maxLevel) with a themed icon name and a level in [0, maxLevel] where 1.0
 * is 100% (maxLevel is 1.5 when volume over-amplification is on).
 */

/** @typedef {"volume" | "microphone" | "brightness" | "keyboard-brightness"} OsdKind */

const KIND_BY_ICON_PREFIX = [
  ["audio-volume-", "volume"],
  ["audio-headphones", "volume"],
  ["audio-speakers", "volume"],
  ["microphone-sensitivity-", "microphone"],
  ["audio-input-microphone", "microphone"],
  ["keyboard-brightness", "keyboard-brightness"],
  ["display-brightness", "brightness"],
];

/** First themed icon name in a serialized GIcon string, e.g. ". GThemedIcon a b" -> "a". */
export function iconName(iconString) {
  if (typeof iconString !== "string" || iconString === "") return "";
  const parts = iconString.trim().split(/\s+/);
  if (parts[0] === "." && parts[1] === "GThemedIcon") return parts[2] ?? "";
  return parts[0];
}

/**
 * @param {{ icon: string, level?: number | null, maxLevel?: number | null }} req
 *   icon: themed icon name or serialized GIcon string
 * @returns {{ kind: OsdKind, icon: string, percent: number, fraction: number, muted: boolean, overAmplified: boolean } | null}
 *   null when Nexsland should leave the request to the stock OSD (no level, or an
 *   icon it does not recognize, such as caps lock or a keyboard layout switch).
 */
export function classifyOsd({ icon, level, maxLevel }) {
  if (typeof level !== "number" || !Number.isFinite(level)) return null;
  const name = iconName(icon);
  const match = KIND_BY_ICON_PREFIX.find(([prefix]) => name.startsWith(prefix));
  if (!match) return null;

  const max = typeof maxLevel === "number" && maxLevel > 0 ? maxLevel : 1;
  const clamped = Math.min(Math.max(level, 0), max);
  return {
    kind: /** @type {OsdKind} */ (match[1]),
    icon: name,
    percent: Math.round(clamped * 100),
    fraction: clamped / max,
    muted: name.includes("muted") || clamped === 0,
    overAmplified: clamped > 1,
  };
}

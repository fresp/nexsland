/*
 * This file is part of the Nexsland GNOME extension.
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Compact HUD actors shared by temporary activities. They fit the closed island
 * body (300 x 32): icon on the left, content, value on the right.
 */

import Clutter from "gi://Clutter";
import St from "gi://St";

/** Closed-island geometry for HUDs; matches Now Playing's closed size. */
export const HUD_SIZE = Object.freeze({ width: 300, height: 32, radius: 14, ear: 6 });

const TRACK_WIDTH = 190;
const BATTERY_FILL_MAX = 17;

/** @type {WeakMap<object, { icon: any, fill: any, value: any }>} */
const levelParts = new WeakMap();

/**
 * Icon + level bar + percentage.
 * @param {{ icon: string, fraction: number, percent: number, overAmplified?: boolean }} level
 */
export function buildLevelHud(level) {
  const box = new St.BoxLayout({ style_class: "nexsland-hud", x_expand: true });
  const icon = new St.Icon({ icon_size: 16, y_align: Clutter.ActorAlign.CENTER });
  const track = new St.Widget({
    style_class: "nexsland-hud-track",
    width: TRACK_WIDTH,
    y_align: Clutter.ActorAlign.CENTER,
    layout_manager: new Clutter.BinLayout(),
  });
  const fill = new St.Widget({
    style_class: "nexsland-hud-fill",
    x_align: Clutter.ActorAlign.START,
    y_expand: true,
  });
  track.add_child(fill);
  const value = new St.Label({
    style_class: "nexsland-hud-value",
    x_expand: true,
    x_align: Clutter.ActorAlign.END,
    y_align: Clutter.ActorAlign.CENTER,
  });
  box.add_child(icon);
  box.add_child(track);
  box.add_child(value);
  levelParts.set(box, { icon, fill, value });
  updateLevelHud(box, level, false);
  return box;
}

/** Patch a level HUD in place; the bar eases to its new width. */
export function updateLevelHud(actor, level, animate = true) {
  const parts = levelParts.get(actor);
  if (!parts) return;
  parts.icon.icon_name = level.icon;
  parts.value.text = `${level.percent}`;
  if (level.overAmplified) parts.fill.add_style_class_name("over");
  else parts.fill.remove_style_class_name("over");
  const width = Math.round(TRACK_WIDTH * Math.min(Math.max(level.fraction, 0), 1));
  parts.fill.remove_all_transitions();
  if (animate) {
    parts.fill.ease({ width, duration: 120, mode: Clutter.AnimationMode.EASE_OUT_QUAD });
  } else {
    parts.fill.width = width;
  }
}

/**
 * Icon + message on the left, percentage + battery glyph on the right.
 * @param {{ icon: string, text: string, percent: number, tone: "accent" | "plain" | "warn" | "alert" }} p
 */
export function buildBatteryHud({ icon, text, percent, tone }) {
  const box = new St.BoxLayout({
    style_class: `nexsland-hud nexsland-tone-${tone}`,
    x_expand: true,
  });
  box.add_child(
    new St.Icon({
      icon_name: icon,
      icon_size: 16,
      style_class: "nexsland-hud-icon",
      y_align: Clutter.ActorAlign.CENTER,
    }),
  );
  box.add_child(
    new St.Label({
      text,
      style_class: "nexsland-hud-text",
      x_expand: true,
      y_align: Clutter.ActorAlign.CENTER,
    }),
  );
  box.add_child(
    new St.Label({
      text: `${Math.round(percent)}%`,
      style_class: "nexsland-hud-value nexsland-hud-tinted",
      y_align: Clutter.ActorAlign.CENTER,
    }),
  );
  const glyph = new St.Widget({
    style_class: "nexsland-batt",
    y_align: Clutter.ActorAlign.CENTER,
    layout_manager: new Clutter.BinLayout(),
  });
  glyph.add_child(
    new St.Widget({
      style_class: "nexsland-batt-fill",
      width: Math.max(1, Math.round((BATTERY_FILL_MAX * Math.min(percent, 100)) / 100)),
      x_align: Clutter.ActorAlign.START,
      y_expand: true,
    }),
  );
  box.add_child(glyph);
  return box;
}

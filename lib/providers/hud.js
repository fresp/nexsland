/*
 * This file is part of the Nexsland GNOME extension.
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Compact HUD actors shared by temporary activities. They fit the closed island
 * body (300 x 32): icon on the left, content, value on the right.
 */

import Clutter from "gi://Clutter";
import Pango from "gi://Pango";
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
  const track = new St.BoxLayout({
    style_class: "nexsland-hud-track",
    width: TRACK_WIDTH,
    y_align: Clutter.ActorAlign.CENTER,
  });
  const fill = new St.Widget({
    style_class: "nexsland-hud-fill",
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
  const glyph = new St.BoxLayout({
    style_class: "nexsland-batt",
    y_align: Clutter.ActorAlign.CENTER,
  });
  glyph.add_child(
    new St.Widget({
      style_class: "nexsland-batt-fill",
      width: Math.max(1, Math.round((BATTERY_FILL_MAX * Math.min(percent, 100)) / 100)),
      y_expand: true,
    }),
  );
  box.add_child(glyph);
  return box;
}

/** @type {WeakMap<object, { label: any, detail: any }>} */
const infoParts = new WeakMap();

/**
 * Icon + text on the left, short detail on the right (Bluetooth, network, DND).
 * @param {{ icon: string, text: string, detail?: string, tone?: "accent" | "plain" | "warn" | "alert" }} p
 */
export function buildInfoHud({ icon, text, detail = "", tone = "plain" }) {
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
  const label = new St.Label({
    text,
    style_class: "nexsland-hud-text",
    x_expand: true,
    y_align: Clutter.ActorAlign.CENTER,
  });
  label.clutter_text.ellipsize = Pango.EllipsizeMode.END;
  box.add_child(label);
  const detailLabel = new St.Label({
    text: detail,
    visible: detail !== "",
    style_class: "nexsland-hud-detail nexsland-hud-tinted",
    y_align: Clutter.ActorAlign.CENTER,
  });
  box.add_child(detailLabel);
  infoParts.set(box, { label, detail: detailLabel });
  return box;
}

/** Patch an info HUD's text and detail in place. */
export function updateInfoHud(actor, { text, detail = "" }) {
  const parts = infoParts.get(actor);
  if (!parts) return;
  parts.label.text = text;
  parts.detail.text = detail;
  parts.detail.visible = detail !== "";
}

/** Narrower closed island for short live chips (recording timer). */
export const CHIP_SIZE = Object.freeze({ width: 220, height: 32, radius: 14, ear: 6 });

/** @type {WeakMap<object, { time: any }>} */
const recordingParts = new WeakMap();

/**
 * Pulsing red dot, elapsed time, stop button.
 * @param {string} elapsed
 * @param {() => void} onStop
 * @param {string} stopLabel accessible name of the stop button
 */
export function buildRecordingChip(elapsed, onStop, stopLabel) {
  const box = new St.BoxLayout({ style_class: "nexsland-hud nexsland-recording", x_expand: true });
  const dot = new St.Widget({
    style_class: "nexsland-rec-dot",
    y_align: Clutter.ActorAlign.CENTER,
  });
  if (St.Settings.get().enable_animations) {
    dot.ease({
      opacity: 90,
      duration: 900,
      mode: Clutter.AnimationMode.EASE_IN_OUT_SINE,
      repeatCount: -1,
      autoReverse: true,
    });
  }
  const time = new St.Label({
    text: elapsed,
    style_class: "nexsland-hud-text nexsland-rec-time",
    x_expand: true,
    y_align: Clutter.ActorAlign.CENTER,
  });
  const stop = new St.Button({
    style_class: "nexsland-rec-stop",
    can_focus: true,
    accessible_name: stopLabel,
    y_align: Clutter.ActorAlign.CENTER,
    child: new St.Widget({ style_class: "nexsland-rec-stop-glyph" }),
  });
  // eslint-disable-next-line local/no-untracked-connect -- actor-lifetime-bound: freed with the button
  stop.connect("clicked", () => {
    onStop();
    return Clutter.EVENT_STOP;
  });
  box.add_child(dot);
  box.add_child(time);
  box.add_child(stop);
  recordingParts.set(box, { time });
  return box;
}

export function updateRecordingChip(actor, elapsed) {
  const parts = recordingParts.get(actor);
  if (parts) parts.time.text = elapsed;
}

/** @type {WeakMap<object, { time: any, icon: any }>} */
const timerParts = new WeakMap();

/** Amber countdown chip for a running (or paused) timer. */
export function buildTimerChip(text, paused) {
  const box = new St.BoxLayout({ style_class: "nexsland-hud nexsland-timer-chip", x_expand: true });
  const icon = new St.Icon({
    icon_size: 16,
    style_class: "nexsland-timer-icon",
    y_align: Clutter.ActorAlign.CENTER,
  });
  const time = new St.Label({
    style_class: "nexsland-timer-chip-time",
    x_expand: true,
    x_align: Clutter.ActorAlign.END,
    y_align: Clutter.ActorAlign.CENTER,
  });
  box.add_child(icon);
  box.add_child(time);
  timerParts.set(box, { time, icon });
  updateTimerChip(box, text, paused);
  return box;
}

export function updateTimerChip(actor, text, paused) {
  const parts = timerParts.get(actor);
  if (!parts) return;
  parts.time.text = text;
  parts.icon.icon_name = paused ? "media-playback-pause-symbolic" : "alarm-symbolic";
}

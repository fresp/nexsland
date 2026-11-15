/*
 * This file is part of the Nexsland GNOME extension.
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The clock the island shows in place of the top bar's (clock-in-island): the
 * shell's own wall clock text, which follows GNOME's clock settings (12/24h,
 * date, weekday, seconds), and the same unread-notifications / Do Not Disturb
 * indicator the top bar's clock carries.
 *
 * The idle face can carry a line of the user's own text before the time
 * (clock-text), e.g. a verse or a reminder; it is cut short with an ellipsis past
 * a maximum width (stylesheet), and repeated under the time in the panel header.
 *
 * One ClockFace serves any number of actors (the idle island, the panel header);
 * each is built on demand and dropped when it is destroyed. onChanged runs after
 * they are updated, so the island can resize to the new text.
 */

import Clutter from "gi://Clutter";
import Pango from "gi://Pango";
import Gio from "gi://Gio";
import GLib from "gi://GLib";
import GnomeDesktop from "gi://GnomeDesktop";
import St from "gi://St";
import * as Main from "resource:///org/gnome/shell/ui/main.js";

import { vbox } from "../shared/compat.js";
import { SignalTracker } from "../shared/signals.js";

export class ClockFace {
  constructor() {
    this._text = "";
    /** @type {(() => void) | null} */
    this.onChanged = null;
    this._clock = new GnomeDesktop.WallClock();
    this._notifications = new Gio.Settings({ schema_id: "org.gnome.desktop.notifications" });
    this._interface = new Gio.Settings({ schema_id: "org.gnome.desktop.interface" });
    this._signals = new SignalTracker();
    /** @type {Map<any, SignalTracker>} */
    this._sourceSignals = new Map();
    /** @type {Set<{ update: () => void }>} */
    this._views = new Set();
    this._unread = 0;

    this._signals.track(this._clock, "notify::clock", () => this._update());
    this._signals.track(this._notifications, "changed::show-banners", () => this._update());
    this._signals.track(this._interface, "changed::clock-format", () => this._update());
    const tray = Main.messageTray;
    this._signals.track(tray, "source-added", (_tray, source) => this._watch(source));
    this._signals.track(tray, "source-removed", (_tray, source) => {
      this._sourceSignals.get(source)?.disconnectAll();
      this._sourceSignals.delete(source);
      this._countUnread();
    });
    this._signals.track(tray, "queue-changed", () => this._countUnread());
    for (const source of tray.getSources()) this._watch(source);
    this._countUnread();
  }

  destroy() {
    this._signals.disconnectAll();
    for (const tracker of this._sourceSignals.values()) tracker.disconnectAll();
    this._sourceSignals.clear();
    this._views.clear();
    this._clock?.run_dispose();
    this._clock = null;
    this._notifications = null;
    this._interface = null;
  }

  _watch(source) {
    if (this._sourceSignals.has(source)) return;
    const tracker = new SignalTracker();
    tracker.track(source, "notify::count", () => this._countUnread());
    this._sourceSignals.set(source, tracker);
    this._countUnread();
  }

  /** As the top bar's indicator counts: unseen notifications not waiting for a banner. */
  _countUnread() {
    let count = 0;
    for (const source of Main.messageTray.getSources()) count += source.unseenCount ?? 0;
    this._unread = count - (Main.messageTray.queueCount ?? 0);
    this._update();
  }

  get _indicatorIcon() {
    if (!this._notifications) return null;
    if (!this._notifications.get_boolean("show-banners")) return "notifications-disabled-symbolic";
    return this._unread > 0 ? "message-indicator-symbolic" : null;
  }

  /** The user's text shown before the time on the idle face; "" for none. */
  setText(text) {
    const clean = typeof text === "string" ? text.replace(/\s+/g, " ").trim() : "";
    if (clean === this._text) return;
    this._text = clean;
    this._update();
  }

  _update() {
    for (const view of this._views) view.update();
    this.onChanged?.();
  }

  /** The island's idle face: the top bar clock's text and indicator. */
  buildCompact() {
    const box = new St.BoxLayout({
      style_class: "nexsland-clock-face",
      x_expand: true,
      x_align: Clutter.ActorAlign.CENTER,
    });
    const text = new St.Label({
      style_class: "nexsland-clock-face-text",
      y_align: Clutter.ActorAlign.CENTER,
    });
    text.clutter_text.ellipsize = Pango.EllipsizeMode.END;
    const separator = new St.Widget({
      style_class: "nexsland-clock-face-separator",
      y_align: Clutter.ActorAlign.CENTER,
    });
    const label = new St.Label({
      style_class: "nexsland-clock-face-time",
      y_align: Clutter.ActorAlign.CENTER,
    });
    const indicator = new St.Icon({
      style_class: "nexsland-clock-face-indicator",
      icon_size: 12,
      y_align: Clutter.ActorAlign.CENTER,
    });
    box.add_child(text);
    box.add_child(separator);
    box.add_child(label);
    box.add_child(indicator);
    this._register(box, () => {
      text.text = this._text;
      text.visible = separator.visible = this._text !== "";
      label.text = this._clock?.clock ?? "";
      const icon = this._indicatorIcon;
      indicator.visible = icon !== null;
      if (icon) indicator.icon_name = icon;
    });
    return box;
  }

  /** The panel header's clock: the time, large, then the date; the user's text below. */
  buildHeader() {
    const column = vbox({
      style_class: "nexsland-panel-clock-column",
      x_expand: true,
      y_align: Clutter.ActorAlign.CENTER,
    });
    const box = new St.BoxLayout({ style_class: "nexsland-panel-clock" });
    const note = new St.Label({ style_class: "nexsland-panel-clock-text" });
    note.clutter_text.ellipsize = Pango.EllipsizeMode.END;
    column.add_child(box);
    column.add_child(note);
    const time = new St.Label({
      style_class: "nexsland-panel-clock-time",
      y_align: Clutter.ActorAlign.CENTER,
    });
    const date = new St.Label({
      style_class: "nexsland-panel-clock-date",
      y_align: Clutter.ActorAlign.CENTER,
    });
    const indicator = new St.Icon({
      style_class: "nexsland-clock-face-indicator",
      icon_size: 12,
      y_align: Clutter.ActorAlign.CENTER,
    });
    box.add_child(time);
    box.add_child(date);
    box.add_child(indicator);
    this._register(column, () => {
      note.text = this._text;
      note.visible = this._text !== "";
      const now = GLib.DateTime.new_now_local();
      const h24 = this._interface?.get_string("clock-format") !== "12h";
      time.text = now.format(h24 ? "%H:%M" : "%-l:%M %p");
      date.text = now.format("%a, %b %-d");
      const icon = this._indicatorIcon;
      indicator.visible = icon !== null;
      if (icon) indicator.icon_name = icon;
    });
    return column;
  }

  _register(actor, update) {
    const view = { update };
    this._views.add(view);
    // eslint-disable-next-line local/no-untracked-connect -- actor-lifetime-bound: the view goes with its actor
    actor.connect("destroy", () => this._views.delete(view));
    update();
  }
}

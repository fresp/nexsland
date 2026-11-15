/*
 * This file is part of the Nexsland GNOME extension.
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Notifications tab: the shell's notification list (Main.messageTray), which the
 * clock's menu shows when Nexsland does not take the clock over. Clicking a row
 * activates it, × dismisses it; the header toggles Do Not Disturb and clears all.
 * Showing the list marks its notifications as seen, as GNOME's own list does.
 */

import Clutter from "gi://Clutter";
import Gio from "gi://Gio";
import GLib from "gi://GLib";
import Pango from "gi://Pango";
import St from "gi://St";
import { gettext as _, ngettext } from "resource:///org/gnome/shell/extensions/extension.js";
import * as Main from "resource:///org/gnome/shell/ui/main.js";

import { age, newestFirst, plainBody } from "./notifications-model.js";
import { vbox } from "../shared/compat.js";
import { SignalTracker } from "../shared/signals.js";

function ageText(dateTime) {
  if (!dateTime) return "";
  const { unit, count } = age(GLib.DateTime.new_now_local().to_unix(), dateTime.to_unix());
  switch (unit) {
    case "minutes":
      return ngettext("%d min", "%d min", count).format(count);
    case "hours":
      return ngettext("%d h", "%d h", count).format(count);
    case "days":
      return ngettext("%d day", "%d days", count).format(count);
    default:
      return _("now");
  }
}

export class NotificationsFeature {
  /** @param {{ engine: any }} params */
  constructor({ engine }) {
    this._engine = engine;
    this._list = null;
    this._count = null;
    this._dndButton = null;
    this._signals = new SignalTracker();
    /** @type {Map<any, SignalTracker>} */
    this._sourceSignals = new Map();
    this._dnd = new Gio.Settings({ schema_id: "org.gnome.desktop.notifications" });

    const tray = Main.messageTray;
    this._signals.track(tray, "source-added", (_tray, source) => this._watch(source));
    this._signals.track(tray, "source-removed", (_tray, source) => {
      this._unwatch(source);
      this._populate();
    });
    this._signals.track(this._dnd, "changed::show-banners", () => this._syncDnd());
    for (const source of tray.getSources()) this._watch(source);

    this.tab = {
      id: "notifications",
      icon: "preferences-system-notifications-symbolic",
      title: _("Notifications"),
      build: () => this._build(),
      hidden: () => {
        this._list = null;
        this._count = null;
        this._dndButton = null;
      },
    };
  }

  destroy() {
    this._signals.disconnectAll();
    for (const tracker of this._sourceSignals.values()) tracker.disconnectAll();
    this._sourceSignals.clear();
    this._list = null;
    this._count = null;
    this._dndButton = null;
    this._dnd = null;
  }

  _watch(source) {
    if (this._sourceSignals.has(source)) return;
    const tracker = new SignalTracker();
    tracker.track(source, "notification-added", () => this._populate());
    tracker.track(source, "notification-removed", () => this._populate());
    this._sourceSignals.set(source, tracker);
  }

  _unwatch(source) {
    this._sourceSignals.get(source)?.disconnectAll();
    this._sourceSignals.delete(source);
  }

  /** Every notification in the tray, newest first. */
  _entries() {
    const entries = [];
    for (const source of Main.messageTray.getSources()) {
      for (const notification of source.notifications ?? [])
        entries.push({ source, notification, time: notification.datetime?.to_unix() });
    }
    return newestFirst(entries);
  }

  _build() {
    const root = vbox({ style_class: "nexsland-notifications", x_expand: true });

    const header = new St.BoxLayout({ style_class: "nexsland-row" });
    this._count = new St.Label({
      style_class: "nexsland-notifications-count",
      x_expand: true,
      y_align: Clutter.ActorAlign.CENTER,
    });
    header.add_child(this._count);
    this._dndButton = new St.Button({
      style_class: "nexsland-pill-button",
      can_focus: true,
      toggle_mode: true,
    });
    // eslint-disable-next-line local/no-untracked-connect -- actor-lifetime-bound: freed with the button
    this._dndButton.connect("clicked", () => {
      this._dnd.set_boolean("show-banners", !this._dnd.get_boolean("show-banners"));
      return Clutter.EVENT_STOP;
    });
    header.add_child(this._dndButton);
    const clear = new St.Button({
      label: _("Clear"),
      style_class: "nexsland-pill-button",
      can_focus: true,
    });
    // eslint-disable-next-line local/no-untracked-connect -- actor-lifetime-bound: freed with the button
    clear.connect("clicked", () => {
      for (const { notification } of this._entries())
        if (!notification.resident) notification.destroy();
      return Clutter.EVENT_STOP;
    });
    header.add_child(clear);
    root.add_child(header);

    const scroll = new St.ScrollView({
      x_expand: true,
      y_expand: true,
      hscrollbar_policy: St.PolicyType.NEVER,
      vscrollbar_policy: St.PolicyType.AUTOMATIC,
    });
    this._list = vbox({ style_class: "nexsland-notifications-list", x_expand: true });
    if (scroll.set_child) scroll.set_child(this._list);
    else scroll.add_actor(this._list);
    root.add_child(scroll);

    this._syncDnd();
    this._populate();
    return root;
  }

  _syncDnd() {
    if (!this._dndButton || !this._dnd) return;
    const dnd = !this._dnd.get_boolean("show-banners");
    this._dndButton.checked = dnd;
    this._dndButton.label = dnd ? _("Do Not Disturb on") : _("Do Not Disturb");
  }

  _populate() {
    const list = this._list;
    if (!list) return;
    list.destroy_all_children();
    const entries = this._entries();
    this._count.text =
      entries.length === 0
        ? _("No notifications")
        : ngettext("%d notification", "%d notifications", entries.length).format(entries.length);
    for (const entry of entries) {
      list.add_child(this._row(entry));
      entry.notification.acknowledged = true;
    }
  }

  _row({ source, notification }) {
    const row = new St.BoxLayout({ style_class: "nexsland-notification", x_expand: true });
    const gicon = notification.gicon ?? source.icon ?? null;
    row.add_child(
      new St.Icon({
        style_class: "nexsland-notification-icon",
        icon_size: 24,
        y_align: Clutter.ActorAlign.START,
        ...(gicon ? { gicon } : { icon_name: "dialog-information-symbolic" }),
      }),
    );

    const text = vbox({ x_expand: true });
    const head = new St.BoxLayout({ style_class: "nexsland-notification-head" });
    const title = new St.Label({
      text: notification.title || source.title || "",
      style_class: "nexsland-notification-title",
      x_expand: true,
    });
    title.clutter_text.ellipsize = Pango.EllipsizeMode.END;
    head.add_child(title);
    head.add_child(
      new St.Label({
        text: [source.title, ageText(notification.datetime)].filter(Boolean).join(" · "),
        style_class: "nexsland-notification-meta",
      }),
    );
    text.add_child(head);
    const body = plainBody(notification.body, notification.useBodyMarkup);
    if (body) {
      const label = new St.Label({ text: body, style_class: "nexsland-notification-body" });
      label.clutter_text.ellipsize = Pango.EllipsizeMode.END;
      text.add_child(label);
    }

    const open = new St.Button({
      style_class: "nexsland-notification-open",
      can_focus: true,
      x_expand: true,
      child: text,
    });
    // eslint-disable-next-line local/no-untracked-connect -- actor-lifetime-bound: freed with the button
    open.connect("clicked", () => {
      notification.activate();
      this._engine.collapse();
      return Clutter.EVENT_STOP;
    });
    row.add_child(open);

    const dismiss = new St.Button({
      style_class: "nexsland-notification-dismiss",
      can_focus: true,
      accessible_name: _("Dismiss"),
      y_align: Clutter.ActorAlign.START,
      child: new St.Icon({ icon_name: "window-close-symbolic", icon_size: 12 }),
    });
    // eslint-disable-next-line local/no-untracked-connect -- actor-lifetime-bound: freed with the button
    dismiss.connect("clicked", () => {
      notification.destroy();
      return Clutter.EVENT_STOP;
    });
    row.add_child(dismiss);
    return row;
  }
}

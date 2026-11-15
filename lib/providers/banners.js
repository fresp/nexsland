/*
 * This file is part of the Nexsland GNOME extension.
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Notification banners in the island instead of GNOME's own.
 *
 * GNOME's banners are held back with MessageTray's bannerBlocked, the switch the
 * shell itself uses while a menu covers the banner area. The top bar also writes
 * it whenever a menu in its centre opens or closes, which would bring GNOME's
 * banners back, so while this provider runs bannerBlocked is shadowed by an
 * instance property that remembers what the shell asked for and keeps banners
 * blocked; destroy() removes it and hands the shell's value back.
 *
 * Each notification that would get a GNOME banner (same rules: not seen yet, not
 * low urgency, banners allowed unless critical) becomes a temporary island HUD
 * and is marked seen and plays its sound, as a banner does. Clicking the HUD
 * activates it. A player's own "now playing" notification for the track the
 * island already shows is not shown again. A critical notification is shown even
 * over the overview and fullscreen windows (urgent content); any other one that
 * arrives while the island cannot be seen there is left unseen in the list, where
 * the clock's dot and the Notifications tab point to it.
 */

import Clutter from "gi://Clutter";
import Pango from "gi://Pango";
import St from "gi://St";
import * as Main from "resource:///org/gnome/shell/ui/main.js";

import { Logger } from "../shared/logger.js";
import { SignalTracker } from "../shared/signals.js";
import { vbox } from "../shared/compat.js";
import { plainBody } from "../features/notifications-model.js";
import { Urgency, bannerDuration, echoesTrack, wantsBanner } from "./banners-model.js";

const SIZE = Object.freeze({ width: 380, height: 46, radius: 20, ear: 8 });
const MEDIA_ACTIVITY_ID = "mpris";

/** The bannerBlocked setter on MessageTray's prototype chain, or null. */
function bannerBlockedSetter(tray) {
  for (let o = Object.getPrototypeOf(tray); o; o = Object.getPrototypeOf(o)) {
    const d = Object.getOwnPropertyDescriptor(o, "bannerBlocked");
    if (d?.set) return d.set;
  }
  return null;
}

export class BannersProvider {
  /**
   * @param {{ engine: any, canPresent: (monitorIndex?: number, urgent?: boolean) => boolean }} params
   */
  constructor({ engine, canPresent }) {
    this._engine = engine;
    this._canPresent = canPresent;
    this._signals = new SignalTracker();
    /** @type {Map<any, SignalTracker>} */
    this._sourceSignals = new Map();
    /** @type {Map<string, any>} HUD id -> notification, while queued or shown */
    this._shown = new Map();
    this._nextId = 0;

    this._block();
    const tray = Main.messageTray;
    this._signals.track(tray, "source-added", (_tray, source) => this._watch(source));
    this._signals.track(tray, "source-removed", (_tray, source) => this._unwatch(source));
    for (const source of tray.getSources()) this._watch(source);
    this._unsubscribe = engine.subscribe(() => this._onIslandState());
  }

  destroy() {
    this._unsubscribe?.();
    this._signals.disconnectAll();
    for (const tracker of this._sourceSignals.values()) tracker.disconnectAll();
    this._sourceSignals.clear();
    this._shown.clear();
    this._unblock();
  }

  _block() {
    const tray = Main.messageTray;
    const setter = bannerBlockedSetter(tray);
    if (!setter) {
      Logger.error("banners: MessageTray has no bannerBlocked; GNOME banners stay on");
      return;
    }
    this._setter = setter;
    this._requested = Boolean(tray._bannerBlocked);
    Object.defineProperty(tray, "bannerBlocked", {
      configurable: true,
      get: () => this._requested,
      set: (value) => {
        this._requested = Boolean(value);
      },
    });
    setter.call(tray, true);
  }

  _unblock() {
    if (!this._setter) return;
    const tray = Main.messageTray;
    delete tray.bannerBlocked;
    this._setter.call(tray, this._requested);
    this._setter = null;
  }

  _watch(source) {
    if (this._sourceSignals.has(source)) return;
    const tracker = new SignalTracker();
    tracker.track(source, "notification-request-banner", (_source, notification) =>
      this._onBannerRequest(notification),
    );
    this._sourceSignals.set(source, tracker);
  }

  _unwatch(source) {
    this._sourceSignals.get(source)?.disconnectAll();
    this._sourceSignals.delete(source);
  }

  _onBannerRequest(notification) {
    const wanted = wantsBanner({
      acknowledged: notification.acknowledged,
      urgency: notification.urgency,
      showBanners: notification.source?.policy?.showBanners ?? true,
    });
    const urgent = notification.urgency === Urgency.CRITICAL;
    if (!wanted || !this._canPresent(-1, urgent)) return;

    // What a GNOME banner does when it is shown.
    notification.acknowledged = true;
    notification.playSound?.();

    const track = this._engine.liveContent(MEDIA_ACTIVITY_ID)?.track?.title;
    if (echoesTrack({ title: notification.title, body: notification.body }, track)) return;

    const id = `banner-${this._nextId++}`;
    this._shown.set(id, notification);
    this._engine.showTemporary(
      {
        id,
        restorable: false,
        urgent,
        compact: { ...SIZE, build: () => this._build(id, notification) },
      },
      bannerDuration(notification.urgency),
    );
  }

  /** A transient notification ends with its banner, as in GNOME. */
  _onIslandState() {
    for (const [id, notification] of this._shown) {
      if (this._engine.hasTemporary(id)) continue;
      this._shown.delete(id);
      if (notification.isTransient) notification.destroy();
    }
  }

  _build(id, notification) {
    const source = notification.source;
    const row = new St.BoxLayout({ style_class: "nexsland-banner", x_expand: true });
    const gicon = notification.gicon ?? source?.icon ?? null;
    row.add_child(
      new St.Icon({
        style_class: "nexsland-banner-icon",
        icon_size: 26,
        y_align: Clutter.ActorAlign.CENTER,
        ...(gicon ? { gicon } : { icon_name: "dialog-information-symbolic" }),
      }),
    );
    const text = vbox({ x_expand: true, y_align: Clutter.ActorAlign.CENTER });
    const title = new St.Label({
      text: notification.title || source?.title || "",
      style_class: "nexsland-banner-title",
    });
    title.clutter_text.ellipsize = Pango.EllipsizeMode.END;
    text.add_child(title);
    const body = plainBody(notification.body, notification.useBodyMarkup);
    if (body) {
      const label = new St.Label({ text: body, style_class: "nexsland-banner-body" });
      label.clutter_text.ellipsize = Pango.EllipsizeMode.END;
      text.add_child(label);
    }
    row.add_child(text);

    const button = new St.Button({
      style_class: "nexsland-banner-button",
      child: row,
      x_expand: true,
      can_focus: true,
    });
    // eslint-disable-next-line local/no-untracked-connect -- actor-lifetime-bound: freed with the button
    button.connect("clicked", () => {
      this._shown.delete(id);
      notification.activate();
      this._engine.dismiss();
      return Clutter.EVENT_STOP;
    });
    return button;
  }
}

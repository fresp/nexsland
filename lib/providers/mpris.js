/*
 * This file is part of the Nexsland GNOME extension.
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Now Playing provider: watches MPRIS players on the session bus and publishes
 * the active one to the engine as a single live activity ("mpris").
 */

import Clutter from "gi://Clutter";
import Gio from "gi://Gio";
import GLib from "gi://GLib";
import Pango from "gi://Pango";
import St from "gi://St";

import { Logger } from "../shared/logger.js";
import { isMprisName, metadataToTrack, pickActivePlayer, playerLabel } from "./mpris-model.js";
import { vbox } from "../shared/compat.js";

const MPRIS_PATH = "/org/mpris/MediaPlayer2";
const ACTIVITY_ID = "mpris";
const PRIORITY = 50;

const PLAYER_IFACE = `
<node>
  <interface name="org.mpris.MediaPlayer2.Player">
    <method name="PlayPause"/>
    <method name="Next"/>
    <method name="Previous"/>
    <property name="PlaybackStatus" type="s" access="read"/>
    <property name="Metadata" type="a{sv}" access="read"/>
    <property name="CanGoNext" type="b" access="read"/>
    <property name="CanGoPrevious" type="b" access="read"/>
  </interface>
</node>`;

function isCancelled(e) {
  return e instanceof GLib.Error && e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED);
}

/**
 * Rounded album art. St clips a background-image to border-radius (the shell's
 * own user avatars rely on this), which St.Icon cannot do. Local files only in
 * Phase 0; remote art URLs need an async fetch + cache.
 */
function albumArt(artUrl, size, radius) {
  const path = artUrl.startsWith("file://") ? Gio.File.new_for_uri(artUrl).get_path() : null;
  const art = new St.Bin({
    style_class: "nexsland-art",
    width: size,
    height: size,
    y_align: Clutter.ActorAlign.CENTER,
  });
  if (path && !/["\\]/.test(path)) {
    art.set_style(`border-radius: ${radius}px; background-image: url("${path}");`);
  } else {
    art.set_style(`border-radius: ${radius}px;`);
    art.set_child(
      new St.Icon({
        icon_name: "audio-x-generic-symbolic",
        icon_size: Math.round(size * 0.45),
        style_class: "nexsland-art-fallback",
      }),
    );
  }
  return art;
}

const BAR_PERIODS_MS = [420, 320, 520, 380];

/** Bouncing bars while playing, resting low when paused. */
function visualizer(playing, height) {
  const box = new St.BoxLayout({
    style_class: "nexsland-viz",
    y_align: Clutter.ActorAlign.CENTER,
    height,
  });
  const animate = playing && St.Settings.get().enable_animations;
  for (const period of BAR_PERIODS_MS) {
    const bar = new St.Widget({
      style_class: "nexsland-viz-bar",
      width: 3,
      height,
      y_align: Clutter.ActorAlign.END,
    });
    bar.set_pivot_point(0.5, 1);
    bar.scale_y = 0.3;
    if (animate) {
      bar.ease({
        scale_y: 1,
        duration: period,
        mode: Clutter.AnimationMode.EASE_IN_OUT_SINE,
        repeatCount: -1,
        autoReverse: true,
      });
    }
    box.add_child(bar);
  }
  return box;
}

function label(text, styleClass) {
  const l = new St.Label({ text, style_class: styleClass, y_align: Clutter.ActorAlign.CENTER });
  l.clutter_text.ellipsize = Pango.EllipsizeMode.END;
  return l;
}

export class MprisProvider {
  /** @param {{ engine: import("../engine/engine.js").IslandEngine }} params */
  constructor({ engine }) {
    this._engine = engine;
    // Built here rather than at module scope: nothing may be created before enable().
    this._PlayerProxy = Gio.DBusProxy.makeProxyWrapper(PLAYER_IFACE);
    /** @type {Map<string, { proxy: any, propsId: number, status: string, track: ReturnType<typeof metadataToTrack>, changedAt: number }>} */
    this._players = new Map();
    this._cancellable = new Gio.Cancellable();
    this._shown = false;

    const bus = Gio.DBus.session;
    this._nameSub = bus.signal_subscribe(
      "org.freedesktop.DBus",
      "org.freedesktop.DBus",
      "NameOwnerChanged",
      "/org/freedesktop/DBus",
      null,
      Gio.DBusSignalFlags.NONE,
      (_conn, _sender, _path, _iface, _signal, params) => {
        const [name, oldOwner, newOwner] = params.deepUnpack();
        if (!isMprisName(name)) return;
        if (oldOwner) this._removePlayer(name);
        if (newOwner) this._addPlayer(name);
      },
    );

    bus.call(
      "org.freedesktop.DBus",
      "/org/freedesktop/DBus",
      "org.freedesktop.DBus",
      "ListNames",
      null,
      new GLib.VariantType("(as)"),
      Gio.DBusCallFlags.NONE,
      -1,
      this._cancellable,
      (conn, res) => {
        try {
          const [names] = conn.call_finish(res).deepUnpack();
          names.filter(isMprisName).forEach((n) => this._addPlayer(n));
        } catch (e) {
          if (!isCancelled(e)) Logger.warn(`mpris: ListNames failed: ${e}`);
        }
      },
    );
  }

  destroy() {
    this._cancellable.cancel();
    Gio.DBus.session.signal_unsubscribe(this._nameSub);
    for (const name of [...this._players.keys()]) this._dropPlayer(name);
    if (this._shown) this._engine.hideLive(ACTIVITY_ID);
    this._shown = false;
  }

  _addPlayer(name) {
    if (this._players.has(name)) return;
    const entry = {
      proxy: null,
      propsId: 0,
      status: "Stopped",
      track: metadataToTrack(null),
      changedAt: 0,
    };
    this._players.set(name, entry);
    new this._PlayerProxy(
      Gio.DBus.session,
      name,
      MPRIS_PATH,
      (proxy, error) => {
        if (error) {
          if (!isCancelled(error)) Logger.warn(`mpris: proxy for ${name} failed: ${error}`);
          return;
        }
        // The player may have vanished (or we were destroyed) while the proxy was being built.
        if (this._players.get(name) !== entry) return;
        entry.proxy = proxy;
        entry.propsId = proxy.connect("g-properties-changed", () => this._refresh(name));
        this._refresh(name);
      },
      this._cancellable,
    );
  }

  _removePlayer(name) {
    this._dropPlayer(name);
    this._sync();
  }

  _dropPlayer(name) {
    const entry = this._players.get(name);
    if (!entry) return;
    if (entry.proxy && entry.propsId) entry.proxy.disconnect(entry.propsId);
    this._players.delete(name);
  }

  _refresh(name) {
    const entry = this._players.get(name);
    if (!entry?.proxy) return;
    const status = entry.proxy.PlaybackStatus ?? "Stopped";
    const track = metadataToTrack(entry.proxy.get_cached_property("Metadata")?.recursiveUnpack());
    const trackChanged = track.trackId !== entry.track.trackId || track.title !== entry.track.title;
    if (trackChanged || (status !== entry.status && status === "Playing")) {
      entry.changedAt = GLib.get_monotonic_time();
    }
    entry.status = status;
    entry.track = track;
    this._sync();
  }

  _sync() {
    const active = pickActivePlayer(
      [...this._players].map(([busName, e]) => ({
        busName,
        status: e.status,
        title: e.track.title,
        changedAt: e.changedAt,
      })),
    );
    if (!active) {
      if (this._shown) this._engine.hideLive(ACTIVITY_ID);
      this._shown = false;
      return;
    }
    this._shown = true;
    this._engine.showLive(this._content(active.busName, this._players.get(active.busName)));
  }

  _content(busName, entry) {
    // Sizes follow Atoll's notch proportions: a slim closed bar with small ears,
    // opening into a wide panel with larger ears and softer bottom corners.
    return {
      id: ACTIVITY_ID,
      stackId: ACTIVITY_ID,
      priority: PRIORITY,
      expandable: true,
      compact: {
        width: 300,
        height: 32,
        radius: 14,
        ear: 6,
        build: () => this._buildCompact(entry),
      },
      expanded: {
        width: 520,
        height: 156,
        radius: 26,
        ear: 16,
        build: () => this._buildExpanded(busName, entry),
      },
    };
  }

  _buildCompact(entry) {
    const playing = entry.status === "Playing";
    const box = new St.BoxLayout({ style_class: "nexsland-media-compact", x_expand: true });
    box.add_child(albumArt(entry.track.artUrl, 22, 7));
    const title = label(entry.track.title, "nexsland-media-compact-title");
    title.x_expand = true;
    box.add_child(title);
    box.add_child(visualizer(playing, 14));
    return box;
  }

  _buildExpanded(busName, entry) {
    const playing = entry.status === "Playing";
    const root = new St.BoxLayout({ style_class: "nexsland-media-expanded", x_expand: true });
    root.add_child(albumArt(entry.track.artUrl, 104, 16));

    const info = vbox({
      x_expand: true,
      style_class: "nexsland-media-info",
    });
    const head = new St.BoxLayout({ style_class: "nexsland-media-head" });
    const title = label(entry.track.title, "nexsland-media-title");
    title.x_expand = true;
    head.add_child(title);
    head.add_child(visualizer(playing, 16));
    info.add_child(head);
    if (entry.track.artist) info.add_child(label(entry.track.artist, "nexsland-media-artist"));
    info.add_child(label(playerLabel(busName), "nexsland-media-source"));
    info.add_child(new St.Widget({ y_expand: true }));

    const controls = new St.BoxLayout({
      style_class: "nexsland-media-controls",
      x_align: Clutter.ActorAlign.CENTER,
    });
    const proxy = entry.proxy;
    const control = (icon, method, { enabled = true, primary = false } = {}) => {
      const button = new St.Button({
        style_class: primary ? "nexsland-media-button primary" : "nexsland-media-button",
        can_focus: true,
        reactive: enabled,
        accessible_name: method,
        child: new St.Icon({ icon_name: icon, icon_size: primary ? 20 : 18 }),
      });
      // eslint-disable-next-line local/no-untracked-connect -- actor-lifetime-bound: freed with the button
      button.connect("clicked", () => {
        proxy[`${method}Async`]().catch((e) => Logger.warn(`mpris: ${method} failed: ${e}`));
        return Clutter.EVENT_STOP;
      });
      return button;
    };
    controls.add_child(
      control("media-skip-backward-symbolic", "Previous", {
        enabled: proxy.CanGoPrevious !== false,
      }),
    );
    controls.add_child(
      control(
        playing ? "media-playback-pause-symbolic" : "media-playback-start-symbolic",
        "PlayPause",
        {
          primary: true,
        },
      ),
    );
    controls.add_child(
      control("media-skip-forward-symbolic", "Next", { enabled: proxy.CanGoNext !== false }),
    );
    info.add_child(controls);
    root.add_child(info);
    return root;
  }
}

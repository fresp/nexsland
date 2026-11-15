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

const PlayerProxy = Gio.DBusProxy.makeProxyWrapper(PLAYER_IFACE);

function isCancelled(e) {
  return e instanceof GLib.Error && e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED);
}

/** Art from local files only in Phase 0; remote art URLs need an async fetch + cache. */
function artIcon(artUrl, size) {
  const gicon = artUrl.startsWith("file://")
    ? Gio.FileIcon.new(Gio.File.new_for_uri(artUrl))
    : Gio.ThemedIcon.new("audio-x-generic-symbolic");
  return new St.Icon({ gicon, icon_size: size, style_class: "nexsland-media-art" });
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
    new PlayerProxy(
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
    return {
      id: ACTIVITY_ID,
      stackId: ACTIVITY_ID,
      priority: PRIORITY,
      expandable: true,
      compact: { width: 260, height: 36, radius: 18, build: () => this._buildCompact(entry) },
      expanded: {
        width: 400,
        height: 132,
        radius: 30,
        build: () => this._buildExpanded(busName, entry),
      },
    };
  }

  _buildCompact(entry) {
    const box = new St.BoxLayout({ style_class: "nexsland-media-compact", x_expand: true });
    box.add_child(artIcon(entry.track.artUrl, 20));
    const title = label(entry.track.title, "nexsland-media-title");
    title.x_expand = true;
    box.add_child(title);
    box.add_child(
      new St.Icon({
        icon_name:
          entry.status === "Playing"
            ? "media-playback-start-symbolic"
            : "media-playback-pause-symbolic",
        icon_size: 14,
        style_class: "nexsland-accent",
      }),
    );
    return box;
  }

  _buildExpanded(busName, entry) {
    const root = new St.BoxLayout({
      vertical: true,
      style_class: "nexsland-media-expanded",
      x_expand: true,
    });

    const top = new St.BoxLayout({ style_class: "nexsland-media-row" });
    top.add_child(artIcon(entry.track.artUrl, 56));
    const text = new St.BoxLayout({
      vertical: true,
      x_expand: true,
      y_align: Clutter.ActorAlign.CENTER,
    });
    text.add_child(label(entry.track.title, "nexsland-media-title"));
    if (entry.track.artist) text.add_child(label(entry.track.artist, "nexsland-media-artist"));
    text.add_child(label(playerLabel(busName), "nexsland-media-source"));
    top.add_child(text);
    root.add_child(top);

    const controls = new St.BoxLayout({
      style_class: "nexsland-media-controls",
      x_align: Clutter.ActorAlign.CENTER,
    });
    const proxy = entry.proxy;
    const control = (icon, method, enabled = true) => {
      const button = new St.Button({
        style_class: "nexsland-media-button",
        can_focus: true,
        reactive: enabled,
        child: new St.Icon({ icon_name: icon, icon_size: 18 }),
      });
      // eslint-disable-next-line local/no-untracked-connect -- actor-lifetime-bound: freed with the button
      button.connect("clicked", () => {
        proxy[`${method}Async`]().catch((e) => Logger.warn(`mpris: ${method} failed: ${e}`));
        return Clutter.EVENT_STOP;
      });
      return button;
    };
    controls.add_child(
      control("media-skip-backward-symbolic", "Previous", proxy.CanGoPrevious !== false),
    );
    controls.add_child(
      control(
        entry.status === "Playing"
          ? "media-playback-pause-symbolic"
          : "media-playback-start-symbolic",
        "PlayPause",
      ),
    );
    controls.add_child(control("media-skip-forward-symbolic", "Next", proxy.CanGoNext !== false));
    root.add_child(controls);
    return root;
  }
}

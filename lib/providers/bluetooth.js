/*
 * This file is part of the Nexsland GNOME extension.
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Bluetooth connect/disconnect HUDs straight from BlueZ on the system bus:
 * GetManagedObjects for the initial state, then InterfacesAdded/Removed and
 * PropertiesChanged. No GnomeBluetooth dependency.
 */

import Gio from "gi://Gio";
import GLib from "gi://GLib";
import { gettext as _ } from "resource:///org/gnome/shell/extensions/extension.js";

import { Logger } from "../shared/logger.js";
import { applyDeviceProps, bluetoothEvent, deviceIconName } from "./bluetooth-model.js";
import { HUD_SIZE, buildInfoHud } from "./hud.js";

const ACTIVITY_ID = "bluetooth";
const DURATION_MS = 2000;
const TRACKED = ["org.bluez.Device1", "org.bluez.Battery1"];

export class BluetoothProvider {
  /** @param {{ engine: import("../engine/engine.js").IslandEngine }} params */
  constructor({ engine }) {
    this._engine = engine;
    /** @type {Map<string, import("./bluetooth-model.js").BtDevice>} */
    this._devices = new Map();
    this._cancellable = new Gio.Cancellable();
    const bus = Gio.DBus.system;

    this._subs = [
      bus.signal_subscribe(
        "org.bluez",
        "org.freedesktop.DBus.Properties",
        "PropertiesChanged",
        null,
        null,
        Gio.DBusSignalFlags.NONE,
        (_conn, _sender, path, _iface, _signal, params) => {
          const [iface, changed] = params.recursiveUnpack();
          this._update(path, iface, changed, true);
        },
      ),
      bus.signal_subscribe(
        "org.bluez",
        "org.freedesktop.DBus.ObjectManager",
        "InterfacesAdded",
        null,
        null,
        Gio.DBusSignalFlags.NONE,
        (_conn, _sender, _path, _iface, _signal, params) => {
          const [path, ifaces] = params.recursiveUnpack();
          for (const [iface, props] of Object.entries(ifaces))
            this._update(path, iface, props, false);
        },
      ),
      bus.signal_subscribe(
        "org.bluez",
        "org.freedesktop.DBus.ObjectManager",
        "InterfacesRemoved",
        null,
        null,
        Gio.DBusSignalFlags.NONE,
        (_conn, _sender, _path, _iface, _signal, params) => {
          const [path, ifaces] = params.recursiveUnpack();
          if (ifaces.includes("org.bluez.Device1")) this._devices.delete(path);
        },
      ),
    ];

    bus.call(
      "org.bluez",
      "/",
      "org.freedesktop.DBus.ObjectManager",
      "GetManagedObjects",
      null,
      new GLib.VariantType("(a{oa{sa{sv}}})"),
      Gio.DBusCallFlags.NONE,
      -1,
      this._cancellable,
      (conn, res) => {
        try {
          const [objects] = conn.call_finish(res).recursiveUnpack();
          for (const [path, ifaces] of Object.entries(objects)) {
            for (const [iface, props] of Object.entries(ifaces))
              this._update(path, iface, props, false);
          }
        } catch (e) {
          const cancelled =
            e instanceof GLib.Error && e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED);
          if (!cancelled) Logger.info(`bluetooth: BlueZ unavailable: ${e}`);
        }
      },
    );
  }

  destroy() {
    this._cancellable.cancel();
    for (const id of this._subs) Gio.DBus.system.signal_unsubscribe(id);
    this._subs = [];
    this._devices.clear();
  }

  _update(path, iface, changed, announce) {
    if (!TRACKED.includes(iface)) return;
    const prev = this._devices.get(path);
    const next = applyDeviceProps(prev, iface, changed);
    this._devices.set(path, next);
    if (!announce) return;
    const event = bluetoothEvent(prev, next);
    if (!event) return;

    const connected = event === "connected";
    const detail =
      connected && next.battery !== null
        ? `${next.battery}%`
        : connected
          ? _("Connected")
          : _("Disconnected");
    this._engine.showTemporary(
      {
        id: ACTIVITY_ID,
        compact: {
          ...HUD_SIZE,
          build: () =>
            buildInfoHud({
              icon: deviceIconName(next.icon),
              text: next.alias || _("Bluetooth device"),
              detail,
              tone: connected ? "accent" : "plain",
            }),
        },
      },
      DURATION_MS,
    );
  }
}

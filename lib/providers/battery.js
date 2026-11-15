/*
 * This file is part of the Nexsland GNOME extension.
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Battery HUDs (plugged in, unplugged, fully charged, low, critical) from the
 * UPower DisplayDevice, the same composite device the shell's power indicator
 * reads. Event detection lives in battery-model.js.
 */

import Gio from "gi://Gio";
import GLib from "gi://GLib";
import { gettext as _ } from "resource:///org/gnome/shell/extensions/extension.js";

import { Logger } from "../shared/logger.js";
import { batteryEvent } from "./battery-model.js";
import { HUD_SIZE, buildBatteryHud } from "./hud.js";

const ACTIVITY_ID = "battery";
const DURATION_MS = 3000;

const DEVICE_IFACE = `
<node>
  <interface name="org.freedesktop.UPower.Device">
    <property name="Type" type="u" access="read"/>
    <property name="State" type="u" access="read"/>
    <property name="Percentage" type="d" access="read"/>
    <property name="IsPresent" type="b" access="read"/>
  </interface>
</node>`;

const DeviceProxy = Gio.DBusProxy.makeProxyWrapper(DEVICE_IFACE);

/** Looked up per event so gettext runs after the extension's domain is bound. */
function presentation(event) {
  switch (event) {
    case "plugged":
      return { icon: "battery-full-charging-symbolic", text: _("Charging"), tone: "accent" };
    case "full":
      return { icon: "battery-full-charged-symbolic", text: _("Fully charged"), tone: "accent" };
    case "unplugged":
      return { icon: "battery-good-symbolic", text: _("On battery"), tone: "plain" };
    case "low":
      return { icon: "battery-low-symbolic", text: _("Low battery"), tone: "warn" };
    default:
      return { icon: "battery-caution-symbolic", text: _("Battery critical"), tone: "alert" };
  }
}

export class BatteryProvider {
  /** @param {{ engine: import("../engine/engine.js").IslandEngine }} params */
  constructor({ engine }) {
    this._engine = engine;
    this._last = null;
    this._proxy = null;
    this._propsId = 0;
    this._cancellable = new Gio.Cancellable();

    new DeviceProxy(
      Gio.DBus.system,
      "org.freedesktop.UPower",
      "/org/freedesktop/UPower/devices/DisplayDevice",
      (proxy, error) => {
        if (error) {
          const cancelled =
            error instanceof GLib.Error &&
            error.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED);
          if (!cancelled) Logger.warn(`battery: UPower unavailable: ${error}`);
          return;
        }
        if (this._cancellable.is_cancelled()) return;
        this._proxy = proxy;
        this._propsId = proxy.connect("g-properties-changed", () => this._sync());
        this._sync();
      },
      this._cancellable,
    );
  }

  destroy() {
    this._cancellable.cancel();
    if (this._proxy && this._propsId) this._proxy.disconnect(this._propsId);
    this._proxy = null;
    this._propsId = 0;
  }

  _sync() {
    const p = this._proxy;
    if (!p) return;
    const next = {
      present: !!p.IsPresent,
      type: p.Type ?? 0,
      state: p.State ?? 0,
      percentage: p.Percentage ?? 0,
    };
    const event = batteryEvent(this._last, next);
    this._last = next;
    if (!event) return;
    const look = presentation(event);
    this._engine.showTemporary(
      {
        id: ACTIVITY_ID,
        compact: {
          ...HUD_SIZE,
          build: () => buildBatteryHud({ ...look, percent: next.percentage }),
        },
      },
      DURATION_MS,
    );
  }
}

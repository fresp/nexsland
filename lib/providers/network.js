/*
 * This file is part of the Nexsland GNOME extension.
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Wi-Fi / wired / VPN connection HUDs from NetworkManager (libnm).
 *
 * libnm is imported dynamically: a system without NetworkManager must not stop
 * the whole extension from enabling. NetworkManager emits bursts of signals
 * during a (dis)connection, so snapshots are debounced before diffing.
 */

import Gio from "gi://Gio";
import GLib from "gi://GLib";
import { gettext as _ } from "resource:///org/gnome/shell/extensions/extension.js";

import { Logger } from "../shared/logger.js";
import { HUD_SIZE, buildInfoHud } from "./hud.js";
import { VPN_TYPES, networkEvents } from "./network-model.js";

const DEBOUNCE_MS = 500;
const DURATION_MS = 2000;

/** @param {import("./network-model.js").NetEvent} ev */
function presentation(ev) {
  switch (ev.kind) {
    case "wifi-connected":
      return {
        id: "network",
        icon: "network-wireless-signal-excellent-symbolic",
        detail: _("Connected"),
        tone: "accent",
      };
    case "wired-connected":
      return {
        id: "network",
        icon: "network-wired-symbolic",
        detail: _("Connected"),
        tone: "accent",
      };
    case "connected":
      return {
        id: "network",
        icon: "network-transmit-receive-symbolic",
        detail: _("Connected"),
        tone: "accent",
      };
    case "disconnected":
      return {
        id: "network",
        icon: "network-offline-symbolic",
        detail: _("Disconnected"),
        tone: "warn",
      };
    case "vpn-connected":
      return { id: "vpn", icon: "network-vpn-symbolic", detail: _("VPN on"), tone: "accent" };
    default:
      return {
        id: "vpn",
        icon: "network-vpn-disabled-symbolic",
        detail: _("VPN off"),
        tone: "plain",
      };
  }
}

export class NetworkProvider {
  /**
   * @param {{
   *   engine: import("../engine/engine.js").IslandEngine,
   *   scheduler: { setTimeout: (fn: () => void, ms: number) => number, clearTimeout: (id: number) => void },
   * }} params
   */
  constructor({ engine, scheduler }) {
    this._engine = engine;
    this._scheduler = scheduler;
    this._cancellable = new Gio.Cancellable();
    this._destroyed = false;
    this._client = null;
    this._clientSignals = [];
    /** @type {Map<any, number>} active connection -> notify::state handler */
    this._acSignals = new Map();
    this._debounce = null;
    this._last = null;
    this._start().catch((e) => Logger.warn(`network: ${e}`));
  }

  async _start() {
    let NM;
    try {
      NM = (await import("gi://NM")).default;
    } catch (e) {
      Logger.info(`network: libnm not available, network HUDs disabled: ${e}`);
      return;
    }
    if (this._destroyed) return;
    this._NM = NM;
    NM.Client.new_async(this._cancellable, (_src, res) => {
      let client;
      try {
        client = NM.Client.new_finish(res);
      } catch (e) {
        const cancelled =
          e instanceof GLib.Error && e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED);
        if (!cancelled) Logger.warn(`network: NetworkManager unavailable: ${e}`);
        return;
      }
      if (this._destroyed) return;
      this._client = client;
      this._clientSignals = [
        client.connect("notify::primary-connection", () => this._schedule()),
        client.connect("active-connection-added", (_c, ac) => {
          this._watch(ac);
          this._schedule();
        }),
        client.connect("active-connection-removed", (_c, ac) => {
          this._unwatch(ac);
          this._schedule();
        }),
      ];
      for (const ac of client.get_active_connections()) this._watch(ac);
      this._last = this._snapshot(); // baseline: never announced
    });
  }

  destroy() {
    this._destroyed = true;
    this._cancellable.cancel();
    if (this._debounce !== null) this._scheduler.clearTimeout(this._debounce);
    this._debounce = null;
    for (const ac of [...this._acSignals.keys()]) this._unwatch(ac);
    for (const id of this._clientSignals) this._client?.disconnect(id);
    this._clientSignals = [];
    this._client = null;
  }

  _watch(ac) {
    if (this._acSignals.has(ac)) return;
    this._acSignals.set(
      ac,
      ac.connect("notify::state", () => this._schedule()),
    );
  }

  _unwatch(ac) {
    const id = this._acSignals.get(ac);
    if (id === undefined) return;
    ac.disconnect(id);
    this._acSignals.delete(ac);
  }

  _schedule() {
    if (this._debounce !== null) this._scheduler.clearTimeout(this._debounce);
    this._debounce = this._scheduler.setTimeout(() => {
      this._debounce = null;
      this._flush();
    }, DEBOUNCE_MS);
  }

  _snapshot() {
    const ACTIVATED = this._NM.ActiveConnectionState.ACTIVATED;
    const p = this._client.get_primary_connection();
    const primary =
      p && p.get_state() === ACTIVATED
        ? { id: p.get_id() ?? "", type: p.get_connection_type() ?? "" }
        : null;
    const vpns = this._client
      .get_active_connections()
      .filter(
        (ac) => VPN_TYPES.includes(ac.get_connection_type() ?? "") && ac.get_state() === ACTIVATED,
      )
      .map((ac) => ac.get_id() ?? "")
      .sort();
    return { primary, vpns };
  }

  _flush() {
    if (!this._client) return;
    const next = this._snapshot();
    const events = networkEvents(this._last, next);
    this._last = next;
    for (const ev of events) {
      const look = presentation(ev);
      this._engine.showTemporary(
        {
          id: look.id,
          compact: {
            ...HUD_SIZE,
            build: () =>
              buildInfoHud({
                icon: look.icon,
                text: ev.name,
                detail: look.detail,
                tone: look.tone,
              }),
          },
        },
        DURATION_MS,
      );
    }
  }
}

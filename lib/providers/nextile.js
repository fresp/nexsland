/*
 * This file is part of the Nexsland GNOME extension.
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * NexTile integration through NexTile's own D-Bus control interface (opt-in on
 * the NexTile side: Preferences > External control). Nexsland polls GetState(),
 * because the interface has no signals: every 1.5s while NexTile answers, every
 * 15s while it is absent or disabled, and right away on focus or workspace changes.
 *
 * - HUDs when tiling is toggled, or the focused window's layout or floating
 *   state changes.
 * - A Tiling tab (only while NexTile is installed) with the state and buttons
 *   that Run() NexTile's own actions on the focused window.
 */

import Clutter from "gi://Clutter";
import Gio from "gi://Gio";
import St from "gi://St";
import { gettext as _ } from "resource:///org/gnome/shell/extensions/extension.js";

import { Logger } from "../shared/logger.js";
import { SignalTracker } from "../shared/signals.js";
import { HUD_SIZE, buildInfoHud } from "./hud.js";
import {
  NEXTILE_ACTIONS,
  NEXTILE_BUS_NAME,
  NEXTILE_IFACE,
  NEXTILE_PATH,
  nextileEvents,
  parseNexTileState,
  statusFromErrorName,
} from "./nextile-model.js";

const CONTROL_IFACE = `
<node>
  <interface name="${NEXTILE_IFACE}">
    <method name="Run">
      <arg type="s" direction="in" name="action"/>
    </method>
    <method name="GetState">
      <arg type="s" direction="out" name="state"/>
    </method>
  </interface>
</node>`;

const POLL_OK_MS = 1500;
const POLL_IDLE_MS = 15000;
const POLL_SOON_MS = 150;
const HUD_MS = 1500;

function layoutLabel(layout) {
  switch (layout) {
    case "HSPLIT":
      return _("Split horizontal");
    case "VSPLIT":
      return _("Split vertical");
    case "TABBED":
      return _("Tabbed");
    case "STACKED":
      return _("Stacked");
    default:
      return layout ?? "";
  }
}

function actionLabel(action) {
  switch (action) {
    case "prefs-tiling-toggle":
      return _("Tiling");
    case "con-split-layout-toggle":
      return _("Split");
    case "con-tabbed-layout-toggle":
      return _("Tabbed");
    case "con-stacked-layout-toggle":
      return _("Stacked");
    case "window-toggle-float":
      return _("Float");
    default:
      return _("Monocle");
  }
}

export class NexTileProvider {
  /**
   * @param {{
   *   engine: import("../engine/engine.js").IslandEngine,
   *   scheduler: { setTimeout: (fn: () => void, ms: number) => number, clearTimeout: (id: number) => void },
   *   invalidateTabs: () => void,
   * }} params
   */
  constructor({ engine, scheduler, invalidateTabs }) {
    this._engine = engine;
    this._scheduler = scheduler;
    this._invalidateTabs = invalidateTabs;
    /** @type {"unknown" | "ok" | "disabled" | "absent" | "error"} */
    this._status = "unknown";
    this._state = null;
    this._proxy = null;
    this._timer = null;
    this._inflight = false;
    this._destroyed = false;
    /** @type {Set<() => void>} */
    this._views = new Set();
    this._cancellable = new Gio.Cancellable();
    this._signals = new SignalTracker();
    this._tab = {
      id: "nextile",
      icon: "view-grid-symbolic",
      title: _("Tiling"),
      build: () => this._buildView(),
    };

    // Built here rather than at module scope: nothing may be created before enable().
    const ControlProxy = Gio.DBusProxy.makeProxyWrapper(CONTROL_IFACE);
    new ControlProxy(
      Gio.DBus.session,
      NEXTILE_BUS_NAME,
      NEXTILE_PATH,
      (proxy, error) => {
        if (this._destroyed) return;
        if (error) {
          Logger.info(`nextile: no control proxy: ${error}`);
          return;
        }
        this._proxy = proxy;
        this._poll();
      },
      this._cancellable,
      Gio.DBusProxyFlags.DO_NOT_LOAD_PROPERTIES |
        Gio.DBusProxyFlags.DO_NOT_CONNECT_SIGNALS |
        Gio.DBusProxyFlags.DO_NOT_AUTO_START,
    );
    this._signals.track(global.display, "notify::focus-window", () => this._pollSoon());
    this._signals.track(global.workspace_manager, "active-workspace-changed", () =>
      this._pollSoon(),
    );
  }

  /** The Tiling tab, only while NexTile is installed. */
  get tab() {
    return this._status === "ok" || this._status === "disabled" ? this._tab : null;
  }

  destroy() {
    this._destroyed = true;
    this._cancellable.cancel();
    this._signals.disconnectAll();
    this._clearTimer();
    this._views.clear();
    this._proxy = null;
  }

  _clearTimer() {
    if (this._timer !== null) this._scheduler.clearTimeout(this._timer);
    this._timer = null;
  }

  _schedule(ms) {
    this._clearTimer();
    this._timer = this._scheduler.setTimeout(() => {
      this._timer = null;
      this._poll();
    }, ms);
  }

  _pollSoon() {
    if (this._proxy && this._status === "ok") this._schedule(POLL_SOON_MS);
  }

  async _poll() {
    if (!this._proxy || this._inflight || this._destroyed) return;
    this._inflight = true;
    let status;
    try {
      const [json] = await this._proxy.GetStateAsync();
      if (this._destroyed) return;
      status = "ok";
      const next = parseNexTileState(json);
      const events = nextileEvents(this._state, next);
      this._state = next;
      for (const ev of events) this._announce(ev);
    } catch (e) {
      if (this._destroyed) return;
      status = statusFromErrorName(Gio.DBusError.get_remote_error(e));
      this._state = null;
      if (status === "error" && status !== this._status)
        Logger.info(`nextile: GetState failed: ${e}`);
    } finally {
      this._inflight = false;
    }
    this._setStatus(status);
    for (const update of this._views) update();
    this._schedule(status === "ok" ? POLL_OK_MS : POLL_IDLE_MS);
  }

  _setStatus(status) {
    if (status === this._status) return;
    const hadTab = this.tab !== null;
    this._status = status;
    if (hadTab !== (this.tab !== null)) this._invalidateTabs();
  }

  _announce(ev) {
    let look;
    if (ev.kind === "tiling") {
      look = {
        icon: "view-grid-symbolic",
        text: _("Tiling"),
        detail: ev.on ? _("On") : _("Off"),
        tone: ev.on ? "accent" : "plain",
      };
    } else if (ev.kind === "layout") {
      look = {
        icon: "view-dual-symbolic",
        text: _("Layout"),
        detail: layoutLabel(ev.layout),
        tone: "plain",
      };
    } else {
      look = {
        icon: "focus-windows-symbolic",
        text: _("Window"),
        detail: ev.floating ? _("Floating") : _("Tiled"),
        tone: "plain",
      };
    }
    this._engine.showTemporary(
      { id: "nextile", compact: { ...HUD_SIZE, build: () => buildInfoHud(look) } },
      HUD_MS,
    );
  }

  async _run(action) {
    try {
      await this._proxy?.RunAsync(action);
    } catch (e) {
      Logger.info(`nextile: Run(${action}) failed: ${e}`);
    }
    this._schedule(POLL_SOON_MS);
  }

  _statusText() {
    if (this._status === "disabled") {
      return _("Turn on External control in NexTile's preferences to use this tab.");
    }
    const s = this._state;
    if (!s) return _("Waiting for NexTile…");
    const parts = [
      s.tiling ? _("Tiling on") : _("Tiling off"),
      _("Workspace %d").format(s.workspace + 1),
    ];
    if (s.focus?.layout) parts.push(layoutLabel(s.focus.layout));
    if (s.focus?.floating) parts.push(_("Floating"));
    if (s.scratchpad.windows > 0) parts.push(_("Scratchpad %d").format(s.scratchpad.windows));
    return parts.join("  ·  ");
  }

  _buildView() {
    const box = new St.BoxLayout({
      vertical: true,
      style_class: "nexsland-nextile",
      x_expand: true,
      y_align: Clutter.ActorAlign.CENTER,
    });
    const status = new St.Label({
      style_class: "nexsland-nextile-status",
      x_align: Clutter.ActorAlign.CENTER,
    });
    status.clutter_text.line_wrap = true;
    box.add_child(status);
    const rows = [NEXTILE_ACTIONS.slice(0, 3), NEXTILE_ACTIONS.slice(3)].map((actions) => {
      const row = new St.BoxLayout({
        style_class: "nexsland-row",
        x_align: Clutter.ActorAlign.CENTER,
      });
      for (const action of actions) {
        const button = new St.Button({
          label: actionLabel(action),
          style_class: "nexsland-pill-button",
          can_focus: true,
        });
        // eslint-disable-next-line local/no-untracked-connect -- actor-lifetime-bound: freed with the button
        button.connect("clicked", () => {
          this._run(action);
          return Clutter.EVENT_STOP;
        });
        row.add_child(button);
      }
      box.add_child(row);
      return row;
    });

    const update = () => {
      status.text = this._statusText();
      for (const row of rows) row.visible = this._status === "ok";
    };
    this._views.add(update);
    // eslint-disable-next-line local/no-untracked-connect -- actor-lifetime-bound: runs once, as the view dies
    box.connect("destroy", () => this._views.delete(update));
    update();
    return box;
  }
}

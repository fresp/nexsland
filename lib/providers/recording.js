/*
 * This file is part of the Nexsland GNOME extension.
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Screen recording as a live activity: elapsed time and a stop button, from the
 * shell's own screencast (Main.screenshotUI "screencast-in-progress", the
 * property the stock recording indicator follows). Started before Nexsland was
 * enabled, the timer counts from the moment it noticed.
 */

import GLib from "gi://GLib";
import { gettext as _ } from "resource:///org/gnome/shell/extensions/extension.js";
import * as Main from "resource:///org/gnome/shell/ui/main.js";

import { Logger } from "../shared/logger.js";
import { formatElapsed } from "./format.js";
import { CHIP_SIZE, buildRecordingChip, updateRecordingChip } from "./hud.js";

const ACTIVITY_ID = "recording";
const PRIORITY = 90;

export class RecordingProvider {
  /**
   * @param {{
   *   engine: import("../engine/engine.js").IslandEngine,
   *   scheduler: { setTimeout: (fn: () => void, ms: number) => number, clearTimeout: (id: number) => void },
   * }} params
   */
  constructor({ engine, scheduler }) {
    this._engine = engine;
    this._scheduler = scheduler;
    this._startedUs = 0;
    this._tickTimer = null;
    this._ui = Main.screenshotUI;
    if (!this._ui || this._ui.screencast_in_progress === undefined) {
      Logger.info("recording: this shell has no screencast-in-progress property; disabled");
      this._ui = null;
      return;
    }
    this._notifyId = this._ui.connect("notify::screencast-in-progress", () => this._sync());
    this._sync();
  }

  destroy() {
    this._stopTicking();
    if (this._ui) this._ui.disconnect(this._notifyId);
    this._ui = null;
    if (this._startedUs) this._engine.hideLive(ACTIVITY_ID);
    this._startedUs = 0;
  }

  _sync() {
    const active = !!this._ui?.screencast_in_progress;
    if (active && !this._startedUs) {
      this._startedUs = GLib.get_monotonic_time();
      this._tick();
    } else if (!active && this._startedUs) {
      this._stopTicking();
      this._startedUs = 0;
      this._engine.hideLive(ACTIVITY_ID);
    }
  }

  _tick() {
    const elapsedMs = (GLib.get_monotonic_time() - this._startedUs) / 1000;
    const text = formatElapsed(elapsedMs / 1000);
    this._engine.showLive({
      id: ACTIVITY_ID,
      priority: PRIORITY,
      compact: {
        ...CHIP_SIZE,
        build: () => buildRecordingChip(text, () => this._stop(), _("Stop recording")),
        update: (actor) => updateRecordingChip(actor, text),
      },
    });
    // Re-arm on the next whole second so the display does not drift.
    this._tickTimer = this._scheduler.setTimeout(
      () => {
        this._tickTimer = null;
        this._tick();
      },
      1000 - (Math.floor(elapsedMs) % 1000),
    );
  }

  _stopTicking() {
    if (this._tickTimer !== null) this._scheduler.clearTimeout(this._tickTimer);
    this._tickTimer = null;
  }

  _stop() {
    try {
      this._ui?.stopScreencast?.();
    } catch (e) {
      Logger.warn(`recording: stopScreencast failed: ${e}`);
    }
  }
}

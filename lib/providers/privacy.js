/*
 * This file is part of the Nexsland GNOME extension.
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Microphone-in-use as a live activity, from the shell's shared Gvc mixer (the
 * same source outputs the stock microphone indicator watches). Camera use is not
 * covered yet: GNOME Shell 45-51 has no stable public API for it.
 */

import { gettext as _ } from "resource:///org/gnome/shell/extensions/extension.js";
import * as Volume from "resource:///org/gnome/shell/ui/status/volume.js";

import { Logger } from "../shared/logger.js";
import { SignalTracker } from "../shared/signals.js";
import { micUsers } from "./format.js";
import { HUD_SIZE, buildInfoHud } from "./hud.js";

const ACTIVITY_ID = "privacy-mic";
const PRIORITY = 80;

export class PrivacyProvider {
  /** @param {{ engine: import("../engine/engine.js").IslandEngine }} params */
  constructor({ engine }) {
    this._engine = engine;
    this._shownKey = null;
    this._signals = new SignalTracker();
    this._control = Volume.getMixerControl?.() ?? null;
    if (!this._control) {
      Logger.info("privacy: no mixer control; microphone indicator disabled");
      return;
    }
    for (const signal of ["stream-added", "stream-removed", "state-changed"]) {
      this._signals.track(this._control, signal, () => this._sync());
    }
    this._sync();
  }

  destroy() {
    this._signals.disconnectAll();
    if (this._shownKey !== null) this._engine.hideLive(ACTIVITY_ID);
    this._shownKey = null;
    this._control = null;
  }

  _sync() {
    const outputs = this._control.get_source_outputs().map((o) => ({
      appId: o.get_application_id(),
      name: o.get_name(),
    }));
    const users = micUsers(outputs);
    if (users.length === 0) {
      if (this._shownKey !== null) this._engine.hideLive(ACTIVITY_ID);
      this._shownKey = null;
      return;
    }
    const detail = users.join(", ");
    if (detail === this._shownKey) return;
    this._shownKey = detail;
    this._engine.showLive({
      id: ACTIVITY_ID,
      priority: PRIORITY,
      compact: {
        ...HUD_SIZE,
        build: () =>
          buildInfoHud({
            icon: "audio-input-microphone-symbolic",
            text: _("Microphone in use"),
            detail,
            tone: "privacy",
          }),
      },
    });
  }
}

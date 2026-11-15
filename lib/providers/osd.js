/*
 * This file is part of the Nexsland GNOME extension.
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Volume, microphone and brightness OSDs in the island.
 *
 * gnome-settings-daemon (media keys) and the shell's own Quick Settings sliders
 * both end up in Main.osdWindowManager.show(). Nexsland wraps that method: a
 * request it recognizes becomes a temporary island HUD; anything else (caps
 * lock, keyboard layout, no level), a request for a single non-primary monitor,
 * or any moment the island cannot be seen (overview, fullscreen) falls through
 * to the stock OSD so feedback is never lost. The wrapper is removed in
 * destroy(), restoring the original method.
 */

import { InjectionManager } from "resource:///org/gnome/shell/extensions/extension.js";
import * as Main from "resource:///org/gnome/shell/ui/main.js";

import { Logger } from "../shared/logger.js";
import { HUD_SIZE, buildLevelHud, updateLevelHud } from "./hud.js";
import { classifyOsd } from "./osd-model.js";

const ACTIVITY_ID = "osd";
const DURATION_MS = 1500;

export class OsdProvider {
  /**
   * @param {{ engine: import("../engine/engine.js").IslandEngine, canPresent: () => boolean }} params
   */
  constructor({ engine, canPresent }) {
    this._engine = engine;
    this._canPresent = canPresent;
    this._injections = new InjectionManager();
    const provider = this;
    this._injections.overrideMethod(
      Main.osdWindowManager,
      "show",
      (original) =>
        function (monitorIndex, icon, label, level, maxLevel) {
          let handled = false;
          try {
            handled = provider._handle(monitorIndex, icon, level, maxLevel);
          } catch (e) {
            Logger.warn(`osd: falling back to the stock OSD: ${e}`);
          }
          if (!handled) original.call(this, monitorIndex, icon, label, level, maxLevel);
        },
    );
  }

  destroy() {
    this._injections.clear();
    this._injections = null;
  }

  _handle(monitorIndex, icon, level, maxLevel) {
    const targetsOtherMonitor =
      monitorIndex >= 0 && monitorIndex !== Main.layoutManager.primaryIndex;
    if (targetsOtherMonitor || !this._canPresent()) return false;
    const osd = classifyOsd({ icon: icon?.to_string?.() ?? "", level, maxLevel });
    if (!osd) return false;
    this._engine.showTemporary(
      {
        id: ACTIVITY_ID,
        compact: {
          ...HUD_SIZE,
          build: () => buildLevelHud(osd),
          update: (actor) => updateLevelHud(actor, osd),
        },
      },
      DURATION_MS,
    );
    return true;
  }
}

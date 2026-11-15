/*
 * This file is part of the Nexsland GNOME extension.
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Nexsland takes over the clock in the top bar: hovering or clicking it opens the
 * island's panel (with its Notifications and Calendar tabs) instead of GNOME's
 * date menu. Clicks and Super+V reach the date menu through its menu's open() and
 * toggle(), so those two are wrapped (InjectionManager) and restored on destroy;
 * the clock button itself keeps working as a hover source for the island.
 * Super+V goes through Main.panel.toggleCalendar(), which gives up when the clock
 * is hidden or not reactive (clock-in-island), so that is wrapped too.
 */

import { InjectionManager } from "resource:///org/gnome/shell/extensions/extension.js";
import * as Main from "resource:///org/gnome/shell/ui/main.js";

export class ClockTakeover {
  /** @param {{ island: any }} params */
  constructor({ island }) {
    this._island = island;
    this._injections = new InjectionManager();
    this._dateMenu = Main.panel.statusArea.dateMenu ?? null;
    if (!this._dateMenu?.menu) return;

    const menu = this._dateMenu.menu;
    if (menu.isOpen) menu.close();
    const openIsland = () =>
      function () {
        island.openFromClock();
      };
    this._injections.overrideMethod(menu, "open", openIsland);
    this._injections.overrideMethod(menu, "toggle", openIsland);
    this._injections.overrideMethod(Main.panel, "toggleCalendar", openIsland);
    island.addHoverSource(this._dateMenu);
  }

  destroy() {
    this._injections.clear();
    if (this._dateMenu) this._island.removeHoverSource(this._dateMenu);
    this._dateMenu = null;
  }
}

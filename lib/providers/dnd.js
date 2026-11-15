/*
 * This file is part of the Nexsland GNOME extension.
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Do Not Disturb on/off HUD. GNOME's DND toggle is the inverse of
 * org.gnome.desktop.notifications show-banners.
 */

import Gio from "gi://Gio";
import { gettext as _ } from "resource:///org/gnome/shell/extensions/extension.js";

import { HUD_SIZE, buildInfoHud } from "./hud.js";

const ACTIVITY_ID = "dnd";
const DURATION_MS = 1500;

export class DndProvider {
  /** @param {{ engine: import("../engine/engine.js").IslandEngine }} params */
  constructor({ engine }) {
    this._engine = engine;
    this._settings = new Gio.Settings({ schema_id: "org.gnome.desktop.notifications" });
    this._changedId = this._settings.connect("changed::show-banners", () => this._announce());
  }

  destroy() {
    this._settings.disconnect(this._changedId);
    this._settings = null;
  }

  _announce() {
    const on = !this._settings.get_boolean("show-banners");
    this._engine.showTemporary(
      {
        id: ACTIVITY_ID,
        compact: {
          ...HUD_SIZE,
          build: () =>
            buildInfoHud({
              icon: on
                ? "notifications-disabled-symbolic"
                : "preferences-system-notifications-symbolic",
              text: _("Do Not Disturb"),
              detail: on ? _("On") : _("Off"),
              tone: on ? "accent" : "plain",
            }),
        },
      },
      DURATION_MS,
    );
  }
}

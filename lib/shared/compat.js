/*
 * This file is part of the Nexsland GNOME extension.
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Shims for St API differences across GNOME Shell 45-51.
 */

import Clutter from "gi://Clutter";
import St from "gi://St";

/**
 * A vertical St.BoxLayout. GNOME 48 deprecated BoxLayout:vertical in favour of
 * :orientation; use orientation where it exists so the layout keeps working once
 * the old property is gone, and fall back to vertical on older shells.
 * @param {object} [params] St.BoxLayout construct properties (without vertical)
 */
export function vbox(params = {}) {
  const box = new St.BoxLayout(params);
  if ("orientation" in box) box.orientation = Clutter.Orientation.VERTICAL;
  else box.vertical = true;
  return box;
}

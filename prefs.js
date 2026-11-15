/*
 * This file is part of the Nexsland GNOME extension.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import Adw from "gi://Adw";
import Gio from "gi://Gio";
import Gtk from "gi://Gtk";

import {
  ExtensionPreferences,
  gettext as _,
} from "resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js";

const ANIMATION_STYLES = ["bouncy", "smooth", "snappy"];
const ISLAND_STYLES = ["attached", "floating"];

export default class NexslandPreferences extends ExtensionPreferences {
  fillPreferencesWindow(window) {
    const settings = this.getSettings();
    window._settings = settings; // keep alive for the window's lifetime

    const page = new Adw.PreferencesPage({
      title: _("General"),
      icon_name: "preferences-system-symbolic",
    });

    const island = new Adw.PreferencesGroup({ title: _("Island") });
    island.add(
      this._combo(settings, "island-style", _("Style"), ISLAND_STYLES, [
        _("Attached to top bar"),
        _("Floating pill"),
      ]),
    );
    island.add(
      this._switch(
        settings,
        "open-on-hover",
        _("Open on hover"),
        _("Expand while the pointer rests on the island"),
      ),
    );
    island.add(
      this._switch(
        settings,
        "show-when-idle",
        _("Show when idle"),
        _("Keep a small pill visible when there is nothing to show"),
      ),
    );

    const offset = new Adw.SpinRow({
      title: _("Vertical offset"),
      subtitle: _("Floating style only: distance below the top bar, in pixels"),
      adjustment: new Gtk.Adjustment({ lower: -40, upper: 120, step_increment: 1 }),
    });
    settings.bind("vertical-offset", offset, "value", Gio.SettingsBindFlags.DEFAULT);
    island.add(offset);

    island.add(
      this._combo(settings, "animation-style", _("Animation style"), ANIMATION_STYLES, [
        _("Bouncy"),
        _("Smooth"),
        _("Snappy"),
      ]),
    );
    page.add(island);

    const activities = new Adw.PreferencesGroup({ title: _("Activities") });
    activities.add(
      this._switch(settings, "enable-media", _("Now Playing"), _("Media from MPRIS players")),
    );
    page.add(activities);

    const debug = new Adw.PreferencesGroup({ title: _("Debug") });
    debug.add(
      this._switch(
        settings,
        "logging-enabled",
        _("Logging"),
        _("Write debug output to the journal"),
      ),
    );
    page.add(debug);

    window.add(page);
  }

  /** Combo row bound to a string key whose values are `values`, shown as `labels`. */
  _combo(settings, key, title, values, labels) {
    const row = new Adw.ComboRow({ title, model: Gtk.StringList.new(labels) });
    const sync = () => {
      row.selected = Math.max(0, values.indexOf(settings.get_string(key)));
    };
    sync();
    row.connect("notify::selected", () =>
      settings.set_string(key, values[row.selected] ?? values[0]),
    );
    settings.connect(`changed::${key}`, sync);
    return row;
  }

  _switch(settings, key, title, subtitle) {
    const row = new Adw.SwitchRow({ title, subtitle });
    settings.bind(key, row, "active", Gio.SettingsBindFlags.DEFAULT);
    return row;
  }
}

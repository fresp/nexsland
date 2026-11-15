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

import { addBarPrefs } from "./lib/bar/prefs.js";

const ANIMATION_STYLES = ["bouncy", "smooth", "snappy"];
const ISLAND_STYLES = ["attached", "floating"];
const ISLAND_MONITORS = ["primary", "focused"];

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
      this._combo(settings, "island-monitor", _("Monitor"), ISLAND_MONITORS, [
        _("Primary monitor"),
        _("Monitor of the focused window"),
      ]),
    );
    island.add(
      this._switch(
        settings,
        "clock-in-island",
        _("Clock in the island"),
        _("Hide the top bar's clock; the island shows the time instead"),
      ),
    );
    island.add(
      this._switch(
        settings,
        "replace-clock-menu",
        _("Open from the clock"),
        _("The clock opens Nexsland instead of GNOME's notifications and calendar menu"),
      ),
    );
    island.add(
      this._switch(
        settings,
        "show-on-lock-screen",
        _("Show on lock screen"),
        _("Activities and HUDs only; the panel never opens while locked"),
      ),
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
        _(
          "Keep a small pill under the top bar when nothing is active, so the panel can still be opened",
        ),
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
    activities.add(
      this._switch(
        settings,
        "enable-osd",
        _("Volume and brightness"),
        _("Replace the stock on-screen display while the island is visible"),
      ),
    );
    activities.add(
      this._switch(
        settings,
        "enable-battery",
        _("Battery"),
        _("Charging, unplugged, fully charged and low battery"),
      ),
    );
    activities.add(
      this._switch(
        settings,
        "enable-bluetooth",
        _("Bluetooth"),
        _("Devices connecting and disconnecting"),
      ),
    );
    activities.add(
      this._switch(settings, "enable-network", _("Network"), _("Wi-Fi, wired and VPN connections")),
    );
    activities.add(
      this._switch(
        settings,
        "enable-dnd",
        _("Do Not Disturb"),
        _("When Do Not Disturb is turned on or off"),
      ),
    );
    activities.add(
      this._switch(
        settings,
        "enable-banners",
        _("Notifications"),
        _("Notification banners in the island instead of GNOME's"),
      ),
    );
    activities.add(
      this._switch(
        settings,
        "enable-recording",
        _("Screen recording"),
        _("Elapsed time and a stop button while recording"),
      ),
    );
    activities.add(
      this._switch(
        settings,
        "enable-privacy",
        _("Microphone in use"),
        _("Which apps are recording from the microphone"),
      ),
    );
    activities.add(
      this._switch(
        settings,
        "enable-downloads",
        _("Downloads"),
        _("Browser downloads in progress and finished"),
      ),
    );
    activities.add(
      this._switch(
        settings,
        "enable-nextile",
        _("NexTile"),
        _("Tiling changes and a Tiling tab; needs External control on in NexTile"),
      ),
    );
    page.add(activities);

    const bar = new Adw.PreferencesGroup({
      title: _("Top bar"),
      description: _("Bar, menu, dash and shell theming, continued from Open Bar"),
    });
    bar.add(
      this._switch(
        settings,
        "enable-bar",
        _("Theme the top bar"),
        _("Off by default; style it on the Top bar page"),
      ),
    );
    bar.add(
      this._switch(
        settings,
        "island-follow-bar",
        _("Island matches the bar"),
        _("Use the bar's background, text and border colours for the island"),
      ),
    );
    page.add(bar);

    const tabs = new Adw.PreferencesGroup({
      title: _("Panel tabs"),
      description: _("Shown when the island opens, after Home"),
    });
    tabs.add(
      this._switch(
        settings,
        "enable-notifications",
        _("Notifications"),
        _("The shell's notifications, Do Not Disturb and Clear"),
      ),
    );
    tabs.add(this._switch(settings, "enable-timer", _("Timer"), _("Countdown with presets")));
    tabs.add(this._switch(settings, "enable-calendar", _("Calendar"), _("Today and the month")));
    tabs.add(this._switch(settings, "enable-stats", _("System"), _("CPU, memory and network")));
    tabs.add(
      this._switch(
        settings,
        "enable-clipboard",
        _("Clipboard history"),
        _("Recent text copies, kept in memory only; password manager copies are skipped"),
      ),
    );
    page.add(tabs);

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

    // Top bar page: Open Bar's settings UI, for the Bar module.
    addBarPrefs(window, {
      settings: this.getSettings("org.gnome.shell.extensions.nexsland.bar"),
      path: `${this.path}/lib/bar`,
    });
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

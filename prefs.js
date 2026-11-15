/*
 * This file is part of the Nexsland GNOME extension.
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Preferences: five short pages (Island, Clock, Activities, Panel, Look). With
 * more pages than fit in the header, Adwaita moves the page switcher to a bar at
 * the bottom of the narrow window. About and debug sit behind the header's
 * info button.
 */

import Adw from "gi://Adw";
import Gio from "gi://Gio";
import GLib from "gi://GLib";
import Gtk from "gi://Gtk";

import {
  ExtensionPreferences,
  gettext as _,
} from "resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js";

import { LookPage, comboRow, spinRow, switchRow } from "./lib/prefs/look.js";

const ANIMATION_STYLES = ["bouncy", "smooth", "snappy"];
const ISLAND_STYLES = ["attached", "notch", "floating"];
const ISLAND_MONITORS = ["primary", "focused"];

/** The window's Adw.HeaderBar, found by walking its widget tree (it is not exposed). */
function findHeaderBar(widget) {
  if (widget instanceof Adw.HeaderBar) return widget;
  for (let child = widget.get_first_child(); child; child = child.get_next_sibling()) {
    const found = findHeaderBar(child);
    if (found) return found;
  }
  return null;
}

function page(title, iconName) {
  return new Adw.PreferencesPage({ title, icon_name: iconName });
}

export default class NexslandPreferences extends ExtensionPreferences {
  fillPreferencesWindow(window) {
    const settings = this.getSettings();
    const barSettings = this.getSettings("org.gnome.shell.extensions.nexsland.bar");
    window._settings = settings; // keep alive for the window's lifetime
    window._barSettings = barSettings;
    window.set_default_size(560, 820);

    // Before the pages: only the window's own chrome exists yet.
    findHeaderBar(window)?.pack_end(this._aboutButton(settings));

    window.add(this._islandPage(settings));
    window.add(this._clockPage(settings));
    window.add(this._activitiesPage(settings));
    window.add(this._panelPage(settings));
    window.add(new LookPage({ settings, barSettings, window }).page);
  }

  _islandPage(settings) {
    const p = page(_("Island"), "view-continuous-symbolic");

    const island = new Adw.PreferencesGroup({
      title: _("Island"),
      description: _("How the island looks and where it sits"),
    });
    island.add(
      comboRow(settings, "island-style", _("Style"), ISLAND_STYLES, [
        _("Attached to top bar"),
        _("Notch in the top bar"),
        _("Floating pill"),
      ]),
    );
    island.add(
      comboRow(settings, "island-monitor", _("Monitor"), ISLAND_MONITORS, [
        _("Primary monitor"),
        _("Monitor of the focused window"),
      ]),
    );
    island.add(
      comboRow(settings, "animation-style", _("Animation style"), ANIMATION_STYLES, [
        _("Bouncy"),
        _("Smooth"),
        _("Snappy"),
      ]),
    );
    const clockText = new Adw.EntryRow({ title: _("Text next to the clock") });
    settings.bind("clock-text", clockText, "text", Gio.SettingsBindFlags.DEFAULT);
    settings.bind("clock-in-island", clockText, "sensitive", Gio.SettingsBindFlags.GET);
    island.add(clockText);
    island.add(
      spinRow(
        settings,
        "vertical-offset",
        _("Vertical offset"),
        -40,
        120,
        _("Floating style only: distance below the top bar, in pixels"),
      ),
    );
    p.add(island);

    const behaviour = new Adw.PreferencesGroup({ title: _("Behaviour") });
    behaviour.add(
      switchRow(
        settings,
        "show-when-idle",
        _("Show when idle"),
        _("Keep the island shown when nothing is active"),
      ),
    );
    behaviour.add(
      switchRow(
        settings,
        "open-on-hover",
        _("Open on hover"),
        _("Expand while the pointer rests on the island"),
      ),
    );
    behaviour.add(
      switchRow(
        settings,
        "show-on-lock-screen",
        _("Show on lock screen"),
        _("Activities and HUDs only; the panel never opens while locked"),
      ),
    );
    p.add(behaviour);
    return p;
  }

  _clockPage(settings) {
    const p = page(_("Clock"), "preferences-system-time-symbolic");

    const clock = new Adw.PreferencesGroup({
      title: _("Clock"),
      description: _("The island shows the time instead of the top bar's clock"),
    });
    clock.add(
      switchRow(
        settings,
        "clock-in-island",
        _("Clock in the island"),
        _("Hide the top bar's clock; the island shows the time instead"),
      ),
    );
    const text = new Adw.EntryRow({ title: _("Text next to the clock") });
    settings.bind("clock-text", text, "text", Gio.SettingsBindFlags.DEFAULT);
    settings.bind("clock-in-island", text, "sensitive", Gio.SettingsBindFlags.GET);
    clock.add(text);
    p.add(clock);

    const shortcut = new Adw.PreferencesGroup({ title: _("Shortcut") });
    shortcut.add(
      switchRow(
        settings,
        "replace-clock-menu",
        _("Super+V opens the island"),
        _("Instead of GNOME's notifications and calendar menu"),
      ),
    );
    p.add(shortcut);
    return p;
  }

  _activitiesPage(settings) {
    const p = page(_("Activities"), "media-playback-start-symbolic");

    const system = new Adw.PreferencesGroup({
      title: _("System"),
      description: _("HUDs and live activities shown in the island"),
    });
    for (const [key, title, subtitle] of [
      ["enable-media", _("Now Playing"), _("MPRIS players")],
      ["enable-osd", _("Volume and brightness"), _("Replaces the stock on-screen display")],
      ["enable-battery", _("Battery"), _("Charging, unplugged and low battery")],
      ["enable-bluetooth", _("Bluetooth"), _("Devices connecting and disconnecting")],
      ["enable-network", _("Network"), _("Wi-Fi, wired and VPN connections")],
      ["enable-dnd", _("Do Not Disturb"), _("Turned on or off")],
    ])
      system.add(switchRow(settings, key, title, subtitle));
    p.add(system);

    const apps = new Adw.PreferencesGroup({ title: _("Apps") });
    for (const [key, title, subtitle] of [
      ["enable-banners", _("Notifications"), _("Instead of GNOME's banners")],
      ["enable-recording", _("Screen recording"), _("Elapsed time and a stop button")],
      ["enable-privacy", _("Microphone in use"), _("Which apps are recording")],
      ["enable-downloads", _("Downloads"), _("Browser downloads in progress and finished")],
      ["enable-nextile", _("NexTile"), _("Tiling changes; needs External control in NexTile")],
    ])
      apps.add(switchRow(settings, key, title, subtitle));
    p.add(apps);
    return p;
  }

  _panelPage(settings) {
    const p = page(_("Panel"), "view-grid-symbolic");
    const tabs = new Adw.PreferencesGroup({
      title: _("Panel tabs"),
      description: _("Tabs of the open island, after Home"),
    });
    for (const [key, title, subtitle] of [
      [
        "enable-notifications",
        _("Notifications"),
        _("The shell's notifications, Do Not Disturb and Clear"),
      ],
      ["enable-timer", _("Timer"), _("Countdown with presets")],
      ["enable-calendar", _("Calendar"), _("Events, months and days")],
      ["enable-stats", _("System"), _("CPU, memory and network")],
      [
        "enable-clipboard",
        _("Clipboard"),
        _("Recent text copies, kept in memory only; password manager copies are skipped"),
      ],
    ])
      tabs.add(switchRow(settings, key, title, subtitle));
    p.add(tabs);
    return p;
  }

  /** Header button with the version and the debug switch. */
  _aboutButton(settings) {
    const box = new Gtk.Box({
      orientation: Gtk.Orientation.VERTICAL,
      spacing: 12,
      margin_top: 12,
      margin_bottom: 12,
      margin_start: 12,
      margin_end: 12,
    });
    const name = this.metadata.name ?? "Nexsland";
    const version = this.metadata["version-name"] ?? `${this.metadata.version ?? ""}`;
    box.append(
      new Gtk.Label({
        label: `<b>${GLib.markup_escape_text(name, -1)}</b> ${GLib.markup_escape_text(version, -1)}`,
        use_markup: true,
        xalign: 0,
      }),
    );
    if (this.metadata.url) {
      box.append(
        new Gtk.LinkButton({
          label: _("Website"),
          uri: this.metadata.url,
          halign: Gtk.Align.START,
        }),
      );
    }
    const logging = new Gtk.Box({ spacing: 12 });
    logging.append(new Gtk.Label({ label: _("Debug logging"), hexpand: true, xalign: 0 }));
    const toggle = new Gtk.Switch({ valign: Gtk.Align.CENTER });
    settings.bind("logging-enabled", toggle, "active", Gio.SettingsBindFlags.DEFAULT);
    logging.append(toggle);
    box.append(logging);

    const popover = new Gtk.Popover({ child: box });
    return new Gtk.MenuButton({
      icon_name: "help-about-symbolic",
      tooltip_text: _("About"),
      popover,
    });
  }
}

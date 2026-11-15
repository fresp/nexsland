/*
 * This file is part of the Nexsland GNOME extension.
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The Look page: the top bar's style (the Bar module, continued from Open Bar),
 * cut down to what shapes the bar and the island. Colours follow Open Bar's
 * storage: an "r,g,b" string triplet of 0-1 floats plus a separate alpha key,
 * written to the key itself and to its dark-/light- copy for the current style,
 * and every change regenerates the bar's stylesheet by toggling trigger-reload
 * (debounced, as Open Bar's own preferences do).
 */

import Adw from "gi://Adw";
import Gdk from "gi://Gdk";
import Gio from "gi://Gio";
import GLib from "gi://GLib";
import Gtk from "gi://Gtk";

import { gettext as _ } from "resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js";

const BAR_TYPES = ["Mainland", "Floating", "Islands", "Trilands"];
const RELOAD_DEBOUNCE_MS = 400;

/** Keys this page writes: any change to them regenerates the stylesheet. */
const STYLE_KEYS = [
  "bartype",
  "height",
  "margin",
  "bgcolor",
  "bgalpha",
  "iscolor",
  "isalpha",
  "fgcolor",
  "fgalpha",
  "bcolor",
  "balpha",
  "bwidth",
  "bradius",
  "neon",
  "heffect",
  "hcolor",
  "halpha",
  "shadow",
  "shcolor",
  "shalpha",
  "wmaxbar",
  "bgcolor-wmax",
  "bgalpha-wmax",
  "neon-wmax",
];

export class LookPage {
  /**
   * @param {{ settings: Gio.Settings, barSettings: Gio.Settings, window: Adw.PreferencesWindow }} params
   */
  constructor({ settings, barSettings, window }) {
    this._bar = barSettings;
    this._reloadId = 0;
    this.page = new Adw.PreferencesPage({
      title: _("Look"),
      icon_name: "applications-graphics-symbolic",
    });

    const top = new Adw.PreferencesGroup({
      title: _("Top bar"),
      description: _("Off: GNOME's own top bar, and a black island"),
    });
    top.add(switchRow(settings, "enable-bar", _("Style the top bar"), _("Bar look from Open Bar")));
    top.add(
      switchRow(
        settings,
        "island-follow-bar",
        _("Island follows the bar"),
        _("Same colours, border and glow as the bar"),
      ),
    );
    top.add(
      comboRow(barSettings, "bartype", _("Bar style"), BAR_TYPES, [
        _("Mainland"),
        _("Floating"),
        _("Islands"),
        _("Trilands"),
      ]),
    );
    top.add(spinRow(barSettings, "height", _("Height"), 20, 100));
    top.add(spinRow(barSettings, "margin", _("Margin"), 0, 50));
    this.page.add(top);

    const colours = new Adw.PreferencesGroup({
      title: _("Colours"),
      description: _("For the current light or dark style"),
    });
    colours.add(this._colourRow("bgcolor", "bgalpha", _("Bar background")));
    colours.add(
      this._colourRow(
        "iscolor",
        "isalpha",
        _("Island background"),
        _("Pills on Islands and Trilands bars"),
      ),
    );
    colours.add(this._colourRow("fgcolor", "fgalpha", _("Text")));
    this.page.add(colours);

    const border = new Adw.PreferencesGroup({ title: _("Border") });
    border.add(this._colourRow("bcolor", "balpha", _("Colour")));
    border.add(spinRow(barSettings, "bwidth", _("Width"), 0, 10));
    border.add(spinRow(barSettings, "bradius", _("Radius"), 0, 50));
    this.page.add(border);

    const effects = new Adw.PreferencesGroup({ title: _("Effects") });
    effects.add(switchRow(barSettings, "neon", _("Neon glow"), _("In the border colour")));
    effects.add(
      switchRow(
        barSettings,
        "heffect",
        _("Hover effect"),
        _("Thicker border and glow in the hover colour"),
      ),
    );
    effects.add(this._colourRow("hcolor", "halpha", _("Hover colour")));
    effects.add(switchRow(barSettings, "shadow", _("Shadow")));
    effects.add(this._colourRow("shcolor", "shalpha", _("Shadow colour")));
    this.page.add(effects);

    const wmax = new Adw.PreferencesGroup({ title: _("Maximized windows") });
    wmax.add(switchRow(barSettings, "wmaxbar", _("Solid bar when a window is maximized")));
    wmax.add(this._colourRow("bgcolor-wmax", "bgalpha-wmax", _("Background")));
    wmax.add(switchRow(barSettings, "neon-wmax", _("Keep the neon glow")));
    this.page.add(wmax);

    // Everything but the on/off switch is about the styled bar.
    for (const group of [colours, border, effects, wmax])
      settings.bind("enable-bar", group, "sensitive", Gio.SettingsBindFlags.GET);

    this._changedId = barSettings.connect("changed", (_s, key) => {
      if (STYLE_KEYS.includes(key)) this._scheduleReload();
    });
    window.connect("close-request", () => {
      if (this._reloadId) GLib.source_remove(this._reloadId);
      this._reloadId = 0;
      barSettings.disconnect(this._changedId);
      return false;
    });
  }

  /** Regenerate the bar's stylesheet once changes settle (Open Bar's trigger-reload toggle). */
  _scheduleReload() {
    if (this._reloadId) GLib.source_remove(this._reloadId);
    this._reloadId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, RELOAD_DEBOUNCE_MS, () => {
      this._reloadId = 0;
      this._bar.set_boolean("trigger-reload", !this._bar.get_boolean("trigger-reload"));
      return GLib.SOURCE_REMOVE;
    });
  }

  /** A colour with its alpha, in one button. */
  _colourRow(colourKey, alphaKey, title, subtitle = null) {
    const bar = this._bar;
    const row = new Adw.ActionRow({ title, ...(subtitle ? { subtitle } : {}) });
    const button = new Gtk.ColorDialogButton({
      dialog: new Gtk.ColorDialog({ with_alpha: true, title }),
      valign: Gtk.Align.CENTER,
    });
    const read = () => {
      const [r, g, b] = bar.get_strv(colourKey).map(parseFloat);
      const rgba = new Gdk.RGBA();
      rgba.red = r || 0;
      rgba.green = g || 0;
      rgba.blue = b || 0;
      rgba.alpha = bar.get_double(alphaKey);
      return rgba;
    };
    let syncing = false;
    const sync = () => {
      syncing = true;
      button.rgba = read();
      syncing = false;
    };
    sync();
    button.connect("notify::rgba", () => {
      if (syncing) return;
      const { red, green, blue, alpha } = button.rgba;
      const rgb = [red, green, blue].map((v) => v.toFixed(3));
      // Open Bar keeps a copy per light/dark style and restores it on a switch.
      const prefix = bar.get_string("color-scheme") === "prefer-dark" ? "dark-" : "light-";
      bar.set_strv(colourKey, rgb);
      bar.set_strv(`${prefix}${colourKey}`, rgb);
      bar.set_double(alphaKey, Number(alpha.toFixed(3)));
    });
    bar.connect(`changed::${colourKey}`, sync);
    bar.connect(`changed::${alphaKey}`, sync);
    row.add_suffix(button);
    row.activatable_widget = button;
    return row;
  }
}

export function switchRow(settings, key, title, subtitle = null) {
  const row = new Adw.SwitchRow({ title, ...(subtitle ? { subtitle } : {}) });
  settings.bind(key, row, "active", Gio.SettingsBindFlags.DEFAULT);
  return row;
}

/** Combo row bound to a string key whose values are `values`, shown as `labels`. */
export function comboRow(settings, key, title, values, labels, subtitle = null) {
  const row = new Adw.ComboRow({
    title,
    ...(subtitle ? { subtitle } : {}),
    model: Gtk.StringList.new(labels),
  });
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

/** Spin row bound to a numeric key (int or double). */
export function spinRow(settings, key, title, lower, upper, subtitle = null) {
  const row = new Adw.SpinRow({
    title,
    ...(subtitle ? { subtitle } : {}),
    adjustment: new Gtk.Adjustment({ lower, upper, step_increment: 1, page_increment: 5 }),
  });
  settings.bind(key, row, "value", Gio.SettingsBindFlags.DEFAULT);
  return row;
}

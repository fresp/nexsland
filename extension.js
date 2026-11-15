/*
 * This file is part of the Nexsland GNOME extension.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import GLib from "gi://GLib";
import { Extension } from "resource:///org/gnome/shell/extensions/extension.js";
import * as Main from "resource:///org/gnome/shell/ui/main.js";

import { IslandEngine } from "./lib/engine/engine.js";
import { themeFromBar } from "./lib/engine/island-theme.js";
import { ClockTakeover } from "./lib/extension/clock.js";
import { Island } from "./lib/extension/island.js";
import { BatteryProvider } from "./lib/providers/battery.js";
import { MprisProvider } from "./lib/providers/mpris.js";
import { OsdProvider } from "./lib/providers/osd.js";
import { BluetoothProvider } from "./lib/providers/bluetooth.js";
import { NetworkProvider } from "./lib/providers/network.js";
import { DndProvider } from "./lib/providers/dnd.js";
import { RecordingProvider } from "./lib/providers/recording.js";
import { PrivacyProvider } from "./lib/providers/privacy.js";
import { DownloadsProvider } from "./lib/providers/downloads.js";
import { NexTileProvider } from "./lib/providers/nextile.js";
import { CalendarFeature } from "./lib/features/calendar.js";
import { ClipboardFeature } from "./lib/features/clipboard.js";
import { StatsFeature } from "./lib/features/stats.js";
import { TimerFeature } from "./lib/features/timer.js";
import { Logger } from "./lib/shared/logger.js";
import { SignalTracker } from "./lib/shared/signals.js";

/** Bar module keys the island's colours are taken from (lib/engine/island-theme.js). */
const BAR_THEME_KEYS = [
  "bartype",
  "bgcolor",
  "bgalpha",
  "iscolor",
  "isalpha",
  "fgcolor",
  "fgalpha",
  "bcolor",
  "balpha",
  "bwidth",
];
const BAR_THEME_DEBOUNCE_MS = 100;

/**
 * Everything that can be toggled from prefs: settings key -> constructor.
 * Instances with a `tab` also add a panel tab, in this order.
 */
const PROVIDERS = {
  "enable-media": MprisProvider,
  "enable-osd": OsdProvider,
  "enable-battery": BatteryProvider,
  "enable-bluetooth": BluetoothProvider,
  "enable-network": NetworkProvider,
  "enable-dnd": DndProvider,
  "enable-recording": RecordingProvider,
  "enable-privacy": PrivacyProvider,
  "enable-timer": TimerFeature,
  "enable-calendar": CalendarFeature,
  "enable-stats": StatsFeature,
  "enable-clipboard": ClipboardFeature,
  "enable-downloads": DownloadsProvider,
  "enable-nextile": NexTileProvider,
};

export default class NexslandExtension extends Extension {
  enable() {
    this._settings = this.getSettings();
    Logger.init(this._settings);
    Logger.info("enable");

    // GNOME Shell does not call disable() when enable() throws, so tear down
    // whatever was built before rethrowing.
    try {
      this._timers = new Set();
      const scheduler = (this._scheduler = this._makeScheduler());
      this._engine = new IslandEngine({ scheduler });
      this._island = new Island({ engine: this._engine, settings: this._settings, scheduler });
      this._providers = new Map();
      this._signals = new SignalTracker();
      for (const key of Object.keys(PROVIDERS)) {
        this._signals.track(this._settings, `changed::${key}`, () => {
          this._syncProvider(key);
          this._syncTabs();
        });
        this._syncProvider(key);
      }
      this._syncTabs();
      this._signals.track(this._settings, "changed::enable-bar", () => {
        this._syncBar();
        this._syncIslandTheme();
      });
      this._signals.track(this._settings, "changed::island-follow-bar", () =>
        this._syncIslandTheme(),
      );
      this._syncBar();
      this._syncIslandTheme();
      this._signals.track(this._settings, "changed::replace-clock-menu", () => this._syncClock());
      this._syncClock();
    } catch (e) {
      try {
        this.disable();
      } catch (cleanupError) {
        Logger.error(`enable: cleanup after failed enable also failed: ${cleanupError}`);
      }
      throw e;
    }
  }

  disable() {
    Logger.info("disable");
    this._signals?.disconnectAll();
    this._signals = null;
    this._barGeneration = (this._barGeneration ?? 0) + 1; // cancels a pending lazy load
    this._stopBar();
    this._stopIslandTheme();
    this._clock?.destroy();
    this._clock = null;
    for (const provider of this._providers?.values() ?? []) provider.destroy();
    this._providers = null;
    this._island?.teardown();
    this._island = null;
    this._engine?.destroy();
    this._engine = null;
    for (const id of this._timers ?? []) GLib.source_remove(id);
    this._timers = null;
    this._scheduler = null;
    this._settings = null;
    Logger.destroy();
  }

  _syncProvider(key) {
    const wanted = this._settings.get_boolean(key);
    const running = this._providers.get(key);
    if (wanted && !running) {
      try {
        this._providers.set(
          key,
          new PROVIDERS[key]({
            engine: this._engine,
            scheduler: this._scheduler,
            canPresent: (monitorIndex) => this._island?.canPresent(monitorIndex) ?? false,
            invalidateTabs: () => this._syncTabs(),
          }),
        );
      } catch (e) {
        Logger.error(`provider ${key} failed to start: ${e}`);
      }
    } else if (!wanted && running) {
      running.destroy();
      this._providers.delete(key);
    }
  }

  /**
   * Top bar theming (lib/bar, continued from Open Bar). Loaded lazily: when it is
   * off, none of its code runs, and its module-scope setup never happens before
   * enable().
   */
  async _syncBar() {
    const wanted = this._settings?.get_boolean("enable-bar") ?? false;
    if (!wanted) {
      this._barGeneration = (this._barGeneration ?? 0) + 1;
      this._stopBar();
      return;
    }
    if (this._bar) return;
    const generation = (this._barGeneration = (this._barGeneration ?? 0) + 1);
    try {
      const { OpenBar } = await import("./lib/bar/bar.js");
      // Disabled, or the setting flipped, while the module was loading.
      if (generation !== this._barGeneration || !this._settings || this._bar) return;
      this._bar = new OpenBar({
        settings: this.getSettings("org.gnome.shell.extensions.nexsland.bar"),
        path: `${this.path}/lib/bar`,
      });
      this._bar.enable();
    } catch (e) {
      Logger.error(`bar: failed to start: ${e}`);
      this._stopBar();
    }
  }

  _stopBar() {
    if (!this._bar) return;
    try {
      this._bar.disable();
    } catch (e) {
      Logger.error(`bar: failed to stop cleanly: ${e}`);
    }
    this._bar = null;
  }

  /** The clock opens Nexsland instead of GNOME's date menu (replace-clock-menu). */
  _syncClock() {
    const wanted = this._settings?.get_boolean("replace-clock-menu") ?? false;
    if (wanted && !this._clock && this._island) {
      try {
        this._clock = new ClockTakeover({ island: this._island });
      } catch (e) {
        Logger.error(`clock: takeover failed: ${e}`);
        this._clock = null;
      }
    } else if (!wanted && this._clock) {
      this._clock.destroy();
      this._clock = null;
    }
  }

  /** Island colours follow the bar while the Bar module and island-follow-bar are on. */
  _syncIslandTheme() {
    const follow =
      this._settings?.get_boolean("enable-bar") && this._settings?.get_boolean("island-follow-bar");
    if (!follow) {
      this._stopIslandTheme();
      return;
    }
    if (!this._themeSignals) {
      this._barThemeSettings = this.getSettings("org.gnome.shell.extensions.nexsland.bar");
      this._themeSignals = new SignalTracker();
      this._themeSignals.track(this._barThemeSettings, "changed", (_s, key) => {
        if (BAR_THEME_KEYS.includes(key)) this._scheduleIslandTheme();
      });
    }
    this._applyIslandTheme();
  }

  _scheduleIslandTheme() {
    if (this._themeTimer) this._scheduler.clearTimeout(this._themeTimer);
    this._themeTimer = this._scheduler.setTimeout(() => {
      this._themeTimer = null;
      this._applyIslandTheme();
    }, BAR_THEME_DEBOUNCE_MS);
  }

  _applyIslandTheme() {
    const bar = this._barThemeSettings;
    if (!bar || !this._island) return;
    const values = Object.fromEntries(
      BAR_THEME_KEYS.map((key) => [key, bar.get_value(key).deepUnpack()]),
    );
    this._island.setTheme(themeFromBar(values));
    // On an Islands/Trilands bar the clock is its own pill: merge the island into it.
    const pill = values.bartype === "Islands" || values.bartype === "Trilands";
    this._island.setAnchor(pill ? (Main.panel.statusArea.dateMenu ?? null) : null);
  }

  _stopIslandTheme() {
    if (this._themeTimer) this._scheduler?.clearTimeout(this._themeTimer);
    this._themeTimer = null;
    this._themeSignals?.disconnectAll();
    this._themeSignals = null;
    this._barThemeSettings = null;
    this._island?.setTheme(null);
    this._island?.setAnchor(null);
  }

  _syncTabs() {
    const tabs = Object.keys(PROVIDERS)
      .map((key) => this._providers.get(key)?.tab)
      .filter(Boolean);
    this._island?.setTabs(tabs);
  }

  /** GLib-backed timers owned by the extension, so disable() can remove any still pending. */
  _makeScheduler() {
    return {
      setTimeout: (fn, ms) => {
        const id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
          this._timers?.delete(id);
          fn();
          return GLib.SOURCE_REMOVE;
        });
        this._timers.add(id);
        return id;
      },
      clearTimeout: (id) => {
        if (this._timers?.delete(id)) GLib.source_remove(id);
      },
    };
  }
}

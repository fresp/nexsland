/*
 * This file is part of the Nexsland GNOME extension.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import GLib from "gi://GLib";
import { Extension } from "resource:///org/gnome/shell/extensions/extension.js";

import { IslandEngine } from "./lib/engine/engine.js";
import { Island } from "./lib/extension/island.js";
import { BatteryProvider } from "./lib/providers/battery.js";
import { MprisProvider } from "./lib/providers/mpris.js";
import { OsdProvider } from "./lib/providers/osd.js";
import { BluetoothProvider } from "./lib/providers/bluetooth.js";
import { NetworkProvider } from "./lib/providers/network.js";
import { DndProvider } from "./lib/providers/dnd.js";
import { RecordingProvider } from "./lib/providers/recording.js";
import { PrivacyProvider } from "./lib/providers/privacy.js";
import { CalendarFeature } from "./lib/features/calendar.js";
import { ClipboardFeature } from "./lib/features/clipboard.js";
import { StatsFeature } from "./lib/features/stats.js";
import { TimerFeature } from "./lib/features/timer.js";
import { Logger } from "./lib/shared/logger.js";
import { SignalTracker } from "./lib/shared/signals.js";

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

/*
 * This file is part of the Nexsland GNOME extension.
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * System stats tab: CPU, memory and network throughput from /proc, read
 * asynchronously every 2s and only while the tab is on screen.
 */

import Clutter from "gi://Clutter";
import Gio from "gi://Gio";
import GLib from "gi://GLib";
import St from "gi://St";
import { gettext as _ } from "resource:///org/gnome/shell/extensions/extension.js";

import { Logger } from "../shared/logger.js";
import {
  cpuPercent,
  formatBytes,
  netRates,
  parseMeminfo,
  parseNetDev,
  parseProcStat,
} from "./stats-model.js";
import { vbox } from "../shared/compat.js";

const POLL_MS = 2000;
const BAR_WIDTH = 260;

function readText(path, cancellable) {
  return new Promise((resolve, reject) => {
    Gio.File.new_for_path(path).load_contents_async(cancellable, (file, res) => {
      try {
        const [, bytes] = file.load_contents_finish(res);
        resolve(new TextDecoder().decode(bytes));
      } catch (e) {
        reject(e);
      }
    });
  });
}

function statRow(title) {
  const row = new St.BoxLayout({ style_class: "nexsland-stat-row", x_expand: true });
  row.add_child(
    new St.Label({
      text: title,
      style_class: "nexsland-stat-title",
      y_align: Clutter.ActorAlign.CENTER,
    }),
  );
  const track = new St.BoxLayout({
    style_class: "nexsland-hud-track",
    width: BAR_WIDTH,
    y_align: Clutter.ActorAlign.CENTER,
  });
  const fill = new St.Widget({
    style_class: "nexsland-hud-fill",
    y_expand: true,
  });
  track.add_child(fill);
  const value = new St.Label({
    text: "…",
    style_class: "nexsland-stat-value",
    x_expand: true,
    x_align: Clutter.ActorAlign.END,
    y_align: Clutter.ActorAlign.CENTER,
  });
  row.add_child(track);
  row.add_child(value);
  return { row, fill, value, track };
}

export class StatsFeature {
  /**
   * @param {{ scheduler: { setTimeout: (fn: () => void, ms: number) => number, clearTimeout: (id: number) => void } }} params
   */
  constructor({ scheduler }) {
    this._scheduler = scheduler;
    this._timer = null;
    this._view = null;
    this._generation = 0;
    this._cancellable = null;
    this._prev = null;
    this.tab = {
      id: "stats",
      icon: "utilities-system-monitor-symbolic",
      title: _("System"),
      build: () => this._build(),
      hidden: () => this._stop(),
    };
  }

  destroy() {
    this._stop();
  }

  _build() {
    this._stop();
    const box = vbox({ style_class: "nexsland-stats", x_expand: true });
    const cpu = statRow(_("CPU"));
    const mem = statRow(_("Memory"));
    const net = statRow(_("Network"));
    net.track.visible = false;
    box.add_child(cpu.row);
    box.add_child(mem.row);
    box.add_child(net.row);
    this._view = { cpu, mem, net };
    this._generation++;
    this._cancellable = new Gio.Cancellable();
    this._poll(this._generation);
    return box;
  }

  _stop() {
    this._generation++;
    this._cancellable?.cancel();
    this._cancellable = null;
    if (this._timer !== null) this._scheduler.clearTimeout(this._timer);
    this._timer = null;
    this._view = null;
    this._prev = null;
  }

  async _poll(generation) {
    try {
      const [stat, meminfo, netdev] = await Promise.all(
        ["/proc/stat", "/proc/meminfo", "/proc/net/dev"].map((p) => readText(p, this._cancellable)),
      );
      if (generation !== this._generation || !this._view) return;
      const sample = {
        at: GLib.get_monotonic_time(),
        cpu: parseProcStat(stat),
        net: parseNetDev(netdev),
      };
      const mem = parseMeminfo(meminfo);
      this._render(sample, mem);
      this._prev = sample;
    } catch (e) {
      if (generation !== this._generation) return;
      Logger.warn(`stats: ${e}`);
    }
    if (generation !== this._generation) return;
    this._timer = this._scheduler.setTimeout(() => {
      this._timer = null;
      this._poll(generation);
    }, POLL_MS);
  }

  _render(sample, mem) {
    const { cpu, mem: memRow, net } = this._view;
    const setBar = (row, percent) => {
      row.fill.width = Math.round((BAR_WIDTH * Math.min(100, Math.max(0, percent))) / 100);
    };
    if (this._prev) {
      const busy = cpuPercent(this._prev.cpu, sample.cpu);
      setBar(cpu, busy);
      cpu.value.text = `${Math.round(busy)}%`;
      const rates = netRates(this._prev.net, sample.net, (sample.at - this._prev.at) / 1e6);
      net.value.text = `↓ ${formatBytes(rates.rx)}/s   ↑ ${formatBytes(rates.tx)}/s`;
    }
    if (mem) {
      setBar(memRow, mem.percent);
      memRow.value.text = `${formatBytes(mem.usedBytes)} / ${formatBytes(mem.totalBytes)}`;
    }
  }
}

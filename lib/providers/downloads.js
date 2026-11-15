/*
 * This file is part of the Nexsland GNOME extension.
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Downloads, heuristically: watches the XDG Downloads folder for browsers'
 * partial files (see downloads-model.js). While any are active the island shows a
 * live activity with the name and bytes received so far; a finished download gets
 * a short HUD. Browsers do not expose the total size, so there is no percentage.
 * Partial files already present when the extension starts are ignored.
 */

import Gio from "gi://Gio";
import GLib from "gi://GLib";
import { gettext as _, ngettext } from "resource:///org/gnome/shell/extensions/extension.js";

import { formatBytes } from "../features/stats-model.js";
import { Logger } from "../shared/logger.js";
import { DownloadTracker } from "./downloads-model.js";
import { HUD_SIZE, buildInfoHud, updateInfoHud } from "./hud.js";

const ACTIVITY_ID = "downloads";
const PRIORITY = 60;
const SIZE_POLL_MS = 1000;
const DONE_HUD_MS = 3000;

export class DownloadsProvider {
  /**
   * @param {{
   *   engine: import("../engine/engine.js").IslandEngine,
   *   scheduler: { setTimeout: (fn: () => void, ms: number) => number, clearTimeout: (id: number) => void },
   * }} params
   */
  constructor({ engine, scheduler }) {
    this._engine = engine;
    this._scheduler = scheduler;
    this._tracker = new DownloadTracker();
    this._pollId = null;
    this._shown = false;
    this._cancellable = new Gio.Cancellable();

    const path = GLib.get_user_special_dir(GLib.UserDirectory.DIRECTORY_DOWNLOAD);
    this._dir = path ? Gio.File.new_for_path(path) : null;
    this._monitor = null;
    if (!this._dir) {
      Logger.info("downloads: no XDG Downloads folder; disabled");
      return;
    }
    try {
      this._monitor = this._dir.monitor_directory(Gio.FileMonitorFlags.WATCH_MOVES, null);
      this._changedId = this._monitor.connect("changed", (_m, file, other, type) =>
        this._onChanged(file, other, type),
      );
    } catch (e) {
      Logger.info(`downloads: cannot watch ${path}: ${e}`);
      this._monitor = null;
    }
  }

  destroy() {
    this._cancellable.cancel();
    this._stopPolling();
    if (this._monitor) {
      this._monitor.disconnect(this._changedId);
      this._monitor.cancel();
    }
    this._monitor = null;
    if (this._shown) this._engine.hideLive(ACTIVITY_ID);
    this._shown = false;
  }

  _onChanged(file, other, type) {
    const name = file?.get_basename();
    if (!name) return;
    const E = Gio.FileMonitorEvent;
    let event;
    switch (type) {
      case E.CREATED:
      case E.MOVED_IN:
        event = this._tracker.created(name);
        break;
      case E.RENAMED:
        event = other ? this._tracker.renamed(name, other.get_basename()) : null;
        break;
      case E.DELETED:
      case E.MOVED_OUT:
        // A stat of one file in the Downloads folder; cheap enough to do inline.
        event = this._tracker.deleted(name, (finalName) =>
          this._dir.get_child(finalName).query_exists(null),
        );
        break;
      default:
        return;
    }
    if (event?.kind === "completed") this._announceDone(event.name);
    this._sync();
  }

  _announceDone(name) {
    this._engine.showTemporary(
      {
        id: "download-done",
        compact: {
          ...HUD_SIZE,
          build: () =>
            buildInfoHud({
              icon: "folder-download-symbolic",
              text: name,
              detail: _("Downloaded"),
              tone: "accent",
            }),
        },
      },
      DONE_HUD_MS,
    );
  }

  _sync() {
    const { count, name, bytes } = this._tracker.summary();
    if (count === 0) {
      this._stopPolling();
      if (this._shown) this._engine.hideLive(ACTIVITY_ID);
      this._shown = false;
      return;
    }
    const text = count === 1 ? name : ngettext("%d download", "%d downloads", count).format(count);
    const detail = formatBytes(bytes);
    this._shown = true;
    this._engine.showLive({
      id: ACTIVITY_ID,
      priority: PRIORITY,
      compact: {
        ...HUD_SIZE,
        build: () =>
          buildInfoHud({ icon: "folder-download-symbolic", text, detail, tone: "plain" }),
        update: (actor) => updateInfoHud(actor, { text, detail }),
      },
    });
    if (this._pollId === null) this._schedulePoll();
  }

  _schedulePoll() {
    this._pollId = this._scheduler.setTimeout(() => {
      this._pollId = null;
      this._pollSizes();
    }, SIZE_POLL_MS);
  }

  _stopPolling() {
    if (this._pollId !== null) this._scheduler.clearTimeout(this._pollId);
    this._pollId = null;
  }

  _pollSizes() {
    const names = [...this._tracker.active.keys()];
    let pending = names.length;
    if (pending === 0) return;
    for (const fileName of names) {
      this._dir
        .get_child(fileName)
        .query_info_async(
          "standard::size",
          Gio.FileQueryInfoFlags.NONE,
          GLib.PRIORITY_LOW,
          this._cancellable,
          (file, res) => {
            try {
              this._tracker.setSize(fileName, file.query_info_finish(res).get_size());
            } catch {
              // Renamed or removed meanwhile; the monitor reports it.
            }
            if (--pending === 0 && !this._cancellable.is_cancelled()) this._sync();
          },
        );
    }
  }
}

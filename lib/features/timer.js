/*
 * This file is part of the Nexsland GNOME extension.
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Countdown timer: a panel tab to start/pause/reset it, a live activity (amber
 * countdown chip, priority 70) while it runs, and a HUD plus the theme's
 * "complete" sound when it ends.
 */

import Clutter from "gi://Clutter";
import GLib from "gi://GLib";
import St from "gi://St";
import { gettext as _ } from "resource:///org/gnome/shell/extensions/extension.js";

import { formatElapsed } from "../providers/format.js";
import {
  CHIP_SIZE,
  HUD_SIZE,
  buildInfoHud,
  buildTimerChip,
  updateTimerChip,
} from "../providers/hud.js";
import { Logger } from "../shared/logger.js";
import { CountdownTimer, TIMER_PRESETS_MIN } from "./timer-model.js";

const ACTIVITY_ID = "timer";
const PRIORITY = 70;
const DONE_HUD_MS = 4000;

const nowMs = () => GLib.get_monotonic_time() / 1000;

function pillButton(label, onClick, extraClass = "") {
  const button = new St.Button({
    label,
    style_class: `nexsland-pill-button ${extraClass}`.trim(),
    can_focus: true,
  });
  // eslint-disable-next-line local/no-untracked-connect -- actor-lifetime-bound: freed with the button
  button.connect("clicked", () => {
    onClick();
    return Clutter.EVENT_STOP;
  });
  return button;
}

export class TimerFeature {
  /**
   * @param {{
   *   engine: import("../engine/engine.js").IslandEngine,
   *   scheduler: { setTimeout: (fn: () => void, ms: number) => number, clearTimeout: (id: number) => void },
   * }} params
   */
  constructor({ engine, scheduler }) {
    this._engine = engine;
    this._scheduler = scheduler;
    this._timer = new CountdownTimer();
    this._tickId = null;
    this._live = false;
    /** @type {Set<() => void>} view updaters of currently built timer views */
    this._views = new Set();
    this.tab = {
      id: "timer",
      icon: "alarm-symbolic",
      title: _("Timer"),
      build: () => this._buildView(),
    };
  }

  destroy() {
    this._stopTicking();
    if (this._live) this._engine.hideLive(ACTIVITY_ID);
    this._live = false;
    this._views.clear();
  }

  start(ms) {
    this._timer.start(ms, nowMs());
    this._tick();
  }

  _toggle() {
    if (this._timer.state === "running") {
      this._timer.pause(nowMs());
      this._stopTicking();
      this._refresh();
    } else if (this._timer.state === "paused") {
      this._timer.resume(nowMs());
      this._tick();
    }
  }

  _extend(ms) {
    this._timer.extend(ms, nowMs());
    this._refresh();
  }

  _reset() {
    this._timer.reset();
    this._stopTicking();
    this._refresh();
  }

  _tick() {
    this._stopTicking();
    const now = nowMs();
    if (this._timer.isDone(now)) {
      this._finish();
      return;
    }
    this._refresh();
    if (this._timer.state !== "running") return;
    // Next update when the displayed second changes.
    const delay = (this._timer.remaining(now) % 1000) + 5;
    this._tickId = this._scheduler.setTimeout(() => {
      this._tickId = null;
      this._tick();
    }, delay);
  }

  _stopTicking() {
    if (this._tickId !== null) this._scheduler.clearTimeout(this._tickId);
    this._tickId = null;
  }

  _text() {
    return formatElapsed(Math.ceil(this._timer.remaining(nowMs()) / 1000));
  }

  _refresh() {
    for (const update of this._views) update();
    const state = this._timer.state;
    if (state === "idle") {
      if (this._live) this._engine.hideLive(ACTIVITY_ID);
      this._live = false;
      return;
    }
    const text = this._text();
    const paused = state === "paused";
    this._live = true;
    this._engine.showLive({
      id: ACTIVITY_ID,
      priority: PRIORITY,
      expandable: true,
      compact: {
        ...CHIP_SIZE,
        build: () => buildTimerChip(text, paused),
        update: (actor) => updateTimerChip(actor, text, paused),
      },
      expanded: { ...CHIP_SIZE, build: () => this._buildView() },
    });
  }

  _finish() {
    this._timer.reset();
    this._refresh();
    this._engine.showTemporary(
      {
        id: "timer-done",
        compact: {
          ...HUD_SIZE,
          build: () =>
            buildInfoHud({ icon: "alarm-symbolic", text: _("Timer done"), tone: "accent" }),
        },
      },
      DONE_HUD_MS,
    );
    try {
      global.display.get_sound_player().play_from_theme("complete", _("Timer done"), null);
    } catch (e) {
      Logger.debug(`timer: no sound: ${e}`);
    }
  }

  _buildView() {
    const box = new St.BoxLayout({
      vertical: true,
      style_class: "nexsland-timer",
      x_expand: true,
      y_expand: true,
      x_align: Clutter.ActorAlign.CENTER,
      y_align: Clutter.ActorAlign.CENTER,
    });
    const time = new St.Label({
      style_class: "nexsland-timer-time",
      x_align: Clutter.ActorAlign.CENTER,
    });
    const presets = new St.BoxLayout({
      style_class: "nexsland-row",
      x_align: Clutter.ActorAlign.CENTER,
    });
    for (const minutes of TIMER_PRESETS_MIN) {
      presets.add_child(
        pillButton(_("%d min").format(minutes), () => this.start(minutes * 60_000)),
      );
    }
    const controls = new St.BoxLayout({
      style_class: "nexsland-row",
      x_align: Clutter.ActorAlign.CENTER,
    });
    const toggle = pillButton("", () => this._toggle(), "primary");
    controls.add_child(toggle);
    controls.add_child(pillButton(_("+1 min"), () => this._extend(60_000)));
    controls.add_child(pillButton(_("Reset"), () => this._reset()));
    box.add_child(time);
    box.add_child(presets);
    box.add_child(controls);

    const update = () => {
      const state = this._timer.state;
      time.text = state === "idle" ? "00:00" : this._text();
      presets.visible = state === "idle";
      controls.visible = state !== "idle";
      toggle.label = state === "running" ? _("Pause") : _("Resume");
    };
    this._views.add(update);
    // eslint-disable-next-line local/no-untracked-connect -- actor-lifetime-bound: runs once, as the view dies
    box.connect("destroy", () => this._views.delete(update));
    update();
    return box;
  }
}

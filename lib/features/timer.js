/*
 * This file is part of the Nexsland GNOME extension.
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Countdown timer: a panel tab to start/pause/reset it, a live activity (amber
 * countdown chip, priority 70) while it runs, and a HUD plus the theme's
 * "complete" sound when it ends.
 *
 * The tab's Pomodoro mode runs the same countdown through focus and break rounds
 * (pomodoro-model.js): each phase that ends starts the next one, and the chip
 * shows the phase and the rounds done.
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
import { POMODORO_OPTIONS, PomodoroCycle, nextOption } from "./pomodoro-model.js";
import { CountdownTimer, TIMER_PRESETS_MIN } from "./timer-model.js";
import { vbox } from "../shared/compat.js";

const ACTIVITY_ID = "timer";
const PRIORITY = 70;
const DONE_HUD_MS = 4000;
const POMODORO_EXTEND_MIN = 5;

/** Pomodoro settings, in the order of the panel's pills: [config field, key, options]. */
const POMODORO_KEYS = [
  ["focusMin", "pomodoro-focus-minutes", POMODORO_OPTIONS.focus],
  ["breakMin", "pomodoro-break-minutes", POMODORO_OPTIONS.break],
  ["longMin", "pomodoro-long-break-minutes", POMODORO_OPTIONS.long],
  ["rounds", "pomodoro-rounds", POMODORO_OPTIONS.rounds],
];

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
   *   settings: any,
   * }} params
   */
  constructor({ engine, scheduler, settings }) {
    this._engine = engine;
    this._scheduler = scheduler;
    this._settings = settings;
    this._timer = new CountdownTimer();
    /** @type {"timer" | "pomodoro"} what the idle view offers to start */
    this._mode = "timer";
    /** @type {PomodoroCycle | null} the rounds being run, null for a plain countdown */
    this._pomodoro = null;
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
    this._pomodoro = null;
    this._timer.start(ms, nowMs());
    this._tick();
  }

  _pomodoroConfig() {
    return Object.fromEntries(
      POMODORO_KEYS.map(([field, key]) => [field, this._settings.get_int(key)]),
    );
  }

  _startPomodoro() {
    this._pomodoro = new PomodoroCycle(this._pomodoroConfig());
    this._startPhase();
  }

  _startPhase() {
    this._timer.start(this._pomodoro.minutes * 60_000, nowMs());
    this._tick();
  }

  /** What the chip shows about the rounds, or null for a plain countdown. */
  _pomodoroChip() {
    const cycle = this._pomodoro;
    if (!cycle) return null;
    return {
      focus: cycle.phase === "focus",
      label: this._phaseLabel(cycle.phase),
      done: cycle.roundsDone,
      rounds: cycle.rounds,
    };
  }

  _phaseLabel(phase) {
    if (phase === "focus") return _("Focus");
    return phase === "long" ? _("Long break") : _("Break");
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
    this._pomodoro = null;
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
        build: () => buildTimerChip(text, paused, this._pomodoroChip()),
        update: (actor) => updateTimerChip(actor, text, paused, this._pomodoroChip()),
      },
      expanded: { ...CHIP_SIZE, build: () => this._buildView() },
    });
  }

  /** The countdown ended (or its phase was skipped): start the next phase, or stop. */
  _finish() {
    const cycle = this._pomodoro;
    let text = _("Timer done");
    let detail = "";
    if (cycle) {
      const ended = cycle.phase;
      if (cycle.advance()) {
        text = ended === "focus" ? _("Focus done") : _("Break over");
        // Translators: the phase that starts now and its length, e.g. "Break 5 min"
        detail = _("%s %d min").format(this._phaseLabel(cycle.phase), cycle.minutes);
      } else {
        text = _("Pomodoro done");
        this._pomodoro = null;
      }
    }
    if (this._pomodoro) {
      this._startPhase();
    } else {
      this._timer.reset();
      this._stopTicking();
      this._refresh();
    }
    this._engine.showTemporary(
      {
        id: "timer-done",
        compact: {
          ...HUD_SIZE,
          build: () => buildInfoHud({ icon: "alarm-symbolic", text, detail, tone: "accent" }),
        },
      },
      DONE_HUD_MS,
    );
    try {
      global.display.get_sound_player().play_from_theme("complete", text, null);
    } catch (e) {
      Logger.debug(`timer: no sound: ${e}`);
    }
  }

  _buildView() {
    const box = vbox({
      style_class: "nexsland-timer",
      x_expand: true,
      y_expand: true,
      x_align: Clutter.ActorAlign.CENTER,
      y_align: Clutter.ActorAlign.CENTER,
    });
    const row = () =>
      new St.BoxLayout({ style_class: "nexsland-row", x_align: Clutter.ActorAlign.CENTER });

    // Idle: which kind of countdown to start.
    const modes = row();
    const modeButtons = [
      ["timer", _("Timer")],
      ["pomodoro", _("Pomodoro")],
    ].map(([mode, label]) => {
      const button = pillButton(label, () => {
        this._mode = mode;
        this._refresh();
      });
      button.toggle_mode = true;
      modes.add_child(button);
      return [mode, button];
    });

    const phase = new St.Label({
      style_class: "nexsland-timer-phase",
      x_align: Clutter.ActorAlign.CENTER,
    });
    const time = new St.Label({
      style_class: "nexsland-timer-time",
      x_align: Clutter.ActorAlign.CENTER,
    });

    const presets = row();
    for (const minutes of TIMER_PRESETS_MIN) {
      presets.add_child(
        pillButton(_("%d min").format(minutes), () => this.start(minutes * 60_000)),
      );
    }

    // Pomodoro lengths: each pill steps through its options and keeps the choice.
    const lengths = row();
    const lengthLabels = {
      focusMin: (n) => _("Focus %d").format(n),
      breakMin: (n) => _("Break %d").format(n),
      longMin: (n) => _("Long %d").format(n),
      rounds: (n) => _("× %d").format(n),
    };
    const lengthButtons = POMODORO_KEYS.map(([field, key, options]) => {
      const button = pillButton("", () => {
        this._settings.set_int(key, nextOption(options, this._settings.get_int(key)));
        this._refresh();
      });
      lengths.add_child(button);
      return [field, key, button];
    });
    const startRow = row();
    startRow.add_child(pillButton(_("Start focus"), () => this._startPomodoro(), "primary"));

    const controls = row();
    const toggle = pillButton("", () => this._toggle(), "primary");
    const skip = pillButton(_("Skip"), () => this._finish());
    const extend = pillButton("", () =>
      this._extend((this._pomodoro ? POMODORO_EXTEND_MIN : 1) * 60_000),
    );
    const reset = pillButton("", () => this._reset());
    for (const button of [toggle, skip, extend, reset]) controls.add_child(button);

    for (const child of [modes, phase, time, presets, lengths, startRow, controls])
      box.add_child(child);

    const update = () => {
      const state = this._timer.state;
      const idle = state === "idle";
      const cycle = this._pomodoro;
      const pomodoroIdle = idle && this._mode === "pomodoro";

      modes.visible = idle;
      for (const [mode, button] of modeButtons) button.checked = mode === this._mode;
      presets.visible = idle && !pomodoroIdle;
      lengths.visible = startRow.visible = pomodoroIdle;
      for (const [field, key, button] of lengthButtons)
        button.label = lengthLabels[field](this._settings.get_int(key));

      // The idle Pomodoro view has no room for the big time next to its two rows.
      time.visible = !pomodoroIdle;
      time.text = idle ? "00:00" : this._text();
      phase.visible = !idle && cycle !== null;
      if (cycle) {
        phase.text =
          cycle.phase === "focus"
            ? _("Focus %d of %d").format(cycle.round, cycle.rounds)
            : this._phaseLabel(cycle.phase);
      }
      box.remove_style_class_name("focus");
      box.remove_style_class_name("break");
      if (cycle) box.add_style_class_name(cycle.phase === "focus" ? "focus" : "break");

      controls.visible = !idle;
      toggle.label = state === "running" ? _("Pause") : _("Resume");
      skip.visible = cycle !== null;
      extend.label = cycle ? _("+%d min").format(POMODORO_EXTEND_MIN) : _("+1 min");
      reset.label = cycle ? _("Stop") : _("Reset");
    };
    this._views.add(update);
    // eslint-disable-next-line local/no-untracked-connect -- actor-lifetime-bound: runs once, as the view dies
    box.connect("destroy", () => this._views.delete(update));
    update();
    return box;
  }
}

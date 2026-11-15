/*
 * This file is part of the Nexsland GNOME extension.
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Today: a checklist for the day kept by the user, in a panel tab. A task with a
 * time is announced by a HUD a few minutes early, and from its time on it stays
 * on the island as a live activity (priority 75, above a running timer) until it
 * is ticked or snoozed. The list lives in GSettings; nothing leaves the machine.
 */

import Clutter from "gi://Clutter";
import GLib from "gi://GLib";
import Pango from "gi://Pango";
import St from "gi://St";
import { gettext as _ } from "resource:///org/gnome/shell/extensions/extension.js";

import { CHIP_SIZE, HUD_SIZE, buildInfoHud, updateInfoHud } from "../providers/hud.js";
import { vbox } from "../shared/compat.js";
import { Logger } from "../shared/logger.js";
import { TodayList, formatMinutes, parseTime } from "./today-model.js";

const ACTIVITY_ID = "today";
const PRIORITY = 75;
const SOON_HUD_MS = 5000;
const SNOOZE_MIN = 10;
const ICON = "alarm-symbolic";
const TASKS_KEY = "today-tasks";
const LEAD_KEY = "today-remind-before";

/** The local day and the minutes (and seconds) into it. */
function clock() {
  const now = GLib.DateTime.new_now_local();
  return {
    day: now.format("%F"),
    minutes: now.get_hour() * 60 + now.get_minute(),
    seconds: now.get_second(),
  };
}

function button(params, onClick) {
  const actor = new St.Button({ can_focus: true, ...params });
  // eslint-disable-next-line local/no-untracked-connect -- actor-lifetime-bound: freed with the button
  actor.connect("clicked", () => {
    onClick();
    return Clutter.EVENT_STOP;
  });
  return actor;
}

export class TodayFeature {
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
    this._list = new TodayList(settings.get_string(TASKS_KEY));
    this._tickId = null;
    this._live = false;
    /** @type {Set<string>} due reminders whose sound already played */
    this._announced = new Set();
    /** @type {Set<() => void>} list fillers of the views currently built */
    this._views = new Set();
    this.tab = {
      id: "today",
      icon: "checkbox-checked-symbolic",
      title: _("Today"),
      build: () => this._build(),
    };
    this._tick();
  }

  destroy() {
    if (this._tickId !== null) this._scheduler.clearTimeout(this._tickId);
    this._tickId = null;
    if (this._live) this._engine.hideLive(ACTIVITY_ID);
    this._live = false;
    this._views.clear();
  }

  /** Once a minute, on the minute: roll the day over and raise what is due. */
  _tick() {
    const now = clock();
    let changed = this._list.rollover(now.day);
    for (const task of this._list.takeWarnings(now.minutes, this._settings.get_int(LEAD_KEY))) {
      changed = true;
      this._announceSoon(task, task.minutes - now.minutes);
    }
    if (changed) this._save();
    this._refresh(now);
    this._tickId = this._scheduler.setTimeout(
      () => {
        this._tickId = null;
        this._tick();
      },
      (60 - now.seconds) * 1000 + 50,
    );
  }

  _save() {
    this._settings.set_string(TASKS_KEY, this._list.serialize());
  }

  /** After the user changed the list. */
  _changed() {
    this._save();
    this._refresh(clock());
  }

  _refresh(now) {
    for (const fill of this._views) fill(now);
    const [task] = this._list.due(now.minutes);
    if (!task) {
      if (this._live) this._engine.hideLive(ACTIVITY_ID);
      this._live = false;
      return;
    }
    const hud = { text: task.title, detail: formatMinutes(task.minutes) };
    this._live = true;
    this._engine.showLive({
      id: ACTIVITY_ID,
      priority: PRIORITY,
      expandable: true,
      compact: {
        ...CHIP_SIZE,
        build: () => buildInfoHud({ icon: ICON, tone: "accent", ...hud }),
        update: (actor) => updateInfoHud(actor, hud),
      },
      expanded: { ...CHIP_SIZE, build: () => this._build() },
    });
    const key = `${task.id}:${task.snoozedTo ?? task.minutes}`;
    if (!this._announced.has(key)) {
      this._announced.add(key);
      this._playSound(task.title);
    }
  }

  _announceSoon(task, inMinutes) {
    this._engine.showTemporary(
      {
        id: "today-soon",
        compact: {
          ...HUD_SIZE,
          build: () =>
            buildInfoHud({
              icon: ICON,
              text: task.title,
              detail: _("in %d min").format(inMinutes),
              tone: "accent",
            }),
        },
      },
      SOON_HUD_MS,
    );
    this._playSound(task.title);
  }

  _playSound(description) {
    try {
      global.display.get_sound_player().play_from_theme("complete", description, null);
    } catch (e) {
      Logger.debug(`today: no sound: ${e}`);
    }
  }

  _build() {
    const root = vbox({
      style_class: "nexsland-today",
      x_expand: true,
      y_expand: true,
      y_align: Clutter.ActorAlign.START,
    });
    // The list takes its natural height and scrolls once the panel is full, so the
    // add row sits right under the last task and never scrolls away.
    const scroll = new St.ScrollView({
      x_expand: true,
      hscrollbar_policy: St.PolicyType.NEVER,
      vscrollbar_policy: St.PolicyType.AUTOMATIC,
    });
    const list = vbox({ style_class: "nexsland-today-list", x_expand: true });
    // GNOME 46 replaced add_actor() with set_child() on St.ScrollView.
    if (scroll.set_child) scroll.set_child(list);
    else scroll.add_actor(list);
    root.add_child(scroll);
    root.add_child(this._addRow());

    const fill = (now) => {
      this._fill(list, now);
      scroll.visible = list.get_n_children() > 0;
    };
    this._views.add(fill);
    // eslint-disable-next-line local/no-untracked-connect -- actor-lifetime-bound: runs once, as the view dies
    root.connect("destroy", () => this._views.delete(fill));
    fill(clock());
    return root;
  }

  /** "+", the new task's title and, on the right, its optional time. Enter adds it. */
  _addRow() {
    const row = new St.BoxLayout({ style_class: "nexsland-today-add", x_expand: true });
    row.add_child(
      new St.Label({
        text: "+",
        style_class: "nexsland-today-plus",
        y_align: Clutter.ActorAlign.CENTER,
      }),
    );
    const title = new St.Entry({
      style_class: "nexsland-today-entry",
      hint_text: _("Add task…"),
      can_focus: true,
      x_expand: true,
      y_align: Clutter.ActorAlign.CENTER,
    });
    const time = new St.Entry({
      style_class: "nexsland-today-entry nexsland-today-entry-time",
      // Translators: placeholder of the time field, hours and minutes
      hint_text: _("hh:mm"),
      can_focus: true,
      y_align: Clutter.ActorAlign.CENTER,
    });
    time.clutter_text.set_max_length(5);
    const submit = () => {
      const typed = time.get_text().trim();
      const minutes = typed ? parseTime(typed) : null;
      if (typed && minutes === null) {
        time.add_style_class_name("invalid");
        time.grab_key_focus();
        return;
      }
      if (!this._list.add(title.get_text(), clock().day, minutes)) {
        title.grab_key_focus();
        return;
      }
      title.set_text("");
      time.set_text("");
      title.grab_key_focus();
      this._changed();
    };
    for (const entry of [title, time]) {
      // eslint-disable-next-line local/no-untracked-connect -- actor-lifetime-bound: freed with the entry
      entry.clutter_text.connect("activate", submit);
      // eslint-disable-next-line local/no-untracked-connect -- actor-lifetime-bound: freed with the entry
      entry.clutter_text.connect("key-press-event", (_actor, event) => {
        if (event.get_key_symbol() !== Clutter.KEY_Escape) return Clutter.EVENT_PROPAGATE;
        global.stage.set_key_focus(null); // hand the keyboard back to the focused window
        return Clutter.EVENT_STOP;
      });
      row.add_child(entry);
    }
    // eslint-disable-next-line local/no-untracked-connect -- actor-lifetime-bound: freed with the entry
    time.clutter_text.connect("text-changed", () => time.remove_style_class_name("invalid"));
    return row;
  }

  _fill(list, now) {
    list.destroy_all_children();
    const tasks = this._list.tasks;
    const due = new Set(this._list.due(now.minutes).map((task) => task.id));
    for (const task of tasks) list.add_child(this._row(task, due.has(task.id)));
  }

  _row(task, due) {
    const classes = ["nexsland-today-task", task.done && "done", due && "due"];
    const row = new St.BoxLayout({
      style_class: classes.filter(Boolean).join(" "),
      x_expand: true,
    });
    const toggle = () => {
      this._list.toggle(task.id);
      this._changed();
    };
    row.add_child(
      new St.Label({
        text: task.minutes === null ? "" : formatMinutes(task.minutes),
        style_class: "nexsland-today-time",
        y_align: Clutter.ActorAlign.CENTER,
      }),
    );
    row.add_child(
      button(
        {
          style_class: "nexsland-today-check",
          accessible_name: task.done ? _("Mark as not done") : _("Mark as done"),
          child: new St.Icon({
            icon_name: task.done ? "checkbox-checked-symbolic" : "checkbox-symbolic",
            icon_size: 14,
          }),
        },
        toggle,
      ),
    );
    const title = new St.Label({
      text: task.title,
      style_class: "nexsland-today-title",
      x_expand: true,
      y_align: Clutter.ActorAlign.CENTER,
    });
    title.clutter_text.ellipsize = Pango.EllipsizeMode.END;
    row.add_child(title);
    if (due) {
      row.add_child(
        button(
          {
            style_class: "nexsland-pill-button",
            label: _("Snooze %dm").format(SNOOZE_MIN),
          },
          () => {
            this._list.snooze(task.id, clock().minutes, SNOOZE_MIN);
            this._changed();
          },
        ),
      );
      row.add_child(
        button({ style_class: "nexsland-pill-button primary", label: _("Done") }, toggle),
      );
    } else {
      row.add_child(
        button(
          {
            style_class: "nexsland-today-remove",
            accessible_name: _("Remove"),
            child: new St.Icon({ icon_name: "window-close-symbolic", icon_size: 12 }),
          },
          () => {
            this._list.remove(task.id);
            this._changed();
          },
        ),
      );
    }
    return row;
  }
}

/*
 * This file is part of the Nexsland GNOME extension.
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Today: a checklist kept by the user, in a panel tab: today's tasks, then the
 * ones planned for the coming days under their date. A task with a time is
 * announced by a HUD a few minutes early on its day, and from its time on it
 * stays on the island as a live activity (priority 75, above a running timer)
 * until it is ticked or snoozed. The list lives in GSettings; nothing leaves the
 * machine.
 */

import Clutter from "gi://Clutter";
import GLib from "gi://GLib";
import Pango from "gi://Pango";
import Shell from "gi://Shell";
import St from "gi://St";
import { gettext as _ } from "resource:///org/gnome/shell/extensions/extension.js";

import { CHIP_SIZE, HUD_SIZE, buildInfoHud, updateInfoHud } from "../providers/hud.js";
import { vbox } from "../shared/compat.js";
import { Logger } from "../shared/logger.js";
import { monthGrid, weekdayOrder } from "./calendar-model.js";
import {
  TodayList,
  addDays,
  dayString,
  formatMinutes,
  isPlannable,
  parseDay,
  parseTime,
} from "./today-model.js";

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

const toDateTime = (date) =>
  GLib.DateTime.new_local(date.getFullYear(), date.getMonth() + 1, date.getDate(), 12, 0, 0);

/** "Today", "Tomorrow", the weekday and date ("Wed 18"), or the date beyond a week ("2 Dec"). */
function dayLabel(day, today) {
  if (day === today) return _("Today");
  if (day === addDays(today, 1)) return _("Tomorrow");
  const date = toDateTime(parseDay(day));
  // Translators: see strftime; a day within the coming week, e.g. "Wed 18"
  if (day < addDays(today, 7)) return date.format(_("%a %-d"));
  // Translators: see strftime; a later day, e.g. "2 Dec", or "2 Dec 2027" in another year
  return date.format(day.slice(0, 4) === today.slice(0, 4) ? _("%-d %b") : _("%-d %b %Y"));
}

function weekStart() {
  try {
    return Shell.util_get_week_start();
  } catch {
    return 1; // older shells: Monday
  }
}

/** Abbreviated weekday name for 0 = Sunday ... 6 = Saturday, in the user's locale. */
function weekdayName(index) {
  // 2023-01-01 was a Sunday.
  return GLib.DateTime.new_local(2023, 1, 1 + index, 12, 0, 0).format("%a");
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
    const lead = this._settings.get_int(LEAD_KEY);
    for (const task of this._list.takeWarnings(now.day, now.minutes, lead)) {
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
    const [task] = this._list.due(now.day, now.minutes);
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
    // While a day is being picked, the month takes the list's place.
    const picker = vbox({ style_class: "nexsland-today-picker", x_expand: true, visible: false });
    root.add_child(scroll);
    root.add_child(picker);

    /** The new task's day; it stays for the next task so several can go to one day. */
    const view = { day: clock().day, month: null };
    const add = this._addRow(view, () => setPicking(!picker.visible));
    root.add_child(add.actor);

    const fill = (now) => {
      this._fill(list, now);
      scroll.visible = !picker.visible && list.get_n_children() > 0;
      if (picker.visible) this._fillPicker(picker, view, now, pick);
    };
    const setPicking = (on) => {
      view.month = on ? view.day.slice(0, 7) : null;
      picker.visible = on;
      add.setPicking(on);
      fill(clock());
      if (!on) add.focusTitle();
    };
    const pick = (day) => {
      view.day = day;
      add.showDay();
      setPicking(false);
    };
    this._views.add(fill);
    // eslint-disable-next-line local/no-untracked-connect -- actor-lifetime-bound: runs once, as the view dies
    root.connect("destroy", () => this._views.delete(fill));
    fill(clock());
    return root;
  }

  /**
   * "+", the new task's title, its day and its optional time. Enter adds it.
   * Clicking the day opens a month to pick another one; scrolling on it steps a
   * day at a time.
   * @param {{ day: string }} view the view's chosen day, shared with the picker
   * @param {() => void} togglePicker
   */
  _addRow(view, togglePicker) {
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

    const date = new St.Button({
      style_class: "nexsland-today-date",
      can_focus: true,
      toggle_mode: true,
      y_align: Clutter.ActorAlign.CENTER,
    });
    const showDay = () => {
      const today = clock().day;
      if (view.day < today) view.day = today; // the view stayed open past midnight
      date.label = dayLabel(view.day, today);
      if (view.day > today) date.add_style_class_name("ahead");
      else date.remove_style_class_name("ahead");
    };
    // eslint-disable-next-line local/no-untracked-connect -- actor-lifetime-bound: freed with the button
    date.connect("clicked", () => {
      togglePicker();
      return Clutter.EVENT_STOP;
    });
    // Stop the scroll here: on the island it would close the panel or switch tabs.
    // eslint-disable-next-line local/no-untracked-connect -- actor-lifetime-bound: freed with the button
    date.connect("scroll-event", (_actor, event) => {
      const by = { [Clutter.ScrollDirection.UP]: -1, [Clutter.ScrollDirection.DOWN]: 1 }[
        event.get_scroll_direction()
      ];
      const next = by ? addDays(view.day, by) : view.day;
      if (isPlannable(next, clock().day)) {
        view.day = next;
        showDay();
      }
      return Clutter.EVENT_STOP;
    });
    showDay();

    const submit = () => {
      const typed = time.get_text().trim();
      const minutes = typed ? parseTime(typed) : null;
      if (typed && minutes === null) {
        time.add_style_class_name("invalid");
        time.grab_key_focus();
        return;
      }
      showDay();
      if (!this._list.add(title.get_text(), view.day, minutes)) {
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
      if (entry === time) row.add_child(date);
      row.add_child(entry);
    }
    // eslint-disable-next-line local/no-untracked-connect -- actor-lifetime-bound: freed with the entry
    time.clutter_text.connect("text-changed", () => time.remove_style_class_name("invalid"));
    return {
      actor: row,
      showDay,
      setPicking: (on) => {
        date.checked = on;
      },
      focusTitle: () => title.grab_key_focus(),
    };
  }

  /**
   * ‹ Month › over the month's days. Days that cannot take a task (past ones,
   * or more than a year out) are dimmed and inert; days with tasks are tinted.
   * @param {{ day: string, month: string }} view month is "YYYY-MM"
   */
  _fillPicker(picker, view, now, pick) {
    picker.destroy_all_children();
    const shown = parseDay(`${view.month}-01`);
    const step = (by) => {
      const next = new Date(shown.getFullYear(), shown.getMonth() + by, 1, 12);
      view.month = dayString(next).slice(0, 7);
      this._fillPicker(picker, view, clock(), pick);
    };

    const nav = new St.BoxLayout({ style_class: "nexsland-calendar-nav" });
    const rtl = Clutter.get_default_text_direction() === Clutter.TextDirection.RTL;
    const arrow = (icon, name, by) => {
      // Only months that hold a day that can be picked.
      const month = dayString(new Date(shown.getFullYear(), shown.getMonth() + by, 1, 12));
      const reachable =
        by < 0 ? month.slice(0, 7) >= now.day.slice(0, 7) : isPlannable(month, now.day);
      return button(
        {
          style_class: "nexsland-calendar-nav-button",
          accessible_name: name,
          reactive: reachable,
          opacity: reachable ? 255 : 80,
          child: new St.Icon({ icon_name: icon, icon_size: 12 }),
        },
        () => step(by),
      );
    };
    nav.add_child(arrow(rtl ? "pan-end-symbolic" : "pan-start-symbolic", _("Previous month"), -1));
    nav.add_child(
      new St.Label({
        text: toDateTime(shown).format(
          shown.getFullYear() === parseDay(now.day).getFullYear() ? "%B" : "%B %Y",
        ),
        style_class: "nexsland-calendar-nav-title",
        x_expand: true,
        x_align: Clutter.ActorAlign.CENTER,
      }),
    );
    nav.add_child(arrow(rtl ? "pan-start-symbolic" : "pan-end-symbolic", _("Next month"), 1));
    picker.add_child(nav);

    const start = weekStart();
    const header = new St.BoxLayout({ style_class: "nexsland-calendar-week" });
    for (const d of weekdayOrder(start)) {
      header.add_child(
        new St.Label({ text: weekdayName(d), style_class: "nexsland-calendar-cell header" }),
      );
    }
    picker.add_child(header);

    const today = parseDay(now.day);
    const planned = new Set(this._list.days());
    const todayParts = { year: today.getFullYear(), month: today.getMonth(), day: today.getDate() };
    for (const week of monthGrid(shown.getFullYear(), shown.getMonth(), start, todayParts)) {
      const row = new St.BoxLayout({ style_class: "nexsland-calendar-week" });
      for (const cell of week) {
        const day = dayString(cell.date);
        const open = isPlannable(day, now.day);
        const classes = ["nexsland-calendar-cell", "day"];
        if (!cell.inMonth || !open) classes.push("outside");
        if (cell.isToday) classes.push("today");
        if (planned.has(day)) classes.push("has-events");
        if (day === view.day) classes.push("selected");
        row.add_child(
          button(
            {
              label: `${cell.day}`,
              style_class: classes.join(" "),
              reactive: open,
              can_focus: open,
            },
            () => pick(day),
          ),
        );
      }
      picker.add_child(row);
    }
  }

  /** Today's tasks, then each coming day's under its date. */
  _fill(list, now) {
    list.destroy_all_children();
    const due = new Set(this._list.due(now.day, now.minutes).map((task) => task.id));
    for (const day of this._list.days()) {
      if (day !== now.day) {
        list.add_child(
          new St.Label({ text: dayLabel(day, now.day), style_class: "nexsland-today-day" }),
        );
      }
      for (const task of this._list.forDay(day)) list.add_child(this._row(task, due.has(task.id)));
    }
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

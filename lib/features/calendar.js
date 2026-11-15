/*
 * This file is part of the Nexsland GNOME extension.
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Calendar tab: today's date, the next events and a month grid starting on the
 * locale's first weekday, with days that have events marked.
 *
 * Events come from the event source of the top bar's date menu (calendars set up
 * in Evolution / Online Accounts, through the shell's calendar server). Sharing it
 * avoids a second client: the calendar server keeps a single time range, so two
 * sources asking for different ranges would keep reloading each other. The tab
 * asks for exactly the range GNOME's own calendar asks for, which only reloads
 * when the month has moved on while the date menu stayed closed (replace-clock-menu).
 *
 * Clicking an event opens the calendar app, chosen as GNOME's event list does: the
 * default handler for text/calendar if it is among the recommended ones.
 */

import Clutter from "gi://Clutter";
import Gio from "gi://Gio";
import GLib from "gi://GLib";
import Pango from "gi://Pango";
import Shell from "gi://Shell";
import St from "gi://St";
import { gettext as _ } from "resource:///org/gnome/shell/extensions/extension.js";
import { formatTime } from "resource:///org/gnome/shell/misc/dateUtils.js";
import * as Main from "resource:///org/gnome/shell/ui/main.js";

import { agenda, monthGrid, shellCalendarRange, weekdayOrder } from "./calendar-model.js";
import { vbox } from "../shared/compat.js";
import { Logger } from "../shared/logger.js";
import { SignalTracker } from "../shared/signals.js";

const AGENDA_ROWS = 3;

/** Abbreviated weekday name for 0 = Sunday ... 6 = Saturday, in the user's locale. */
function weekdayName(index) {
  // 2023-01-01 was a Sunday.
  return GLib.DateTime.new_local(2023, 1, 1 + index, 12, 0, 0).format("%a");
}

function whenText(row) {
  if (row.ongoing) return _("Now");
  const time = row.allDay ? _("All day") : formatTime(row.start, { timeOnly: true });
  if (row.day === 0) return time;
  const day =
    row.day === 1
      ? _("Tomorrow")
      : GLib.DateTime.new_from_unix_local(Math.floor(row.start.getTime() / 1000)).format("%a");
  return row.allDay ? day : `${day} ${time}`;
}

/** The app GNOME's own event list opens, or null when none handles text/calendar. */
function calendarApp() {
  const apps = Gio.AppInfo.get_recommended_for_type("text/calendar") ?? [];
  if (apps.length === 0) return null;
  const preferred = Gio.AppInfo.get_default_for_type("text/calendar", false);
  return apps.find((app) => preferred && app.equal(preferred)) ?? apps[0];
}

export class CalendarFeature {
  /** @param {{ engine: any }} params */
  constructor({ engine }) {
    this._engine = engine;
    this._root = null;
    this._source = null;
    this._sourceSignals = new SignalTracker();
    this.tab = {
      id: "calendar",
      icon: "x-office-calendar-symbolic",
      title: _("Calendar"),
      build: () => this._build(),
      hidden: () => {
        this._root = null;
      },
    };
  }

  destroy() {
    this._sourceSignals.disconnectAll();
    this._source = null;
    this._root = null;
  }

  /**
   * The date menu's current event source. It is replaced when the session mode
   * changes (lock screen), so look it up each time and follow the new one.
   */
  _eventSource() {
    const source = Main.panel.statusArea.dateMenu?._eventSource ?? null;
    if (source !== this._source) {
      this._sourceSignals.disconnectAll();
      this._source = source;
      if (source) {
        this._sourceSignals.track(source, "changed", () => this._rebuild());
        this._sourceSignals.track(source, "notify::has-calendars", () => this._rebuild());
      }
    }
    return source;
  }

  _rebuild() {
    const root = this._root;
    // requestRange() can emit "changed" synchronously while _fill() runs.
    if (!root || this._filling) return;
    root.destroy_all_children();
    this._fill(root);
  }

  _build() {
    this._root = new St.BoxLayout({ style_class: "nexsland-calendar", x_expand: true });
    this._fill(this._root);
    return this._root;
  }

  _fill(root) {
    const now = GLib.DateTime.new_now_local();
    const today = { year: now.get_year(), month: now.get_month() - 1, day: now.get_day_of_month() };
    let weekStart = 1;
    try {
      weekStart = Shell.util_get_week_start();
    } catch {
      // Older shells: keep Monday.
    }

    const source = this._eventSource();
    const events = source?.hasCalendars ? source : null;
    this._filling = true;
    try {
      if (events) {
        const { begin, end } = shellCalendarRange(today.year, today.month, weekStart);
        events.requestRange(begin, end);
      }
      root.add_child(events ? this._agenda(now, events) : this._summary(now, today));
      root.add_child(this._grid(today, weekStart, events));
    } finally {
      this._filling = false;
    }
  }

  /** Without calendars: the date, large. */
  _summary(now, today) {
    const summary = vbox({
      style_class: "nexsland-calendar-summary",
      y_align: Clutter.ActorAlign.CENTER,
    });
    summary.add_child(
      new St.Label({ text: now.format("%A"), style_class: "nexsland-calendar-weekday" }),
    );
    summary.add_child(new St.Label({ text: `${today.day}`, style_class: "nexsland-calendar-day" }));
    summary.add_child(
      new St.Label({ text: now.format("%B %Y"), style_class: "nexsland-calendar-month" }),
    );
    return summary;
  }

  /** With calendars: the date, then the next few events. */
  _agenda(now, source) {
    const box = vbox({ style_class: "nexsland-calendar-agenda" });
    box.add_child(
      new St.Label({ text: now.format("%A"), style_class: "nexsland-calendar-weekday" }),
    );
    box.add_child(
      new St.Label({ text: now.format("%B %-d"), style_class: "nexsland-calendar-date" }),
    );

    const nowDate = new Date();
    const rangeEnd = new Date(nowDate.getFullYear(), nowDate.getMonth() + 1, 7);
    const rows = agenda(source.getEvents(nowDate, rangeEnd), nowDate, AGENDA_ROWS);
    if (rows.length === 0) {
      box.add_child(
        new St.Label({
          text: source.isLoading ? "" : _("No upcoming events"),
          style_class: "nexsland-calendar-empty",
        }),
      );
    }
    const app = rows.length > 0 ? calendarApp() : null;
    for (const row of rows) {
      const line = new St.BoxLayout({ style_class: "nexsland-calendar-event", x_expand: true });
      line.add_child(
        new St.Label({
          text: whenText(row),
          style_class: `nexsland-calendar-event-time${row.ongoing ? " ongoing" : ""}`,
          y_align: Clutter.ActorAlign.CENTER,
        }),
      );
      const title = new St.Label({
        text: row.summary || _("Untitled event"),
        style_class: "nexsland-calendar-event-title",
        x_expand: true,
        y_align: Clutter.ActorAlign.CENTER,
      });
      title.clutter_text.ellipsize = Pango.EllipsizeMode.END;
      line.add_child(title);
      const button = new St.Button({
        style_class: "nexsland-calendar-event-button",
        child: line,
        x_expand: true,
        reactive: app !== null,
        can_focus: app !== null,
      });
      // eslint-disable-next-line local/no-untracked-connect -- actor-lifetime-bound: freed with the button
      button.connect("clicked", () => {
        this._openCalendar(app);
        return Clutter.EVENT_STOP;
      });
      box.add_child(button);
    }
    return box;
  }

  _openCalendar(app) {
    this._engine.collapse();
    Main.overview.hide();
    const context = global.create_app_launch_context(0, -1);
    try {
      // Evolution opens its mail view unless asked for the calendar.
      if (app.get_id() === "org.gnome.Evolution.desktop") app.launch_action("calendar", context);
      else app.launch([], context);
    } catch (e) {
      Logger.error(`calendar: could not open ${app.get_id()}: ${e}`);
    }
  }

  _grid(today, weekStart, source) {
    const grid = vbox({
      style_class: "nexsland-calendar-grid",
      x_expand: true,
      y_align: Clutter.ActorAlign.CENTER,
    });
    const header = new St.BoxLayout({ style_class: "nexsland-calendar-week" });
    for (const d of weekdayOrder(weekStart)) {
      header.add_child(
        new St.Label({ text: weekdayName(d), style_class: "nexsland-calendar-cell header" }),
      );
    }
    grid.add_child(header);
    for (const week of monthGrid(today.year, today.month, weekStart, today)) {
      const row = new St.BoxLayout({ style_class: "nexsland-calendar-week" });
      for (const cell of week) {
        const classes = ["nexsland-calendar-cell"];
        if (!cell.inMonth) classes.push("outside");
        if (cell.isToday) classes.push("today");
        if (source?.hasEvents(cell.date)) classes.push("has-events");
        row.add_child(new St.Label({ text: `${cell.day}`, style_class: classes.join(" ") }));
      }
      grid.add_child(row);
    }
    return grid;
  }
}

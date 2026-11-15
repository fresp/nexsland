/*
 * This file is part of the Nexsland GNOME extension.
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Calendar tab: today's date, the next events and a month grid starting on the
 * locale's first weekday, with days that have events marked. Clicking a day lists
 * that day's events instead; clicking it again goes back to the upcoming ones.
 *
 * Events come from the event source of the top bar's date menu (calendars set up
 * in Evolution / Online Accounts, through the shell's calendar server). Sharing it
 * avoids a second client: the calendar server keeps a single time range.
 *
 * The range belongs to the date menu's calendar widget, which asks for its shown
 * month again on every change of the source; asking for any other range here would
 * make the two reload each other forever. So the tab never requests a range: it
 * moves that calendar to the month it shows (today's date for the current month,
 * which also catches up after the month rolled over while the date menu stayed
 * closed), and moves it back to today when the tab is left.
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
import { gettext as _, ngettext } from "resource:///org/gnome/shell/extensions/extension.js";
import { formatTime } from "resource:///org/gnome/shell/misc/dateUtils.js";
import * as Main from "resource:///org/gnome/shell/ui/main.js";

import {
  addMonths,
  agenda,
  dayAgenda,
  monthGrid,
  monthsBetween,
  weekdayOrder,
} from "./calendar-model.js";
import { vbox } from "../shared/compat.js";
import { Logger } from "../shared/logger.js";
import { SignalTracker } from "../shared/signals.js";

const AGENDA_ROWS = 3;

/** Abbreviated weekday name for 0 = Sunday ... 6 = Saturday, in the user's locale. */
function weekdayName(index) {
  // 2023-01-01 was a Sunday.
  return GLib.DateTime.new_local(2023, 1, 1 + index, 12, 0, 0).format("%a");
}

/** `relative`: around today ("Now", "Tomorrow", weekday); otherwise weekday and date. */
function whenText(row, relative) {
  if (row.ongoing) return _("Now");
  const time = row.allDay ? _("All day") : formatTime(row.start, { timeOnly: true });
  if (relative && row.day === 0) return time;
  const start = GLib.DateTime.new_from_unix_local(Math.floor(row.start.getTime() / 1000));
  let day;
  if (!relative) day = start.format("%a %-d");
  else if (row.day === 1) day = _("Tomorrow");
  else day = start.format("%a");
  return row.allDay ? day : `${day} ${time}`;
}

/** The app GNOME's own event list opens, or null when none handles text/calendar. */
function calendarApp() {
  const apps = Gio.AppInfo.get_recommended_for_type("text/calendar") ?? [];
  if (apps.length === 0) return null;
  const preferred = Gio.AppInfo.get_default_for_type("text/calendar", false);
  return apps.find((app) => preferred && app.equal(preferred)) ?? apps[0];
}

function sameDay(a, b) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function weekStart() {
  try {
    return Shell.util_get_week_start();
  } catch {
    return 1; // older shells: Monday
  }
}

export class CalendarFeature {
  /** @param {{ engine: any }} params */
  constructor({ engine }) {
    this._engine = engine;
    this._root = null;
    this._monthOffset = 0; // months from the current one shown in the grid
    /** @type {Date | null} the clicked day whose events are listed */
    this._selected = null;
    this._source = null;
    this._sourceSignals = new SignalTracker();
    this.tab = {
      id: "calendar",
      icon: "x-office-calendar-symbolic",
      title: _("Calendar"),
      build: () => this._build(),
      hidden: () => {
        this._root = null;
        this._selected = null;
        this._resetMonth();
      },
    };
  }

  destroy() {
    this._resetMonth();
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
    // Steering the calendar can emit "changed" synchronously while _fill() runs.
    if (!root || this._filling) return;
    root.destroy_all_children();
    this._fill(root);
  }

  _showMonth(offset) {
    this._monthOffset = offset;
    this._selected = null;
    this._rebuild();
  }

  /** List `date`'s events, moving to its month first when it is a padding day. */
  _selectDay(date, offset) {
    const same = this._selected && sameDay(this._selected, date);
    this._monthOffset = offset;
    this._selected = same ? null : date;
    this._rebuild();
  }

  /** Back to the current month, and the date menu's calendar back to today. */
  _resetMonth() {
    if (this._monthOffset === 0) return;
    this._monthOffset = 0;
    this._steer(new Date());
  }

  /** Move the date menu's calendar (the owner of the event range) to `date`. */
  _steer(date) {
    try {
      Main.panel.statusArea.dateMenu?._calendar?.setDate?.(date);
    } catch (e) {
      Logger.error(`calendar: could not move the date menu calendar: ${e}`);
    }
  }

  _build() {
    this._root = new St.BoxLayout({ style_class: "nexsland-calendar", x_expand: true });
    this._fill(this._root);
    return this._root;
  }

  _fill(root) {
    const now = GLib.DateTime.new_now_local();
    const today = { year: now.get_year(), month: now.get_month() - 1, day: now.get_day_of_month() };
    const shown = addMonths(today.year, today.month, this._monthOffset);
    const start = weekStart();

    const source = this._eventSource();
    const events = source?.hasCalendars ? source : null;
    this._filling = true;
    try {
      if (events)
        this._steer(this._monthOffset === 0 ? new Date() : new Date(shown.year, shown.month, 1));
      let left;
      if (!events) left = this._summary(now, today);
      else if (this._selected) left = this._dayList(this._selected, events);
      else left = this._agenda(now, shown, events);
      root.add_child(left);
      root.add_child(this._grid(today, shown, start, events));
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

  /**
   * With calendars: today and the next few events, or, while another month is
   * shown, that month and its first events.
   */
  _agenda(now, shown, source) {
    const current = this._monthOffset === 0;
    const monthStart = GLib.DateTime.new_local(shown.year, shown.month + 1, 1, 0, 0, 0);
    const box = vbox({ style_class: "nexsland-calendar-agenda" });
    box.add_child(
      new St.Label({
        text: current ? now.format("%A") : monthStart.format("%Y"),
        style_class: "nexsland-calendar-weekday",
      }),
    );
    box.add_child(
      new St.Label({
        text: current ? now.format("%B %-d") : monthStart.format("%B"),
        style_class: "nexsland-calendar-date",
      }),
    );

    const from = current ? new Date() : new Date(shown.year, shown.month, 1);
    // Today's list may run into next month; another month's list stays in it.
    const until = new Date(shown.year, shown.month + 1, current ? 7 : 1);
    const rows = agenda(source.getEvents(from, until), from, AGENDA_ROWS);
    if (rows.length === 0) {
      const empty = current ? _("No upcoming events") : _("No events this month");
      box.add_child(
        new St.Label({
          text: source.isLoading ? "" : empty,
          style_class: "nexsland-calendar-empty",
        }),
      );
    }
    const app = rows.length > 0 ? calendarApp() : null;
    for (const row of rows)
      box.add_child(this._eventRow(whenText(row, current), row.summary, app, row.ongoing));
    return box;
  }

  /** The clicked day and its events. */
  _dayList(day, source) {
    const date = GLib.DateTime.new_local(
      day.getFullYear(),
      day.getMonth() + 1,
      day.getDate(),
      0,
      0,
      0,
    );
    const box = vbox({ style_class: "nexsland-calendar-agenda" });
    box.add_child(
      new St.Label({ text: date.format("%A"), style_class: "nexsland-calendar-weekday" }),
    );
    box.add_child(
      new St.Label({ text: date.format("%B %-d"), style_class: "nexsland-calendar-date" }),
    );
    const dayEnd = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1);
    const { rows, more } = dayAgenda(source.getEvents(day, dayEnd), day, AGENDA_ROWS);
    if (rows.length === 0) {
      box.add_child(
        new St.Label({
          text: source.isLoading ? "" : _("No events"),
          style_class: "nexsland-calendar-empty",
        }),
      );
    }
    const app = rows.length > 0 ? calendarApp() : null;
    for (const row of rows) {
      let when;
      if (row.allDay || (row.continues && row.carriesOn)) when = _("All day");
      else if (row.continues) when = _("Until %s").format(formatTime(row.end, { timeOnly: true }));
      else when = formatTime(row.start, { timeOnly: true });
      box.add_child(this._eventRow(when, row.summary, app, false));
    }
    if (more > 0) {
      box.add_child(
        new St.Label({
          text: ngettext("%d more", "%d more", more).format(more),
          style_class: "nexsland-calendar-empty",
        }),
      );
    }
    return box;
  }

  /** One event line; it opens the calendar app when there is one. */
  _eventRow(when, summary, app, ongoing) {
    const line = new St.BoxLayout({ style_class: "nexsland-calendar-event", x_expand: true });
    line.add_child(
      new St.Label({
        text: when,
        style_class: `nexsland-calendar-event-time${ongoing ? " ongoing" : ""}`,
        y_align: Clutter.ActorAlign.CENTER,
      }),
    );
    const title = new St.Label({
      text: summary || _("Untitled event"),
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
    return button;
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

  _grid(today, shown, start, source) {
    const grid = vbox({
      style_class: "nexsland-calendar-grid",
      x_expand: true,
      y_align: Clutter.ActorAlign.CENTER,
    });
    grid.add_child(this._monthNav(shown));
    const header = new St.BoxLayout({ style_class: "nexsland-calendar-week" });
    for (const d of weekdayOrder(start)) {
      header.add_child(
        new St.Label({ text: weekdayName(d), style_class: "nexsland-calendar-cell header" }),
      );
    }
    grid.add_child(header);
    for (const week of monthGrid(shown.year, shown.month, start, today)) {
      const row = new St.BoxLayout({ style_class: "nexsland-calendar-week" });
      for (const cell of week) {
        const classes = ["nexsland-calendar-cell"];
        if (!cell.inMonth) classes.push("outside");
        if (cell.isToday) classes.push("today");
        if (source?.hasEvents(cell.date)) classes.push("has-events");
        if (this._selected && sameDay(this._selected, cell.date)) classes.push("selected");
        if (!source) {
          row.add_child(new St.Label({ text: `${cell.day}`, style_class: classes.join(" ") }));
          continue;
        }
        const button = new St.Button({
          label: `${cell.day}`,
          style_class: `${classes.join(" ")} day`,
          can_focus: true,
        });
        // eslint-disable-next-line local/no-untracked-connect -- actor-lifetime-bound: freed with the button
        button.connect("clicked", () => {
          this._selectDay(cell.date, monthsBetween(today, cell.date));
          return Clutter.EVENT_STOP;
        });
        row.add_child(button);
      }
      grid.add_child(row);
    }
    return grid;
  }

  /** ‹ Month Year › ; the title goes back to the current month. */
  _monthNav(shown) {
    const nav = new St.BoxLayout({ style_class: "nexsland-calendar-nav" });
    const arrow = (icon, name, delta) => {
      const button = new St.Button({
        style_class: "nexsland-calendar-nav-button",
        can_focus: true,
        accessible_name: name,
        child: new St.Icon({ icon_name: icon, icon_size: 12 }),
      });
      // eslint-disable-next-line local/no-untracked-connect -- actor-lifetime-bound: freed with the button
      button.connect("clicked", () => {
        this._showMonth(this._monthOffset + delta);
        return Clutter.EVENT_STOP;
      });
      return button;
    };
    const rtl = Clutter.get_default_text_direction() === Clutter.TextDirection.RTL;
    nav.add_child(arrow(rtl ? "pan-end-symbolic" : "pan-start-symbolic", _("Previous month"), -1));
    const date = GLib.DateTime.new_local(shown.year, shown.month + 1, 1, 0, 0, 0);
    const title = new St.Button({
      style_class: "nexsland-calendar-nav-title",
      label: date.format(shown.year === new Date().getFullYear() ? "%B" : "%B %Y"),
      x_expand: true,
      can_focus: true,
      reactive: this._monthOffset !== 0,
      accessible_name: _("Current month"),
    });
    // eslint-disable-next-line local/no-untracked-connect -- actor-lifetime-bound: freed with the button
    title.connect("clicked", () => {
      this._showMonth(0);
      return Clutter.EVENT_STOP;
    });
    nav.add_child(title);
    nav.add_child(arrow(rtl ? "pan-start-symbolic" : "pan-end-symbolic", _("Next month"), 1));
    return nav;
  }
}

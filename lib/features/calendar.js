/*
 * This file is part of the Nexsland GNOME extension.
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Calendar tab: today's date and a month grid starting on the locale's first
 * weekday. Events are not shown yet: reading them means driving the shell's
 * own calendar server, which the top bar's calendar also uses.
 */

import Clutter from "gi://Clutter";
import GLib from "gi://GLib";
import Shell from "gi://Shell";
import St from "gi://St";
import { gettext as _ } from "resource:///org/gnome/shell/extensions/extension.js";

import { monthGrid, weekdayOrder } from "./calendar-model.js";
import { vbox } from "../shared/compat.js";

/** Abbreviated weekday name for 0 = Sunday ... 6 = Saturday, in the user's locale. */
function weekdayName(index) {
  // 2023-01-01 was a Sunday.
  return GLib.DateTime.new_local(2023, 1, 1 + index, 12, 0, 0).format("%a");
}

export class CalendarFeature {
  constructor() {
    this.tab = {
      id: "calendar",
      icon: "x-office-calendar-symbolic",
      title: _("Calendar"),
      build: () => this._build(),
    };
  }

  destroy() {}

  _build() {
    const now = GLib.DateTime.new_now_local();
    const today = { year: now.get_year(), month: now.get_month() - 1, day: now.get_day_of_month() };
    let weekStart = 1;
    try {
      weekStart = Shell.util_get_week_start();
    } catch {
      // Older shells: keep Monday.
    }

    const root = new St.BoxLayout({ style_class: "nexsland-calendar", x_expand: true });

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
    root.add_child(summary);

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
        row.add_child(new St.Label({ text: `${cell.day}`, style_class: classes.join(" ") }));
      }
      grid.add_child(row);
    }
    root.add_child(grid);
    return root;
  }
}

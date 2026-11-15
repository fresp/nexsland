/*
 * This file is part of the Nexsland GNOME extension.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * Weeks of a month for a grid, padded with neighbouring days.
 * @param {number} year
 * @param {number} month 0-11
 * @param {number} weekStart 0 = Sunday, 1 = Monday, ...
 * @param {{ year: number, month: number, day: number }} today
 * @returns {{ day: number, date: Date, inMonth: boolean, isToday: boolean }[][]}
 */
export function monthGrid(year, month, weekStart, today) {
  const first = new Date(year, month, 1);
  const offset = (first.getDay() - weekStart + 7) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const weeks = Math.ceil((offset + daysInMonth) / 7);
  const grid = [];
  for (let w = 0; w < weeks; w++) {
    const row = [];
    for (let d = 0; d < 7; d++) {
      const date = new Date(year, month, 1 - offset + w * 7 + d);
      row.push({
        day: date.getDate(),
        date,
        inMonth: date.getMonth() === month,
        isToday:
          date.getFullYear() === today.year &&
          date.getMonth() === today.month &&
          date.getDate() === today.day,
      });
    }
    grid.push(row);
  }
  return grid;
}

/** Column order of weekday indexes (0 = Sunday) starting at weekStart. */
export function weekdayOrder(weekStart) {
  return Array.from({ length: 7 }, (_, i) => (weekStart + i) % 7);
}

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/** Whole days from `now`'s day to `date`'s day (0 today, 1 tomorrow, -1 yesterday). */
export function dayOffset(date, now) {
  return Math.round((startOfDay(date).getTime() - startOfDay(now).getTime()) / DAY_MS);
}

/** An event that starts and ends at midnight, at least a day apart. */
export function isAllDay({ date, end }) {
  const midnight = (d) => d.getHours() === 0 && d.getMinutes() === 0 && d.getSeconds() === 0;
  return midnight(date) && midnight(end) && end.getTime() - date.getTime() >= DAY_MS - 3600 * 1000;
}

/**
 * The next `limit` events that have not ended yet, ongoing ones first, as rows:
 * { summary, start, allDay, ongoing, day } where day is the start's dayOffset
 * (0 for events already running).
 * @param {{ summary: string, date: Date, end: Date }[]} events
 */
export function agenda(events, now, limit = 3) {
  return events
    .filter((e) => e.end > now)
    .sort((a, b) => a.date - b.date || a.end - b.end)
    .slice(0, limit)
    .map((e) => {
      const ongoing = e.date <= now;
      return {
        summary: e.summary,
        start: e.date,
        allDay: isAllDay(e),
        ongoing,
        day: ongoing ? 0 : dayOffset(e.date, now),
      };
    });
}

/** The month `delta` months from `month` (0-11) of `year`. */
export function addMonths(year, month, delta) {
  const total = year * 12 + month + delta;
  return { year: Math.floor(total / 12), month: ((total % 12) + 12) % 12 };
}

/**
 * The events of one day, by start time, as rows: { summary, start, end, allDay,
 * continues (started on an earlier day), carriesOn (ends on a later day) }; `more`
 * counts those past `limit`.
 * @param {{ summary: string, date: Date, end: Date }[]} events
 * @param {Date} day any time on that day
 */
export function dayAgenda(events, day, limit = 3) {
  const dayStart = startOfDay(day);
  const dayEnd = new Date(dayStart.getFullYear(), dayStart.getMonth(), dayStart.getDate() + 1);
  const on = events
    .filter((e) => e.date < dayEnd && e.end > dayStart)
    .sort((a, b) => a.date - b.date || a.end - b.end);
  return {
    rows: on.slice(0, limit).map((e) => ({
      summary: e.summary,
      start: e.date,
      end: e.end,
      allDay: isAllDay(e),
      continues: e.date < dayStart,
      carriesOn: e.end > dayEnd,
    })),
    more: Math.max(0, on.length - limit),
  };
}

/** Months from `from` ({ year, month }) to the month of `date`. */
export function monthsBetween(from, date) {
  return date.getFullYear() * 12 + date.getMonth() - (from.year * 12 + from.month);
}

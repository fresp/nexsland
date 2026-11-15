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
 * @returns {{ day: number, inMonth: boolean, isToday: boolean }[][]}
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

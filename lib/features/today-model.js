/*
 * This file is part of the Nexsland GNOME extension.
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Today's checklist, GI-free. The caller supplies the local day ("YYYY-MM-DD")
 * and the minutes since local midnight, so tests control time.
 *
 * A task belongs to a day: today, or one of the next MAX_DAYS_AHEAD. It may carry
 * a time of day. On its day it is announced `lead` minutes before that time
 * (once), and is due from that time until it is ticked or snoozed. When the day
 * changes, the past days' ticked tasks are dropped and the rest are carried over
 * to today without a time: yesterday's 14:30 is not today's. Days to come are
 * left alone.
 */

export const MAX_TASKS = 100;
export const MAX_TITLE_LENGTH = 200;
/** How far ahead a task can be planned, in days. */
export const MAX_DAYS_AHEAD = 30;
const MINUTES_PER_DAY = 24 * 60;

/**
 * @typedef {{ id: number, title: string, minutes: number | null, done: boolean, day: string,
 *   warned: boolean, snoozedTo: number | null }} Task
 *   minutes: time of day, null for none; warned: the early reminder was shown;
 *   snoozedTo: the minute a snoozed task is due again
 */

const isMinutes = (v) => Number.isInteger(v) && v >= 0 && v < MINUTES_PER_DAY;

/** 870 -> "14:30" */
export function formatMinutes(minutes) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}

/**
 * "16:00" or "9.30" as minutes into the day.
 * @returns {number | null} null when the text is not a time of day
 */
export function parseTime(text) {
  const match = /^(\d{1,2})[:.](\d{2})$/.exec(String(text ?? "").trim());
  if (!match || Number(match[2]) > 59) return null;
  const value = Number(match[1]) * 60 + Number(match[2]);
  return isMinutes(value) ? value : null;
}

/**
 * What the user typed, split into a title and an optional time written as the
 * first or the last word: "Review PR 16:00", "9.30 standup".
 * @returns {{ title: string, minutes: number | null } | null} null without a title
 */
export function parseEntry(text) {
  const words = String(text ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  let minutes = null;
  for (const index of [words.length - 1, 0]) {
    const value = parseTime(words[index]);
    if (value === null) continue;
    minutes = value;
    words.splice(index, 1);
    break;
  }
  const title = words.join(" ").slice(0, MAX_TITLE_LENGTH);
  return title ? { title, minutes } : null;
}

export class TodayList {
  /** @type {Task[]} */
  #tasks = [];

  /** @param {string} [json] what serialize() returned; anything malformed is dropped */
  constructor(json = "[]") {
    let rows;
    try {
      rows = JSON.parse(json);
    } catch {
      rows = [];
    }
    if (!Array.isArray(rows)) return;
    for (const row of rows.slice(0, MAX_TASKS)) {
      if (typeof row?.title !== "string" || !row.title || typeof row.day !== "string") continue;
      this.#tasks.push({
        id: this.#nextId(),
        title: row.title.slice(0, MAX_TITLE_LENGTH),
        minutes: isMinutes(row.minutes) ? row.minutes : null,
        done: row.done === true,
        day: row.day,
        warned: row.warned === true,
        snoozedTo: Number.isInteger(row.snoozedTo) ? row.snoozedTo : null,
      });
    }
  }

  #nextId() {
    return this.#tasks.reduce((max, task) => Math.max(max, task.id), 0) + 1;
  }

  #find(id) {
    return this.#tasks.find((task) => task.id === id) ?? null;
  }

  serialize() {
    return JSON.stringify(this.#tasks.map(({ id: _id, ...rest }) => rest));
  }

  /** Every task, by day, then within a day as forDay() orders them. */
  get tasks() {
    return this.days().flatMap((day) => this.forDay(day));
  }

  /** The days that have tasks, earliest first. */
  days() {
    return [...new Set(this.#tasks.map((t) => t.day))].sort();
  }

  /** A day's timed tasks by time, then its untimed ones in the order they were added. */
  forDay(day) {
    const tasks = this.#tasks.filter((t) => t.day === day);
    const timed = tasks.filter((t) => t.minutes !== null);
    timed.sort((a, b) => a.minutes - b.minutes || a.id - b.id);
    return [...timed, ...tasks.filter((t) => t.minutes === null)];
  }

  /**
   * @param {string} text the title, which may carry a time (see parseEntry)
   * @param {string} day
   * @param {number | null} [minutes] a time entered separately; it wins over one in the text
   * @returns {Task | null} null when the text has no title or the list is full
   */
  add(text, day, minutes = null) {
    const entry = parseEntry(text);
    if (!entry || this.#tasks.length >= MAX_TASKS) return null;
    if (minutes !== null) entry.minutes = minutes;
    const task = { id: this.#nextId(), ...entry, done: false, day, warned: false, snoozedTo: null };
    this.#tasks.push(task);
    return task;
  }

  toggle(id) {
    const task = this.#find(id);
    if (task) task.done = !task.done;
  }

  remove(id) {
    this.#tasks = this.#tasks.filter((task) => task.id !== id);
  }

  /** Make a due task quiet until `byMinutes` from now. */
  snooze(id, nowMinutes, byMinutes) {
    const task = this.#find(id);
    if (task) task.snoozedTo = nowMinutes + byMinutes;
  }

  /** Bring the past days' tasks to `day`. @returns {boolean} whether anything changed */
  rollover(day) {
    const past = (task) => task.day < day;
    if (!this.#tasks.some(past)) return false;
    this.#tasks = this.#tasks.filter((task) => !past(task) || !task.done);
    for (const task of this.#tasks.filter(past))
      Object.assign(task, { day, minutes: null, warned: false, snoozedTo: null });
    return true;
  }

  /** `day`'s unticked tasks whose time (or snooze) has passed, earliest first. */
  due(day, nowMinutes) {
    return this.forDay(day).filter(
      (t) => !t.done && t.minutes !== null && nowMinutes >= (t.snoozedTo ?? t.minutes),
    );
  }

  /**
   * `day`'s tasks that start within `lead` minutes and were not announced yet;
   * they are marked announced. A lead of 0 turns early reminders off.
   */
  takeWarnings(day, nowMinutes, lead) {
    const soon = this.#tasks.filter(
      (t) =>
        t.day === day &&
        !t.done &&
        !t.warned &&
        t.minutes !== null &&
        nowMinutes < t.minutes &&
        nowMinutes >= t.minutes - lead,
    );
    for (const task of soon) task.warned = true;
    return soon;
  }
}

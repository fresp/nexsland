/*
 * This file is part of the Nexsland GNOME extension.
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Pomodoro rounds, GI-free: which phase comes next and how long it lasts. The
 * countdown itself is the timer's (timer-model.js).
 *
 *   focus 1, break, focus 2, break, ... focus N, long break, done
 */

/** Values the panel's pills step through, in minutes (rounds: a count). */
export const POMODORO_OPTIONS = Object.freeze({
  focus: Object.freeze([15, 20, 25, 30, 45, 50]),
  break: Object.freeze([3, 5, 10]),
  long: Object.freeze([10, 15, 20, 30]),
  rounds: Object.freeze([2, 3, 4, 5, 6]),
});

/** The option after `current`, wrapping; a value outside the list steps to the next larger one. */
export function nextOption(options, current) {
  return options.find((value) => value > current) ?? options[0];
}

/** @typedef {"focus" | "break" | "long"} PomodoroPhase */

export class PomodoroCycle {
  /** @type {PomodoroPhase} */
  phase = "focus";
  round = 1;

  /** @param {{ focusMin: number, breakMin: number, longMin: number, rounds: number }} config */
  constructor({ focusMin, breakMin, longMin, rounds }) {
    for (const [name, value] of Object.entries({ focusMin, breakMin, longMin, rounds })) {
      if (!(value >= 1)) throw new Error(`PomodoroCycle: ${name} must be >= 1`);
    }
    this.rounds = Math.floor(rounds);
    this._minutes = { focus: focusMin, break: breakMin, long: longMin };
  }

  /** Minutes of the current phase. */
  get minutes() {
    return this._minutes[this.phase];
  }

  /** Focus rounds finished so far. */
  get roundsDone() {
    return this.phase === "focus" ? this.round - 1 : this.round;
  }

  /** Move to the next phase. @returns {boolean} false when the long break was the last one */
  advance() {
    if (this.phase === "long") return false;
    if (this.phase === "focus") {
      this.phase = this.round < this.rounds ? "break" : "long";
    } else {
      this.phase = "focus";
      this.round += 1;
    }
    return true;
  }
}

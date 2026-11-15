/*
 * This file is part of the Nexsland GNOME extension.
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Countdown timer state, GI-free. Times are caller-supplied milliseconds from a
 * monotonic clock, so tests control time.
 */

export const TIMER_PRESETS_MIN = Object.freeze([1, 5, 10, 25]);

export class CountdownTimer {
  #endsAt = null;
  #pausedRemaining = null;
  durationMs = 0;

  /** @returns {"idle" | "running" | "paused"} */
  get state() {
    if (this.#endsAt !== null) return "running";
    if (this.#pausedRemaining !== null) return "paused";
    return "idle";
  }

  start(durationMs, now) {
    if (!(durationMs > 0)) throw new Error("CountdownTimer.start: durationMs must be > 0");
    this.durationMs = durationMs;
    this.#endsAt = now + durationMs;
    this.#pausedRemaining = null;
  }

  pause(now) {
    if (this.#endsAt === null) return;
    this.#pausedRemaining = Math.max(0, this.#endsAt - now);
    this.#endsAt = null;
  }

  resume(now) {
    if (this.#pausedRemaining === null) return;
    this.#endsAt = now + this.#pausedRemaining;
    this.#pausedRemaining = null;
  }

  /** Add (or with a negative value, remove) time; the timer never goes below zero. */
  extend(ms, now) {
    if (this.#endsAt !== null) this.#endsAt = Math.max(now, this.#endsAt + ms);
    else if (this.#pausedRemaining !== null)
      this.#pausedRemaining = Math.max(0, this.#pausedRemaining + ms);
    this.durationMs = Math.max(0, this.durationMs + ms);
  }

  reset() {
    this.#endsAt = null;
    this.#pausedRemaining = null;
    this.durationMs = 0;
  }

  remaining(now) {
    if (this.#endsAt !== null) return Math.max(0, this.#endsAt - now);
    return this.#pausedRemaining ?? 0;
  }

  isDone(now) {
    return this.#endsAt !== null && now >= this.#endsAt;
  }
}

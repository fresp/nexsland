/*
 * This file is part of the Nexsland GNOME extension.
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Damped spring integrator. Clutter only offers fixed easing curves
 * (EASE_OUT_BACK, EASE_OUT_ELASTIC, ...) whose duration is set up front, so a
 * retarget mid-flight restarts the curve and the motion visibly kinks. A spring
 * keeps its velocity across retargets, which is what makes the island morph feel
 * continuous when content changes quickly. Pure JS; driven per frame by the
 * renderer.
 */

export const SPRING_PRESETS = Object.freeze({
  // Slight overshoot, settles in ~350ms: the default morph.
  bouncy: Object.freeze({ stiffness: 380, damping: 26, mass: 1 }),
  // Critically damped-ish: no visible overshoot.
  smooth: Object.freeze({ stiffness: 300, damping: 35, mass: 1 }),
  // For reduced-motion users: fast, no overshoot.
  snappy: Object.freeze({ stiffness: 900, damping: 60, mass: 1 }),
});

const MAX_SUBSTEP_S = 1 / 240;
const MAX_FRAME_S = 1 / 15; // clamp long stalls so the spring does not explode

export class Spring {
  /**
   * @param {number} value initial value
   * @param {{ stiffness: number, damping: number, mass: number }} [params]
   * @param {{ restDelta?: number, restSpeed?: number }} [rest]
   */
  constructor(value, params = SPRING_PRESETS.bouncy, rest = {}) {
    this.value = value;
    this.target = value;
    this.velocity = 0;
    this.params = params;
    this.restDelta = rest.restDelta ?? 0.5;
    this.restSpeed = rest.restSpeed ?? 2;
  }

  get atRest() {
    return (
      Math.abs(this.target - this.value) <= this.restDelta &&
      Math.abs(this.velocity) <= this.restSpeed
    );
  }

  /** Jump to `value` with no animation. */
  snap(value) {
    this.value = value;
    this.target = value;
    this.velocity = 0;
  }

  /**
   * Advance by `dtSeconds`. Returns true when the spring has settled (and snaps
   * exactly onto the target so layout does not end on a sub-pixel value).
   */
  step(dtSeconds) {
    if (this.atRest) {
      this.value = this.target;
      this.velocity = 0;
      return true;
    }
    let remaining = Math.min(Math.max(dtSeconds, 0), MAX_FRAME_S);
    const { stiffness, damping, mass } = this.params;
    while (remaining > 0) {
      const h = Math.min(remaining, MAX_SUBSTEP_S);
      // Semi-implicit Euler: stable for these stiffness/damping ranges.
      const force = -stiffness * (this.value - this.target) - damping * this.velocity;
      this.velocity += (force / mass) * h;
      this.value += this.velocity * h;
      remaining -= h;
    }
    if (this.atRest) {
      this.value = this.target;
      this.velocity = 0;
      return true;
    }
    return false;
  }
}

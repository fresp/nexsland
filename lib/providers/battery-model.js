/*
 * This file is part of the Nexsland GNOME extension.
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * GI-free battery event detection from UPower DisplayDevice snapshots.
 */

/** org.freedesktop.UPower.Device State values. */
export const UPowerState = Object.freeze({
  UNKNOWN: 0,
  CHARGING: 1,
  DISCHARGING: 2,
  EMPTY: 3,
  FULLY_CHARGED: 4,
  PENDING_CHARGE: 5,
  PENDING_DISCHARGE: 6,
});

/** org.freedesktop.UPower.Device Type value for a battery. */
export const UPOWER_TYPE_BATTERY = 2;

export const LOW_PERCENT = 20;
export const CRITICAL_PERCENT = 10;

/** @param {number} state */
export function isOnAc(state) {
  return (
    state === UPowerState.CHARGING ||
    state === UPowerState.FULLY_CHARGED ||
    state === UPowerState.PENDING_CHARGE
  );
}

/**
 * @typedef {{ present: boolean, type: number, state: number, percentage: number }} BatterySnapshot
 * @typedef {"plugged" | "unplugged" | "full" | "low" | "critical"} BatteryEvent
 */

/**
 * What changed between two snapshots, if anything worth a HUD.
 * The first snapshot after startup (prev null) never produces an event, so
 * enabling the extension does not announce the current state.
 *
 * @param {BatterySnapshot | null} prev
 * @param {BatterySnapshot} next
 * @returns {BatteryEvent | null}
 */
export function batteryEvent(prev, next) {
  if (!prev || !next.present || next.type !== UPOWER_TYPE_BATTERY) return null;
  if (next.state === UPowerState.UNKNOWN) return null;

  const wasAc = isOnAc(prev.state);
  const nowAc = isOnAc(next.state);

  if (next.state === UPowerState.FULLY_CHARGED && prev.state !== UPowerState.FULLY_CHARGED) {
    // Plugging into an already full battery reads as "plugged", not "full".
    return wasAc ? "full" : "plugged";
  }
  if (nowAc && !wasAc) return "plugged";
  if (!nowAc && wasAc) return "unplugged";

  if (!nowAc) {
    if (prev.percentage > CRITICAL_PERCENT && next.percentage <= CRITICAL_PERCENT)
      return "critical";
    if (prev.percentage > LOW_PERCENT && next.percentage <= LOW_PERCENT) return "low";
  }
  return null;
}

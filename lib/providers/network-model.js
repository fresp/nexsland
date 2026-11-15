/*
 * This file is part of the Nexsland GNOME extension.
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * GI-free NetworkManager logic: what changed between two connectivity snapshots.
 */

/**
 * @typedef {{ id: string, type: string }} Conn
 * @typedef {{ primary: Conn | null, vpns: string[] }} NetSnapshot
 * @typedef {{ kind: "wifi-connected" | "wired-connected" | "connected" | "disconnected" | "vpn-connected" | "vpn-disconnected", name: string }} NetEvent
 */

export const VPN_TYPES = Object.freeze(["vpn", "wireguard"]);

const KIND_BY_TYPE = {
  "802-11-wireless": "wifi-connected",
  "802-3-ethernet": "wired-connected",
};

/**
 * @param {NetSnapshot | null} prev  null on the first snapshot: nothing is announced
 * @param {NetSnapshot} next
 * @returns {NetEvent[]}
 */
export function networkEvents(prev, next) {
  if (!prev) return [];
  /** @type {NetEvent[]} */
  const events = [];

  const before = prev.primary;
  const after = next.primary;
  const primaryChanged = before?.id !== after?.id || before?.type !== after?.type;
  // A VPN becoming "primary" is reported through the VPN events below.
  if (primaryChanged && !VPN_TYPES.includes(after?.type ?? "")) {
    if (after) {
      events.push({ kind: KIND_BY_TYPE[after.type] ?? "connected", name: after.id });
    } else if (before && !VPN_TYPES.includes(before.type)) {
      events.push({ kind: "disconnected", name: before.id });
    }
  }

  const was = new Set(prev.vpns);
  const now = new Set(next.vpns);
  for (const id of next.vpns) if (!was.has(id)) events.push({ kind: "vpn-connected", name: id });
  for (const id of prev.vpns) if (!now.has(id)) events.push({ kind: "vpn-disconnected", name: id });
  return events;
}

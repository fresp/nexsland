/*
 * This file is part of the Nexsland GNOME extension.
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * GI-free BlueZ device logic: connect/disconnect detection and icon mapping.
 */

/**
 * @typedef {{ connected: boolean, alias: string, icon: string, battery: number | null }} BtDevice
 * @typedef {"connected" | "disconnected"} BtEvent
 */

/**
 * @param {BtDevice | null | undefined} prev  null/undefined: device seen for the first time
 * @param {BtDevice} next
 * @returns {BtEvent | null}
 */
export function bluetoothEvent(prev, next) {
  // A device first seen while already connected (startup, adapter power-on) is
  // not announced: only a transition the user just caused is worth a HUD.
  if (!prev) return null;
  if (!prev.connected && next.connected) return "connected";
  if (prev.connected && !next.connected) return "disconnected";
  return null;
}

/** Merge a BlueZ PropertiesChanged dict into a device snapshot. */
export function applyDeviceProps(device, iface, changed) {
  const d = {
    connected: false,
    alias: "",
    icon: "",
    battery: null,
    ...(device ?? {}),
  };
  if (iface === "org.bluez.Device1") {
    if (typeof changed.Connected === "boolean") d.connected = changed.Connected;
    if (typeof changed.Alias === "string") d.alias = changed.Alias;
    else if (!d.alias && typeof changed.Name === "string") d.alias = changed.Name;
    if (typeof changed.Icon === "string") d.icon = changed.Icon;
  } else if (iface === "org.bluez.Battery1") {
    if (typeof changed.Percentage === "number") d.battery = changed.Percentage;
  }
  return d;
}

const ICONS = [
  ["audio-headset", "audio-headset-symbolic"],
  ["audio-headphones", "audio-headphones-symbolic"],
  ["audio-card", "audio-speakers-symbolic"],
  ["input-mouse", "input-mouse-symbolic"],
  ["input-keyboard", "input-keyboard-symbolic"],
  ["input-gaming", "input-gaming-symbolic"],
  ["input-tablet", "input-tablet-symbolic"],
  ["phone", "phone-symbolic"],
  ["computer", "computer-symbolic"],
];

/** Symbolic icon for a BlueZ Icon hint (freedesktop naming), Bluetooth glyph otherwise. */
export function deviceIconName(bluezIcon) {
  const hit = ICONS.find(([hint]) => bluezIcon === hint);
  return hit ? hit[1] : "bluetooth-active-symbolic";
}

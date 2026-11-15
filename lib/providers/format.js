/*
 * This file is part of the Nexsland GNOME extension.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/** 42 -> "00:42", 3723 -> "1:02:03". */
export function formatElapsed(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}

/** Apps that hold the microphone for metering, not recording (same list the shell skips). */
export const MIC_METERING_APPS = Object.freeze([
  "org.gnome.VolumeControl",
  "org.PulseAudio.pavucontrol",
]);

/**
 * Distinct, human-readable names of apps currently recording audio.
 * @param {{ appId: string | null, name: string | null }[]} outputs
 */
export function micUsers(outputs) {
  const names = [];
  for (const o of outputs) {
    if (o.appId && MIC_METERING_APPS.includes(o.appId)) continue;
    const name = (o.name || o.appId || "").trim();
    const label = name || "?";
    if (!names.includes(label)) names.push(label);
  }
  return names;
}

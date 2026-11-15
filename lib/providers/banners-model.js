/*
 * This file is part of the Nexsland GNOME extension.
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Which notifications become an island banner, and for how long. Mirrors GNOME's
 * own banner rules (MessageTray._onNotificationRequestBanner).
 */

/** MessageTray.Urgency */
export const Urgency = Object.freeze({ LOW: 0, NORMAL: 1, HIGH: 2, CRITICAL: 3 });

const DURATION_MS = 5000;
const CRITICAL_DURATION_MS = 10000;

/**
 * Whether GNOME would show a banner: not already seen, not low urgency, and
 * banners allowed for its source (Do Not Disturb, per-app settings) unless critical.
 * @param {{ acknowledged: boolean, urgency: number, showBanners: boolean }} n
 */
export function wantsBanner({ acknowledged, urgency, showBanners }) {
  if (acknowledged) return false;
  if (urgency === Urgency.LOW) return false;
  return showBanners || urgency === Urgency.CRITICAL;
}

export function bannerDuration(urgency) {
  return urgency === Urgency.CRITICAL ? CRITICAL_DURATION_MS : DURATION_MS;
}

function normalize(text) {
  return typeof text === "string" ? text.replace(/\s+/g, " ").trim().toLowerCase() : "";
}

/**
 * A player's own "now playing" notification for the track the island already
 * shows: its title or body is the track title (possibly cut short with "…").
 * @param {{ title?: string, body?: string }} n
 * @param {string | null | undefined} trackTitle
 */
export function echoesTrack(n, trackTitle) {
  const track = normalize(trackTitle);
  if (!track) return false;
  return [n.title, n.body].some((text) => {
    const t = normalize(text)
      .replace(/(\.\.\.|…)$/, "")
      .trim();
    return t.length >= 3 && (t === track || track.startsWith(t));
  });
}

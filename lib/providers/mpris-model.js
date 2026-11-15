/*
 * This file is part of the Nexsland GNOME extension.
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * GI-free MPRIS logic: which player to show and how to turn its Metadata into a
 * view model. Kept separate from the D-Bus plumbing so it is unit-testable.
 */

export const MPRIS_PREFIX = "org.mpris.MediaPlayer2.";

/** @param {string} busName */
export function isMprisName(busName) {
  return typeof busName === "string" && busName.startsWith(MPRIS_PREFIX);
}

/**
 * Pick the player the island should show.
 * Playing beats Paused; among equals the most recently changed wins. Stopped
 * players, and players with no title, are not shown.
 *
 * @param {{ busName: string, status: string, title: string, changedAt: number }[]} players
 */
export function pickActivePlayer(players) {
  const rank = { Playing: 2, Paused: 1 };
  let best = null;
  for (const p of players) {
    const r = rank[p.status] ?? 0;
    if (r === 0 || !p.title) continue;
    if (
      !best ||
      r > (rank[best.status] ?? 0) ||
      (r === rank[best.status] && p.changedAt > best.changedAt)
    ) {
      best = p;
    }
  }
  return best;
}

/**
 * Map a recursively-unpacked MPRIS Metadata dict to what the island renders.
 * @param {Record<string, unknown> | null | undefined} metadata
 */
export function metadataToTrack(metadata) {
  const md = metadata ?? {};
  const artists = md["xesam:artist"];
  const artist = Array.isArray(artists)
    ? artists.filter((a) => typeof a === "string" && a).join(", ")
    : typeof artists === "string"
      ? artists
      : "";
  const str = (v) => (typeof v === "string" ? v : "");
  return {
    trackId: str(md["mpris:trackid"]),
    title: str(md["xesam:title"]),
    artist,
    album: str(md["xesam:album"]),
    artUrl: str(md["mpris:artUrl"]),
  };
}

/** Readable app name from a bus name, e.g. org.mpris.MediaPlayer2.spotify -> spotify. */
export function playerLabel(busName) {
  if (!isMprisName(busName)) return busName ?? "";
  // Strip the per-instance suffix some players add (".instance1234").
  return busName.slice(MPRIS_PREFIX.length).replace(/\.instance_?\d+$/, "");
}

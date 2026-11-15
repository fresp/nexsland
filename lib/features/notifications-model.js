/*
 * This file is part of the Nexsland GNOME extension.
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Pure helpers for the Notifications tab: ordering, age and body text.
 */

/**
 * How long ago `thenSec` was, as a unit and count the tab formats and translates.
 * @param {number} nowSec @param {number} thenSec unix seconds
 * @returns {{ unit: "now" | "minutes" | "hours" | "days", count: number }}
 */
export function age(nowSec, thenSec) {
  const s = Math.max(0, nowSec - thenSec);
  if (!Number.isFinite(s) || s < 60) return { unit: "now", count: 0 };
  if (s < 3600) return { unit: "minutes", count: Math.floor(s / 60) };
  if (s < 86400) return { unit: "hours", count: Math.floor(s / 3600) };
  return { unit: "days", count: Math.floor(s / 86400) };
}

/** Newest first; entries without a time sort last, in their original order. */
export function newestFirst(entries) {
  return entries
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => (b.entry.time ?? -Infinity) - (a.entry.time ?? -Infinity) || a.index - b.index)
    .map(({ entry }) => entry);
}

/**
 * A notification body as one plain line, whitespace collapsed. With `markup` (the
 * notification's useBodyMarkup) Pango tags are stripped and entities decoded;
 * otherwise the text is literal, as GNOME shows it.
 */
export function plainBody(body, markup = false) {
  if (typeof body !== "string") return "";
  if (!markup) return body.replace(/\s+/g, " ").trim();
  return body
    .replace(/<[^>]*>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

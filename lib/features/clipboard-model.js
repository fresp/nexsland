/*
 * This file is part of the Nexsland GNOME extension.
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * In-memory clipboard history. Never persisted: it is gone on disable, logout
 * or shell restart, by design.
 */

/** Mime types password managers set to ask clipboard managers not to record. */
export const SENSITIVE_MIMETYPES = Object.freeze([
  "x-kde-passwordManagerHint",
  "application/x-nspasteboard-concealed-type",
]);

export function isSensitive(mimetypes) {
  return (mimetypes ?? []).some((m) => SENSITIVE_MIMETYPES.includes(m));
}

export class ClipboardHistory {
  /** @type {string[]} newest first */
  items = [];

  constructor({ max = 10, maxLength = 4000 } = {}) {
    this.max = max;
    this.maxLength = maxLength;
  }

  /** Record text; returns true when the history changed. Duplicates move to the top. */
  push(text) {
    if (typeof text !== "string" || text.trim() === "" || text.length > this.maxLength)
      return false;
    if (this.items[0] === text) return false;
    this.items = [text, ...this.items.filter((t) => t !== text)].slice(0, this.max);
    return true;
  }

  remove(text) {
    const before = this.items.length;
    this.items = this.items.filter((t) => t !== text);
    return this.items.length !== before;
  }

  clear() {
    this.items = [];
  }
}

/** One-line preview: whitespace collapsed, cut at `max` characters. */
export function preview(text, max = 60) {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

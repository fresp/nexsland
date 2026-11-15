/*
 * This file is part of the Nexsland GNOME extension.
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Heuristic download tracking from file events in the Downloads folder. Browsers
 * write to a partial file and rename it when done:
 *   Chromium: "Unconfirmed 1234.crdownload" -> "file.pdf.crdownload" -> "file.pdf"
 *   Firefox:  "file.pdf.part" -> "file.pdf"
 * Nothing here knows the total size, so progress is bytes so far, not a percentage.
 */

export const PARTIAL_SUFFIXES = Object.freeze([".crdownload", ".part", ".partial", ".download"]);

/** Final name a partial file will become, or null when `name` is not a partial file. */
export function partialTarget(name) {
  const suffix = PARTIAL_SUFFIXES.find((s) => name.endsWith(s) && name.length > s.length);
  return suffix ? name.slice(0, -suffix.length) : null;
}

/**
 * @typedef {{ kind: "started" | "completed" | "cancelled", name: string }} DownloadEvent
 */

export class DownloadTracker {
  /** @type {Map<string, { name: string, bytes: number }>} partial file name -> display info */
  active = new Map();

  /** @returns {DownloadEvent | null} */
  created(fileName) {
    const target = partialTarget(fileName);
    if (target === null || this.active.has(fileName)) return null;
    this.active.set(fileName, { name: target, bytes: 0 });
    return { kind: "started", name: target };
  }

  /** @returns {DownloadEvent | null} */
  renamed(from, to) {
    const entry = this.active.get(from);
    if (!entry) return this.created(to);
    this.active.delete(from);
    const target = partialTarget(to);
    if (target !== null) {
      this.active.set(to, { name: target, bytes: entry.bytes });
      return null;
    }
    return { kind: "completed", name: to };
  }

  /**
   * A partial file vanished: finished if its final file exists, cancelled otherwise.
   * @param {string} fileName
   * @param {(finalName: string) => boolean} finalExists
   * @returns {DownloadEvent | null}
   */
  deleted(fileName, finalExists) {
    const entry = this.active.get(fileName);
    if (!entry) return null;
    this.active.delete(fileName);
    return finalExists(entry.name)
      ? { kind: "completed", name: entry.name }
      : { kind: "cancelled", name: entry.name };
  }

  setSize(fileName, bytes) {
    const entry = this.active.get(fileName);
    if (entry) entry.bytes = Math.max(0, bytes);
  }

  /** @returns {{ count: number, name: string, bytes: number }} */
  summary() {
    let bytes = 0;
    for (const e of this.active.values()) bytes += e.bytes;
    const first = this.active.values().next().value;
    return { count: this.active.size, name: first?.name ?? "", bytes };
  }
}

/*
 * This file is part of the Nexsland GNOME extension.
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The `dconf dump` / `dconf load` text format for one settings path, without
 * running dconf: a "[/]" section of `key=<GVariant text>` lines. GI-free; callers
 * turn values into GVariants with the schema's key types.
 */

/**
 * @param {Array<[string, string]>} entries key and GVariant text, in output order
 * @returns {string}
 */
export function toKeyfile(entries) {
  const lines = ["[/]"];
  for (const [key, value] of entries) {
    if (/[\s=[\]]/.test(key)) throw new Error(`keyfile: invalid key ${JSON.stringify(key)}`);
    if (/[\r\n]/.test(value)) throw new Error(`keyfile: value for ${key} spans lines`);
    lines.push(`${key}=${value}`);
  }
  return `${lines.join("\n")}\n`;
}

/**
 * Entries of the "[/]" section. Other sections (child paths), comments and blank
 * lines are ignored; a later duplicate key wins, as with dconf load.
 * @param {string} text
 * @returns {Map<string, string>} key -> GVariant text
 */
export function parseKeyfile(text) {
  const entries = new Map();
  let section = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#") || line.startsWith(";")) continue;
    const header = line.match(/^\[(.*)\]$/);
    if (header) {
      section = header[1].trim();
      continue;
    }
    if (section !== "/") continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    entries.set(line.slice(0, eq).trim(), line.slice(eq + 1).trim());
  }
  return entries;
}

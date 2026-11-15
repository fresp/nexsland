/*
 * This file is part of the Nexsland GNOME extension.
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Adapted from NexTile's logger.
 */

export class Logger {
  static #settings = null;

  static LEVELS = Object.freeze({ OFF: 0, ERROR: 1, WARN: 2, INFO: 3, DEBUG: 4 });

  static init(settings) {
    this.#settings = settings;
  }

  /** Drop the settings ref on disable() so it does not outlive the extension. */
  static destroy() {
    this.#settings = null;
  }

  static get #level() {
    if (!this.#settings?.get_boolean?.("logging-enabled")) return Logger.LEVELS.OFF;
    return this.#settings?.get_uint?.("log-level") ?? Logger.LEVELS.OFF;
  }

  static error(...args) {
    if (this.#level >= Logger.LEVELS.ERROR) console.error("[Nexsland]", ...args);
  }

  static warn(...args) {
    if (this.#level >= Logger.LEVELS.WARN) console.warn("[Nexsland]", ...args);
  }

  static info(...args) {
    if (this.#level >= Logger.LEVELS.INFO) console.log("[Nexsland]", ...args);
  }

  static debug(...args) {
    if (this.#level >= Logger.LEVELS.DEBUG) console.debug("[Nexsland]", ...args);
  }
}

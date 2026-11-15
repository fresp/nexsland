/*
 * This file is part of the Nexsland GNOME extension.
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Every handler connected on an object Nexsland does not own (settings, layout
 * manager, overview, D-Bus) goes through a SignalTracker so disable() can drop
 * them all in one call. A handler that survives disable() is the most common
 * reason extensions get rejected on extensions.gnome.org.
 */

export class SignalTracker {
  /** @type {{ obj: { disconnect: (id: number) => void }, id: number }[]} */
  #handlers = [];

  /**
   * @param {{ connect: (signal: string, cb: Function) => number, disconnect: (id: number) => void }} obj
   * @param {string} signal
   * @param {Function} callback
   */
  track(obj, signal, callback) {
    const id = obj.connect(signal, callback);
    this.#handlers.push({ obj, id });
    return id;
  }

  get size() {
    return this.#handlers.length;
  }

  disconnectAll() {
    // Reverse order: later handlers may depend on earlier objects still wired.
    for (const { obj, id } of this.#handlers.reverse()) {
      try {
        obj.disconnect(id);
      } catch {
        // The object was already finalized; nothing left to disconnect.
      }
    }
    this.#handlers = [];
  }
}

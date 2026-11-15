/*
 * This file is part of the Nexsland GNOME extension.
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * IslandEngine: decides WHAT the island shows. It knows nothing about St,
 * Clutter or GNOME Shell, so it is unit-testable under plain Node.
 *
 * The presentation model follows DynamicNotch's NotchEngine (GPL-3.0):
 *
 *   - Live activities are persistent (media, timer, recording). Several can be
 *     active; the one with the highest priority is shown. A live activity can be
 *     dismissed by the user and restored later.
 *   - Temporary notifications are transient HUDs (volume, battery, bluetooth).
 *     They preempt whatever live activity is showing for `durationMs`, then the
 *     island falls back to the live stack. Temporaries queue in arrival order; a
 *     temporary with the same id as the one on screen replaces it and restarts
 *     its timer (e.g. repeated volume key presses).
 *
 * Content objects are opaque to the engine apart from these fields:
 *   id         string   unique per activity
 *   stackId    string?  a new live activity with the same stackId replaces the
 *                       old one (e.g. a player switching tracks under a new id)
 *   priority   number?  higher wins among live activities (default 0)
 *   restorable boolean? whether a dismissed live activity can be restored
 *                       (default true)
 *   expandable boolean? whether the activity has its own expanded presentation
 *                       (shown on the panel's Home tab); otherwise Home shows
 *                       its compact one
 *
 * "Expanded" means the panel is open. It is independent of content, so the
 * panel can be opened while idle; a temporary HUD hides it until the HUD ends.
 */

/** @typedef {{ id: string, stackId?: string, priority?: number, restorable?: boolean, expandable?: boolean }} IslandContent */
/** @typedef {{ kind: "live" | "temporary" | null, content: IslandContent | null, expanded: boolean }} IslandState */

const defaultScheduler = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (id) => clearTimeout(id),
};

export class IslandEngine {
  /** @type {IslandContent[]} newest first within equal priority */
  #live = [];
  /** @type {Set<string>} */
  #dismissed = new Set();
  /** @type {string[]} dismissal order, most recent last */
  #dismissOrder = [];
  /** @type {{ content: IslandContent, durationMs: number }[]} */
  #temporaryQueue = [];
  /** @type {{ content: IslandContent, durationMs: number } | null} */
  #temporary = null;
  #temporaryTimer = null;
  #expanded = false;
  #listeners = new Set();
  #scheduler;
  #lastEmitted = null;

  /** @param {{ scheduler?: { setTimeout: Function, clearTimeout: Function } }} [opts] */
  constructor(opts = {}) {
    // GJS has setTimeout since GNOME 45, but the extension injects a GLib-based
    // scheduler so timers are owned (and removed) by the extension lifecycle.
    this.#scheduler = opts.scheduler ?? defaultScheduler;
  }

  /** @returns {IslandState} */
  get state() {
    if (this.#temporary) {
      return { kind: "temporary", content: this.#temporary.content, expanded: false };
    }
    const live = this.#visibleLive();
    return live
      ? { kind: "live", content: live, expanded: this.#expanded }
      : { kind: null, content: null, expanded: this.#expanded };
  }

  /** @returns {IslandContent[]} live activities in display order, dismissed ones excluded */
  get liveStack() {
    return this.#live.filter((c) => !this.#dismissed.has(c.id));
  }

  /** @param {(state: IslandState) => void} listener @returns {() => void} unsubscribe */
  subscribe(listener) {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** Start or update a live activity. Updating a dismissed activity keeps it dismissed. */
  showLive(content) {
    this.#assertContent(content);
    this.#live = this.#live.filter(
      (c) => c.id !== content.id && !(content.stackId && c.stackId === content.stackId),
    );
    // Newest first, then a stable sort by priority: the newest entry wins ties.
    this.#live.unshift(content);
    this.#live.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
    this.#emit();
  }

  /** The live activity with `id` (shown, stacked or dismissed), or null. */
  liveContent(id) {
    return this.#live.find((c) => c.id === id) ?? null;
  }

  /** Whether the temporary `id` is on screen or still waiting in the queue. */
  hasTemporary(id) {
    return (
      this.#temporary?.content.id === id || this.#temporaryQueue.some((t) => t.content.id === id)
    );
  }

  /** End a live activity entirely. */
  hideLive(id) {
    this.#live = this.#live.filter((c) => c.id !== id);
    this.#forgetDismissal(id);
    this.#emit();
  }

  /** User dismissed what is on screen. A temporary is cut short; a live activity is stashed. */
  dismiss() {
    if (this.#temporary) {
      this.#endTemporary();
      return;
    }
    const live = this.#visibleLive();
    if (!live) return;
    if (live.restorable === false) {
      this.#live = this.#live.filter((c) => c.id !== live.id);
    } else {
      this.#dismissed.add(live.id);
      this.#dismissOrder.push(live.id);
    }
    this.#expanded = false;
    this.#emit();
  }

  /** Bring back the most recently dismissed live activity that still exists. */
  restore() {
    while (this.#dismissOrder.length > 0) {
      const id = this.#dismissOrder.pop();
      this.#dismissed.delete(id);
      if (this.#live.some((c) => c.id === id)) {
        this.#emit();
        return true;
      }
    }
    return false;
  }

  /** Show a transient HUD for `durationMs`, preempting live activities. */
  showTemporary(content, durationMs) {
    this.#assertContent(content);
    if (!(durationMs > 0)) throw new Error("showTemporary: durationMs must be > 0");
    if (this.#temporary?.content.id === content.id) {
      this.#temporary = { content, durationMs };
      this.#armTemporaryTimer(durationMs);
      this.#emit();
      return;
    }
    const queued = this.#temporaryQueue.findIndex((t) => t.content.id === content.id);
    if (queued >= 0) {
      this.#temporaryQueue[queued] = { content, durationMs };
      return;
    }
    this.#temporaryQueue.push({ content, durationMs });
    if (!this.#temporary) this.#nextTemporary();
  }

  /** Open or close the panel. */
  toggleExpanded() {
    this.#expanded = !this.#expanded;
    this.#emit();
  }

  /** Open the panel (hover, scroll down). */
  expand() {
    if (this.#expanded) return;
    this.#expanded = true;
    this.#emit();
  }

  collapse() {
    if (!this.#expanded) return;
    this.#expanded = false;
    this.#emit();
  }

  /** Clear everything: live stack, dismissals, temporaries. */
  hideAll() {
    this.#clearTemporaryTimer();
    this.#temporary = null;
    this.#temporaryQueue = [];
    this.#live = [];
    this.#dismissed.clear();
    this.#dismissOrder = [];
    this.#expanded = false;
    this.#emit();
  }

  destroy() {
    this.#clearTemporaryTimer();
    this.#listeners.clear();
    this.#temporary = null;
    this.#temporaryQueue = [];
    this.#live = [];
  }

  #visibleLive() {
    return this.#live.find((c) => !this.#dismissed.has(c.id)) ?? null;
  }

  #forgetDismissal(id) {
    this.#dismissed.delete(id);
    this.#dismissOrder = this.#dismissOrder.filter((d) => d !== id);
  }

  #nextTemporary() {
    const next = this.#temporaryQueue.shift() ?? null;
    this.#temporary = next;
    if (next) this.#armTemporaryTimer(next.durationMs);
    this.#emit();
  }

  #endTemporary() {
    this.#clearTemporaryTimer();
    this.#temporary = null;
    this.#nextTemporary();
  }

  #armTemporaryTimer(durationMs) {
    this.#clearTemporaryTimer();
    this.#temporaryTimer = this.#scheduler.setTimeout(() => {
      this.#temporaryTimer = null;
      this.#endTemporary();
    }, durationMs);
  }

  #clearTemporaryTimer() {
    if (this.#temporaryTimer !== null) {
      this.#scheduler.clearTimeout(this.#temporaryTimer);
      this.#temporaryTimer = null;
    }
  }

  #assertContent(content) {
    if (!content || typeof content.id !== "string" || content.id === "") {
      throw new Error("IslandEngine: content.id must be a non-empty string");
    }
  }

  #emit() {
    const state = this.state;
    const prev = this.#lastEmitted;
    // Skip no-op notifications so the renderer does not rebuild actors for nothing.
    // A live update with the same id but a new content object IS a change.
    if (
      prev &&
      prev.kind === state.kind &&
      prev.content === state.content &&
      prev.expanded === state.expanded
    ) {
      return;
    }
    this.#lastEmitted = state;
    for (const listener of [...this.#listeners]) listener(state);
  }
}

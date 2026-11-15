/*
 * This file is part of the Nexsland GNOME extension.
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Island: the single top-chrome actor that renders IslandEngine state.
 *
 * The outline (lib/engine/shape.js) is painted with Cairo on a St.DrawingArea:
 * St CSS cannot draw the concave "ears" of the attached style, and repainting a
 * small Cairo path is cheaper than re-resolving CSS every animation frame. Body
 * size, bottom radius and ear radius are springs (lib/engine/spring.js) stepped
 * from a Clutter.Timeline, so a retarget mid-animation keeps its momentum.
 *
 * Styles (setting island-style):
 *   attached  hangs from the bottom of the top bar, flat top + concave ears
 *             (the notch look Atoll uses). Ignores vertical-offset.
 *   floating  rounded pill below the top bar, offset by vertical-offset.
 */

import Cairo from "cairo";
import Clutter from "gi://Clutter";
import GLib from "gi://GLib";
import GObject from "gi://GObject";
import Meta from "gi://Meta";
import St from "gi://St";
import * as Main from "resource:///org/gnome/shell/ui/main.js";

import { gettext as _ } from "resource:///org/gnome/shell/extensions/extension.js";

import { islandMonitor, mergedPlacement, pillPlacement, topInset } from "../engine/placement.js";
import { DEFAULT_THEME, cssRgba } from "../engine/island-theme.js";
import { islandOutline, islandPath, outerSize } from "../engine/shape.js";
import { Spring, SPRING_PRESETS } from "../engine/spring.js";
import { SignalTracker } from "../shared/signals.js";
import { ClockFace } from "./clock-face.js";
import { PANEL_SIZE, Panel } from "./panel.js";
import { vbox } from "../shared/compat.js";

/**
 * Shown when there is no content, only with show-when-idle. Without it the island
 * is hidden while idle: an invisible hover target under the top bar opened the
 * panel whenever the pointer crossed a window header there.
 */
/** Hides a merged pill's own look; the island draws it instead. */
const PILL_HIDDEN_STYLE =
  "background-color: transparent !important; background-gradient-direction: none !important;" +
  " border-color: transparent !important; box-shadow: none !important;";

const IDLE = Object.freeze({ width: 140, height: 6, radius: 6, ear: 4 });
/** Idle with clock-in-island, hanging below the bar; the width follows the text. */
const CLOCK_IDLE = Object.freeze({ height: 28, radius: 14, ear: 6 });
const CLOCK_PADDING = 28;
const FADE_MS = 180;
// Long enough that a pointer passing over the island on its way elsewhere does
// not open the panel.
const HOVER_OPEN_MS = 300;
const HOVER_CLOSE_MS = 350;
const SCROLL_COOLDOWN_US = 250_000;

export const Island = GObject.registerClass(
  class NexslandIsland extends St.Widget {
    /**
     * @param {{
     *   engine: import("../engine/engine.js").IslandEngine,
     *   settings: any,
     *   scheduler: { setTimeout: (fn: () => void, ms: number) => number, clearTimeout: (id: number) => void },
     * }} params
     */
    constructor({ engine, settings, scheduler }) {
      super({
        style_class: "nexsland-island",
        reactive: true,
        track_hover: true,
        layout_manager: new Clutter.BinLayout(),
        opacity: 0,
        visible: false,
      });
      this._engine = engine;
      this._settings = settings;
      this._scheduler = scheduler;
      this._signals = new SignalTracker();
      this._overviewHidden = false;
      this._wantVisible = false;
      this._hoverTimer = null;
      this._lastFrameUs = 0;
      this._geometry = null;
      this._theme = DEFAULT_THEME;
      this._anchor = null; // pill-shaped bar island the island merges with (clock)
      this._anchorSignals = new SignalTracker();
      this._hoverSources = new Map(); // actor -> { signals }, e.g. the clock button
      this._lastTarget = IDLE;
      this._targetMerged = false; // whether the spring targets were set merged
      this._hovered = false; // the island or a hover source (the clock) is hovered
      this._urgent = false; // the content shown is urgent (see canPresent)
      this._clockActor = null; // the top bar's clock (dateMenu), hidden with clock-in-island
      this._syncingClock = false;
      this._clockHidden = null; // how it was hidden: { mode, opacity, reactive, visible }
      this._clockFace = null; // ClockFace while clock-in-island is on
      this._aboveBar = false;
      this._unredirectDisabled = false;
      this._presenting = false; // shown (or fading in), as last decided
      this._styledAnchor = null; // the pill whose own look is hidden
      this._styledAnchorStyle = null; // its inline style before that
      this._shownKey = null;
      this._tabs = [];
      this._panel = null;
      this._lastTabId = null;
      this._home = null; // { key, content, actor } of the Home tab's current view
      this._focusMonitor = global.display.focus_window?.get_monitor() ?? -1;
      this._locked = Main.sessionMode.isLocked;
      this._scrollAcc = { x: 0, y: 0 };
      this._lastScrollUs = 0;

      // Sized and placed in _applyGeometry: it reaches past the island by the
      // glow's size, so a neon glow is not cut off.
      this._shape = new St.DrawingArea({
        x_align: Clutter.ActorAlign.START,
        y_align: Clutter.ActorAlign.START,
      });
      this._repaintId = this._shape.connect("repaint", (area) => this._paint(area));
      this.add_child(this._shape);

      this._bin = new St.Bin({
        x_expand: true,
        y_expand: true,
        x_align: Clutter.ActorAlign.FILL,
        y_align: Clutter.ActorAlign.FILL,
        clip_to_allocation: true,
      });
      this.add_child(this._bin);

      const preset = this._preset();
      this._width = new Spring(IDLE.width, preset);
      this._height = new Spring(IDLE.height, preset);
      this._radius = new Spring(IDLE.radius, preset);
      this._ear = new Spring(IDLE.ear, preset, { restDelta: 0.2 });
      this._springs = [this._width, this._height, this._radius, this._ear];

      this._timeline = new Clutter.Timeline({ actor: this, duration: 1000, repeat_count: -1 });
      this._frameId = this._timeline.connect("new-frame", () => this._onFrame());

      this.connect("button-release-event", (_actor, event) => this._onClick(event));
      this.connect("notify::hover", () => this._onHover());
      this.connect("scroll-event", (_actor, event) => this._onScroll(event));
      // At shell shutdown the stage destroys the island without teardown(), and
      // the anchor and the timeline outlive it: stop both before their handlers
      // run on disposed children.
      this.connect("destroy", () => {
        this._anchorSignals.disconnectAll();
        this._timeline?.stop();
      });

      // No params: affectsInputRegion defaults to true on GNOME 46 and is an
      // unrecognized parameter (enable() throws) on GNOME 51.
      Main.layoutManager.addTopChrome(this);
      // Below the panel: a merged island sits behind the clock pill (whose top half
      // covers the island's top), and popup menus stay above the island.
      const uiGroup = Main.layoutManager.uiGroup;
      if (this.get_parent() === uiGroup)
        uiGroup.set_child_below_sibling(this, Main.layoutManager.panelBox);
      this._signals.track(Main.layoutManager, "monitors-changed", () => this._applyGeometry());
      // The Bar module marks the bar :windowmax while a window is maximized: the
      // bar turns solid and full width, so the island stops merging with the clock
      // and hangs below it; the glow follows neon-wmax then.
      this._signals.track(Main.panel, "notify::pseudo-class", () => {
        this._applyGeometry();
        this._shape.queue_repaint();
      });
      // The bar can move or resize (Bar module margins, height, position).
      for (const signal of ["notify::y", "notify::height"]) {
        this._signals.track(Main.panel, signal, () => this._applyGeometry());
        this._signals.track(Main.layoutManager.panelBox, signal, () => this._applyGeometry());
      }
      // Fullscreen is tracked here rather than with addTopChrome's trackFullscreen,
      // which toggles `visible` itself and would fight _updateVisibility().
      this._signals.track(global.display, "in-fullscreen-changed", () => this._updateVisibility());
      this._signals.track(Main.overview, "showing", () => this._setOverviewHidden(true));
      this._signals.track(Main.overview, "hidden", () => this._setOverviewHidden(false));
      this._signals.track(global.display, "notify::focus-window", () => this._onFocusChanged());
      for (const key of ["vertical-offset", "island-style", "island-monitor"]) {
        this._signals.track(settings, `changed::${key}`, () => this._applyGeometry());
      }
      this._signals.track(settings, "changed::show-when-idle", () =>
        this._render(this._engine.state),
      );
      this._signals.track(settings, "changed::clock-text", () =>
        this._clockFace?.setText(settings.get_string("clock-text")),
      );
      this._signals.track(settings, "changed::clock-in-island", () => {
        this._syncClockFace();
        this._shownKey = null;
        this._render(this._engine.state);
      });
      this._syncClockFace();
      this._signals.track(settings, "changed::show-on-lock-screen", () => this._updateVisibility());
      this._signals.track(Main.sessionMode, "updated", () => this._onSessionModeChanged());
      this._signals.track(settings, "changed::animation-style", () => {
        const p = this._preset();
        for (const s of this._springs) s.params = p;
      });

      this._unsubscribe = engine.subscribe((state) => this._render(state));
      this._applyGeometry();
      this._render(engine.state);
    }

    /** Explicit teardown; called from the extension's disable(). */
    teardown() {
      this._presenting = false;
      this._urgent = false;
      this._syncUnredirect(false);
      this._syncClockLook();
      this._clockActor = null;
      this._clockFace?.destroy();
      this._clockFace = null;
      this._syncAnchorStyle();
      this._anchorSignals.disconnectAll();
      for (const { signals } of this._hoverSources.values()) signals.disconnectAll();
      this._hoverSources.clear();
      this._panel?.release();
      this._panel = null;
      this._unsubscribe?.();
      this._unsubscribe = null;
      this._clearHoverTimer();
      this._signals.disconnectAll();
      if (this._timeline) {
        this._timeline.stop();
        this._timeline.disconnect(this._frameId);
        this._timeline = null;
      }
      this._shape.disconnect(this._repaintId);
      this.remove_all_transitions();
      Main.layoutManager.removeChrome(this);
      this.destroy();
    }

    _preset() {
      return SPRING_PRESETS[this._settings.get_string("animation-style")] ?? SPRING_PRESETS.bouncy;
    }

    get _style() {
      if (this._anchorRect()) return "merged";
      return this._settings.get_string("island-style") === "floating" ? "floating" : "attached";
    }

    /**
     * Merge with a pill-shaped bar island (the clock on an Islands/Trilands bar):
     * the island hangs behind it and continues it downwards. null to stop.
     * @param {Clutter.Actor | null} actor
     */
    setAnchor(actor) {
      if (actor === this._anchor) return;
      this._anchorSignals.disconnectAll();
      const presenting = this._presenting;
      this._presenting = false;
      this._syncAnchorStyle(); // give the old pill its look back
      this._presenting = presenting;
      this._anchor = actor;
      if (actor) {
        for (const signal of [
          // Size and position come from layout: follow the allocation itself.
          "notify::allocation",
          "notify::visible",
          // Not mapped while the overview is up at startup; merge once it is.
          "notify::mapped",
        ]) {
          this._anchorSignals.track(actor, signal, () => this._onAnchorChanged());
        }
        this._anchorSignals.track(actor, "destroy", () => this.setAnchor(null));
      }
      this._onAnchorChanged();
    }

    _onAnchorChanged() {
      this._retarget(this._lastTarget);
      this._applyGeometry();
    }

    /** The anchor's on-screen box, when merging applies (primary monitor, visible). */
    _anchorRect() {
      const a = this._anchor;
      if (!a || !a.visible || !a.mapped) return null;
      if (Main.panel.has_style_pseudo_class("windowmax")) return null;
      if (this.monitorIndex !== Main.layoutManager.primaryIndex) return null;
      const [x, y] = a.get_transformed_position();
      // The allocated size: width/height fall back to the preferred size while a
      // relayout is pending (e.g. a restyle), which can differ for a moment.
      const box = a.get_allocation_box();
      const width = box.get_width();
      const height = box.get_height();
      if (!Number.isFinite(x) || !Number.isFinite(y) || width <= 0 || height <= 0) return null;
      return { x, y, width, height };
    }

    /** Hovering `actor` (e.g. the clock) opens and closes the panel like hovering the island. */
    addHoverSource(actor) {
      if (this._hoverSources.has(actor)) return;
      const signals = new SignalTracker();
      signals.track(actor, "notify::hover", () => this._onHover());
      signals.track(actor, "destroy", () => this.removeHoverSource(actor));
      this._hoverSources.set(actor, { signals });
    }

    removeHoverSource(actor) {
      const entry = this._hoverSources.get(actor);
      if (!entry) return;
      entry.signals.disconnectAll();
      this._hoverSources.delete(actor);
    }

    /**
     * Opening from the clock (Nexsland's replacement for GNOME's date menu): like a
     * click, but lands on Notifications while any are unseen, as GNOME's clock dot
     * would lead there.
     */
    openFromClock() {
      if (this._locked) return;
      const unseen = Main.messageTray.getSources().some((source) => source.unseenCount > 0);
      if (unseen && this._allTabs().some((tab) => tab.id === "notifications"))
        this.showTab("notifications");
      this.activate();
    }

    /** Select tab `id` now if the panel is open, otherwise the next time it opens. */
    showTab(id) {
      this._lastTabId = id;
      this._panel?.select(id);
    }

    /** What a primary click on the island does; also used for the clock. */
    activate() {
      if (this._locked) return;
      // With hover-to-open, leaving the island closes it; a click inside the open
      // panel should not. Without hover, click is the only way to toggle.
      if (this._settings.get_boolean("open-on-hover")) this._engine.expand();
      else this._engine.toggleExpanded();
    }

    /** Feature tabs shown after Home, in order. */
    setTabs(tabs) {
      this._tabs = tabs;
      this._panel?.setTabs(this._allTabs());
    }

    _allTabs() {
      return [
        { id: "home", icon: "go-home-symbolic", title: _("Home"), build: () => this._buildHome() },
        ...this._tabs,
      ];
    }

    /**
     * Home shows the visible live activity (its expanded view if it has one).
     * Without one it shows a clock, or, when the panel header already shows the
     * time (clock-in-island), what Home is for.
     */
    _buildHome() {
      const content = this._engine.state.content;
      const pres = content ? (content.expanded ?? content.compact) : null;
      const actor =
        pres?.build?.() ?? (this._clockFace ? this._buildIdleHome() : this._buildClock());
      this._home = { key: content?.id ?? null, content, actor };
      const bin = new St.Bin({
        x_expand: true,
        y_expand: true,
        x_align: content?.expanded ? Clutter.ActorAlign.FILL : Clutter.ActorAlign.CENTER,
        y_align: content?.expanded ? Clutter.ActorAlign.FILL : Clutter.ActorAlign.CENTER,
        child: actor,
      });
      if (!content?.expanded && pres) actor.set_size(pres.width, pres.height);
      return bin;
    }

    _buildClock() {
      const now = GLib.DateTime.new_now_local();
      const box = vbox({
        style_class: "nexsland-clock",
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
      });
      box.add_child(new St.Label({ text: now.format("%R"), style_class: "nexsland-clock-time" }));
      box.add_child(
        new St.Label({ text: now.format("%A, %e %B"), style_class: "nexsland-clock-date" }),
      );
      return box;
    }

    _buildIdleHome() {
      const box = vbox({
        style_class: "nexsland-home-idle",
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
      });
      box.add_child(
        new St.Icon({
          icon_name: "media-playback-start-symbolic",
          icon_size: 20,
          style_class: "nexsland-home-idle-icon",
          x_align: Clutter.ActorAlign.CENTER,
        }),
      );
      box.add_child(
        new St.Label({ text: _("Nothing active"), style_class: "nexsland-home-idle-title" }),
      );
      box.add_child(
        new St.Label({
          text: _("Media, timers and recordings show up here"),
          style_class: "nexsland-home-idle-hint",
        }),
      );
      return box;
    }

    /** Keep the open panel's Home tab in step with the engine. */
    _syncHome(state) {
      const content = state.content;
      const key = content?.id ?? null;
      const pres = content ? (content.expanded ?? content.compact) : null;
      if (this._home && key === this._home.key && content === this._home.content) return;
      if (this._home && key !== null && key === this._home.key && pres?.update) {
        pres.update(this._home.actor);
        this._home.content = content;
        return;
      }
      this._panel?.refresh("home");
    }

    /**
     * On the lock screen the island shows activities and HUDs only, and only with
     * show-on-lock-screen. The panel never opens there: its tabs (clipboard history
     * above all) are not for whoever is in front of a locked machine.
     */
    _onSessionModeChanged() {
      const locked = Main.sessionMode.isLocked;
      if (locked === this._locked) return;
      this._locked = locked;
      this._clearHoverTimer();
      if (locked) this._engine.collapse();
      this._updateVisibility();
    }

    _render(state) {
      if (state.expanded && this._locked) {
        this._engine.collapse(); // re-renders collapsed
        return;
      }
      if (state.expanded) {
        this._renderPanel(state);
        return;
      }
      if (this._panel) {
        this._lastTabId = this._panel.selectedId;
        this._panel.release();
        this._panel = null;
        this._home = null;
      }

      const content = state.content;
      this._urgent = Boolean(content?.urgent);
      const pres = content ? (state.expanded ? content.expanded : content.compact) : null;
      if (!content && this._clockFace) {
        this._renderClock();
        return;
      }
      const target = pres ?? IDLE;

      // Same activity, same presentation, and the content can patch its actor:
      // update in place. Rebuilding would restart the fade on every volume key
      // press and make the HUD flicker.
      const key = content ? `${content.id}|${state.expanded ? "expanded" : "compact"}` : null;
      const old = this._bin.get_child();
      if (key && key === this._shownKey && old && pres?.update) {
        pres.update(old);
        this._retarget(target);
        return;
      }
      this._shownKey = key;

      const child = pres?.build?.() ?? null;
      if (child) {
        child.opacity = 0;
        child.ease({
          opacity: 255,
          duration: FADE_MS,
          delay: 60,
          mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
      }
      this._bin.set_child(child);
      old?.destroy();
      this._retarget(target);

      this._wantVisible = !!content || this._settings.get_boolean("show-when-idle");
      this._updateVisibility();
    }

    /** Idle with clock-in-island: the island shows the time. */
    _renderClock() {
      if (this._shownKey !== "clock" || !this._bin.get_child()) {
        const old = this._bin.get_child();
        const child = this._clockFace.buildCompact();
        child.opacity = 0;
        child.ease({
          opacity: 255,
          duration: FADE_MS,
          delay: 60,
          mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
        this._bin.set_child(child);
        old?.destroy();
        this._shownKey = "clock";
      }
      this._fitClock();
      this._wantVisible = this._settings.get_boolean("show-when-idle");
      this._updateVisibility();
    }

    _fitClock() {
      const child = this._bin.get_child();
      if (!child) return;
      const [, natural] = child.get_preferred_width(-1);
      const width = Math.ceil(natural) + CLOCK_PADDING;
      if (this._lastTarget?.clock && this._lastTarget.width === width) return;
      this._retarget({ ...CLOCK_IDLE, width, clock: true });
    }

    /** clock-in-island: a ClockFace while it is on. */
    _syncClockFace() {
      const wanted = this._settings.get_boolean("clock-in-island");
      if (wanted && !this._clockFace) {
        this._clockFace = new ClockFace();
        this._clockFace.setText(this._settings.get_string("clock-text"));
        // The time or the text changed width: fit the idle island to it.
        this._clockFace.onChanged = () => {
          if (this._shownKey === "clock") this._fitClock();
        };
      } else if (!wanted && this._clockFace) {
        this._clockFace.destroy();
        this._clockFace = null;
      }
      this._syncClockLook();
    }

    /** The top bar's clock, hidden while the island shows the time instead. */
    setClock(actor) {
      if (actor === this._clockActor) return;
      const presenting = this._presenting;
      this._presenting = false;
      this._syncClockLook(); // give the old one back
      this._presenting = presenting;
      this._clockActor = actor;
      this._syncClockLook();
    }

    _renderPanel(state) {
      if (this._panel) {
        this._syncHome(state);
      } else {
        this._panel = new Panel({
          tabs: this._allTabs(),
          selected: this._lastTabId,
          clock: this._clockFace,
        });
        const child = this._panel.actor;
        child.opacity = 0;
        child.ease({
          opacity: 255,
          duration: FADE_MS,
          delay: 60,
          mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
        const old = this._bin.get_child();
        this._bin.set_child(child);
        old?.destroy();
        this._shownKey = "panel";
      }
      this._retarget(PANEL_SIZE);
      this._wantVisible = true;
      this._updateVisibility();
    }

    _retarget(target) {
      this._lastTarget = target;
      const anchor = this._anchorRect();
      this._targetMerged = Boolean(anchor);
      if (anchor && this._clockFace) {
        // clock-in-island: the island takes the pill's place, at least its size;
        // idle it is the pill.
        const idle = target === IDLE || target.clock;
        // Idle it is at least the pill; wider when the clock text needs it.
        const m = pillPlacement({ anchor, width: target === IDLE ? 0 : target.width });
        this._width.target = m.width;
        this._height.target = idle ? anchor.height : Math.max(target.height, anchor.height);
        this._radius.target = idle ? anchor.height / 2 : (target.radius ?? target.height / 2);
        this._ear.target = 0;
      } else if (anchor) {
        // Merged: the island covers the pill and grows below it, at least as wide.
        // Idle is exactly as wide, with the pill's radius: one slightly taller capsule.
        const m = mergedPlacement({ anchor, width: target === IDLE ? 0 : target.width });
        this._width.target = m.width;
        this._height.target = target.height + m.overlap;
        this._radius.target = target === IDLE ? m.cap.height : (target.radius ?? target.height / 2);
        this._ear.target = 0;
      } else {
        this._width.target = target.width;
        this._height.target = target.height;
        this._radius.target = target.radius ?? target.height / 2;
        this._ear.target = target.ear ?? 0;
      }

      if (!St.Settings.get().enable_animations) {
        for (const s of this._springs) s.snap(s.target);
        this._applyGeometry();
      } else if (!this._timeline.is_playing()) {
        this._lastFrameUs = 0;
        this._timeline.start();
      }
    }

    _onFrame() {
      const now = GLib.get_monotonic_time();
      const dt = this._lastFrameUs ? (now - this._lastFrameUs) / 1e6 : 1 / 60;
      this._lastFrameUs = now;
      const settled = this._springs.map((s) => s.step(dt)).every(Boolean);
      this._applyGeometry();
      if (settled) {
        this._timeline.stop();
        this._lastFrameUs = 0;
      }
    }

    _applyGeometry() {
      // Whether the pill can be merged with can change without a signal from it
      // (at startup it is not on screen yet when the targets are first set).
      if (Boolean(this._anchorRect()) !== this._targetMerged) {
        this._retarget(this._lastTarget);
        if (!St.Settings.get().enable_animations) return; // _retarget applied it
      }
      const style = this._style;
      const body = {
        width: Math.max(1, Math.round(this._width.value)),
        height: Math.max(1, Math.round(this._height.value)),
        radius: Math.max(0, this._radius.value),
        ear: Math.max(0, this._ear.value),
        style,
      };
      const anchor = style === "merged" ? this._anchorRect() : null;
      // clock-in-island takes the pill's place: a plain rounded shape, content
      // from the top. Otherwise the island draws the pill and hangs below it.
      const merged =
        anchor && !this._clockFace ? mergedPlacement({ anchor, width: body.width }) : null;
      if (merged) {
        body.cap = merged.cap;
        body.topRadius = body.radius;
      }
      this._setAboveBar(Boolean(anchor && this._clockFace));
      const outer = outerSize(body);
      this._geometry = body;
      this.set_size(outer.width, outer.height);
      const glow = this._theme.glow?.size ?? 0;
      this._shape.set_position(-glow, -glow);
      this._shape.set_size(outer.width + 2 * glow, outer.height + 2 * glow);
      // Content lives in the body: not under the ears, nor behind the clock pill.
      this._bin.margin_left = outer.ear;
      this._bin.margin_right = outer.ear;
      this._bin.margin_top = merged ? merged.overlap : 0;
      this._shape.queue_repaint();
      this._reposition(outer.width);
      this._syncAnchorStyle();
      this._syncClockLook();
    }

    /**
     * Below the bar a merged island sits behind the clock pill, and the pill
     * takes the pointer; in the pill's place (clock-in-island) the island is
     * above the bar so it gets the pointer itself. Menus stay above either way.
     */
    _setAboveBar(above) {
      if (above === this._aboveBar) return;
      const uiGroup = Main.layoutManager.uiGroup;
      if (this.get_parent() !== uiGroup) return;
      this._aboveBar = above;
      if (above) uiGroup.set_child_above_sibling(this, Main.layoutManager.panelBox);
      else uiGroup.set_child_below_sibling(this, Main.layoutManager.panelBox);
    }

    /**
     * clock-in-island: while the island is shown, the top bar's clock is not.
     * A clock pill the island is anchored to keeps its slot in the bar (the island
     * sits there) but is invisible and lets the pointer through; any other clock
     * is hidden. It comes back whenever the island is not shown (overview,
     * fullscreen, show-when-idle off), with the setting off, and on teardown.
     */
    _syncClockLook() {
      // Showing or hiding the clock remaps it, and its notify::mapped comes back
      // here (the anchor's handler): let the outer call finish on its own.
      if (this._syncingClock) return;
      this._syncingClock = true;
      try {
        this._syncClockLookNow();
      } finally {
        this._syncingClock = false;
      }
    }

    _syncClockLookNow() {
      const clock = this._clockActor;
      const want = this._presenting && this._clockFace && clock ? clock : null;
      const mode = want && this._anchor === want ? "slot" : "hide";
      const current = this._clockHidden;
      if (current && current.actor === want && current.mode === mode) return;
      if (current) {
        this._clockHidden = null;
        const { actor } = current;
        if (current.mode === "slot") {
          actor.opacity = current.opacity;
          actor.reactive = current.reactive;
        } else {
          actor.container?.show();
        }
      }
      if (!want) return;
      this._clockHidden = { actor: want, mode, opacity: want.opacity, reactive: want.reactive };
      if (mode === "slot") {
        want.opacity = 0;
        want.reactive = false;
      } else {
        want.container?.hide();
      }
    }

    /**
     * While the island is shown merged it draws the pill, so the pill's own
     * background, border and glow are hidden (inline style, restored otherwise:
     * hidden island, other monitor, unmerged, teardown).
     */
    _syncAnchorStyle() {
      const takeOver = this._style === "merged" || this._clockFace;
      const want = this._presenting && takeOver && this._anchor ? this._anchor : null;
      if (want === this._styledAnchor) return;
      if (this._styledAnchor) {
        this._styledAnchor.set_style(this._styledAnchorStyle);
        this._styledAnchor = null;
        this._styledAnchorStyle = null;
      }
      if (want) {
        this._styledAnchor = want;
        this._styledAnchorStyle = want.get_style();
        want.set_style(`${this._styledAnchorStyle ?? ""} ${PILL_HIDDEN_STYLE}`.trim());
      }
    }

    /**
     * Colours for the shape and text (lib/engine/island-theme.js). The default is
     * black with white text; with the Bar module on, the bar's own colours.
     * @param {import("../engine/island-theme.js").IslandTheme | null} theme
     */
    setTheme(theme) {
      this._theme = theme ?? DEFAULT_THEME;
      // Primary text follows the theme's foreground; .light flips the secondary
      // whites in the stylesheet (labels, tracks, buttons) for light backgrounds.
      this.set_style(`color: ${cssRgba(this._theme.fg)};`);
      if (this._theme.light) this.add_style_class_name("light");
      else this.remove_style_class_name("light");
      this._applyGeometry(); // the glow changes the drawing area's size
    }

    _paint(area) {
      const cr = area.get_context();
      const trace = (commands) => {
        for (const c of commands) {
          if (c.op === "move") cr.moveTo(c.x, c.y);
          else if (c.op === "line") cr.lineTo(c.x, c.y);
          else if (c.op === "arc") cr.arc(c.xc, c.yc, c.r, c.a1, c.a2);
          else if (c.op === "arcNegative") cr.arcNegative(c.xc, c.yc, c.r, c.a1, c.a2);
          else if (c.op === "close") cr.closePath();
        }
      };
      try {
        const g = this._geometry;
        if (!g) return;
        const { fill, glow } = this._theme;
        const hover = this._hovered ? this._theme.hover : null;
        // Hovered with the hover effect: Open Bar's thicker border in the hover colour.
        const border = hover ? { color: hover.color, width: hover.width } : this._theme.border;
        if (glow) {
          // The drawing area starts glow.size up and left of the island.
          cr.translate(glow.size, glow.size);
          const windowMax = Main.panel.has_style_pseudo_class("windowmax");
          if (glow.wmax || !windowMax)
            this._paintGlow(cr, trace, g, { ...glow, color: hover?.glow ?? glow.color });
        }
        trace(islandPath(g));
        cr.setSourceRGBA(...fill);
        if (!border) {
          cr.fill();
          return;
        }
        // Keep the path as a clip so the border is drawn inside the shape: a line
        // twice the border width, clipped, shows exactly the border width.
        cr.fillPreserve();
        cr.clip();
        cr.newPath();
        trace(islandOutline(g));
        cr.setSourceRGBA(...border.color);
        cr.setLineWidth(border.width * 2);
        cr.stroke();
      } finally {
        cr.$dispose();
      }
    }

    /**
     * A soft halo outside the outline (Open Bar's neon, a CSS box-shadow there):
     * nested strokes, each a little wider and fainter, so the overlap falls off
     * from the edge. Clipped to outside the shape, so it does not tint a
     * translucent fill.
     */
    _paintGlow(cr, trace, g, glow) {
      const [r, gr, b, a] = glow.color;
      const outer = outerSize(g);
      cr.save();
      cr.rectangle(
        -glow.size,
        -glow.size,
        outer.width + 2 * glow.size,
        outer.height + 2 * glow.size,
      );
      trace(islandPath(g));
      cr.setFillRule(Cairo.FillRule.EVEN_ODD);
      cr.clip();
      const steps = Math.max(1, Math.round(glow.size));
      // Per-stroke alpha such that all of them together reach `a` at the edge.
      const each = 1 - (1 - a) ** (1 / steps);
      cr.setSourceRGBA(r, gr, b, each);
      for (let i = 1; i <= steps; i++) {
        trace(islandOutline(g));
        cr.setLineWidth(2 * i);
        cr.stroke();
      }
      cr.restore();
      cr.setFillRule(Cairo.FillRule.WINDING);
    }

    /** Monitor the island is on: primary, or the focused window's (island-monitor). */
    get monitorIndex() {
      return islandMonitor({
        mode: this._settings.get_string("island-monitor"),
        primaryIndex: Main.layoutManager.primaryIndex,
        focusIndex: this._focusMonitor,
        nMonitors: Main.layoutManager.monitors.length,
      });
    }

    _onFocusChanged() {
      // Keep the last real monitor when focus goes to nothing (desktop, overview),
      // so the island does not jump back to the primary monitor in between.
      const index = global.display.focus_window?.get_monitor() ?? -1;
      if (index < 0 || index === this._focusMonitor) return;
      this._focusMonitor = index;
      if (this._settings.get_string("island-monitor") === "focused") {
        this._applyGeometry();
        this._updateVisibility();
      }
    }

    _reposition(outerWidth = this.width) {
      const anchor = this._anchorRect();
      if (anchor && this._style === "merged") {
        const m = this._clockFace
          ? pillPlacement({ anchor, width: outerWidth })
          : mergedPlacement({ anchor, width: outerWidth });
        this.set_position(m.x, m.y);
        return;
      }
      const index = this.monitorIndex;
      const monitor = Main.layoutManager.monitors[index];
      if (!monitor) return;
      // The visible bar, not the panel box: a floating bar sits inside the box
      // with a margin, and the island should touch the bar itself.
      const [, panelY] = Main.panel.get_transformed_position();
      // Over a fullscreen window the bar is hidden: hang from the screen edge.
      const barShown = Main.panel.mapped;
      const inset = topInset({
        monitorIndex: index,
        primaryIndex: barShown ? Main.layoutManager.primaryIndex : -1,
        panelTop: panelY - monitor.y,
        panelHeight: Main.panel.height,
        monitorHeight: monitor.height,
      });
      const offset = this._style === "floating" ? this._settings.get_int("vertical-offset") : 0;
      const x = monitor.x + Math.round((monitor.width - outerWidth) / 2);
      this.set_position(x, monitor.y + inset + offset);
    }

    /**
     * Whether a HUD shown now would actually be seen: not in the overview, not
     * under a fullscreen window, and (when the request names a monitor) on the
     * monitor the island is on. Urgent content (a critical notification) is shown
     * over the overview and fullscreen windows too, as GNOME's critical banners are.
     * @param {number} [requestedMonitor] -1 or omitted: any monitor
     * @param {boolean} [urgent]
     */
    canPresent(requestedMonitor = -1, urgent = false) {
      if (this._locked && !this._settings.get_boolean("show-on-lock-screen")) return false;
      const index = this.monitorIndex;
      if (requestedMonitor >= 0 && requestedMonitor !== index) return false;
      if (urgent) return true;
      const fullscreen = global.display.get_monitor_in_fullscreen(index);
      return !this._overviewHidden && !fullscreen;
    }

    /**
     * Over a fullscreen window the compositor may hand the screen straight to the
     * app (unredirect), which would hide the island: turn that off while urgent
     * content is shown, as GNOME does for its banners.
     */
    _syncUnredirect(show) {
      const fullscreen = global.display.get_monitor_in_fullscreen(this.monitorIndex);
      const want = show && this._urgent && fullscreen;
      if (want === this._unredirectDisabled) return;
      this._unredirectDisabled = want;
      if (want) Meta.disable_unredirect_for_display(global.display);
      else Meta.enable_unredirect_for_display(global.display);
    }

    _setOverviewHidden(hidden) {
      this._overviewHidden = hidden;
      this._updateVisibility();
    }

    _updateVisibility() {
      const show = this._wantVisible && this.canPresent(-1, this._urgent);
      this._presenting = show;
      this._syncUnredirect(show);
      this._applyGeometry(); // also re-checks merging, and syncs the pill's look
      if (show) this.show();
      this.ease({
        opacity: show ? 255 : 0,
        duration: FADE_MS,
        mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        onComplete: () => {
          if (!show) this.hide();
        },
      });
    }

    _onHover() {
      this._clearHoverTimer();
      const entering = this.hover || [...this._hoverSources.keys()].some((actor) => actor.hover);
      if (entering !== this._hovered) {
        this._hovered = entering;
        if (this._theme.hover) this._shape.queue_repaint();
      }
      if (this._locked) return;
      if (!this._settings.get_boolean("open-on-hover")) return;
      this._hoverTimer = this._scheduler.setTimeout(
        () => {
          this._hoverTimer = null;
          if (entering) this._engine.expand();
          else this._engine.collapse();
        },
        entering ? HOVER_OPEN_MS : HOVER_CLOSE_MS,
      );
    }

    _clearHoverTimer() {
      if (this._hoverTimer !== null) {
        this._scheduler.clearTimeout(this._hoverTimer);
        this._hoverTimer = null;
      }
    }

    _onClick(event) {
      const button = event.get_button();
      if (button === Clutter.BUTTON_PRIMARY) {
        this.activate();
        return Clutter.EVENT_STOP;
      }
      if (button === Clutter.BUTTON_MIDDLE || button === Clutter.BUTTON_SECONDARY) {
        this._engine.dismiss();
        return Clutter.EVENT_STOP;
      }
      return Clutter.EVENT_PROPAGATE;
    }

    /**
     * Scroll down opens the panel, up closes it, sideways switches tabs. Smooth
     * (touchpad) deltas are accumulated to one step, with a short cooldown so one
     * swipe is one action.
     */
    _onScroll(event) {
      let dx = 0;
      let dy = 0;
      switch (event.get_scroll_direction()) {
        case Clutter.ScrollDirection.SMOOTH:
          [dx, dy] = event.get_scroll_delta();
          break;
        case Clutter.ScrollDirection.UP:
          dy = -1;
          break;
        case Clutter.ScrollDirection.DOWN:
          dy = 1;
          break;
        case Clutter.ScrollDirection.LEFT:
          dx = -1;
          break;
        case Clutter.ScrollDirection.RIGHT:
          dx = 1;
          break;
      }
      const now = GLib.get_monotonic_time();
      if (now - this._lastScrollUs < SCROLL_COOLDOWN_US) return Clutter.EVENT_STOP;
      this._scrollAcc.x += dx;
      this._scrollAcc.y += dy;
      const { x, y } = this._scrollAcc;
      if (Math.max(Math.abs(x), Math.abs(y)) < 1) return Clutter.EVENT_STOP;
      this._scrollAcc = { x: 0, y: 0 };
      this._lastScrollUs = now;
      if (Math.abs(y) >= Math.abs(x)) {
        if (y > 0 && !this._locked) this._engine.expand();
        else this._engine.collapse();
      } else {
        this._panel?.step(x > 0 ? 1 : -1);
      }
      return Clutter.EVENT_STOP;
    }
  },
);

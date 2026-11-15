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

import Clutter from "gi://Clutter";
import GLib from "gi://GLib";
import GObject from "gi://GObject";
import St from "gi://St";
import * as Main from "resource:///org/gnome/shell/ui/main.js";

import { islandPath, outerSize } from "../engine/shape.js";
import { Spring, SPRING_PRESETS } from "../engine/spring.js";
import { SignalTracker } from "../shared/signals.js";

/** Shown when there is no content (only with show-when-idle). */
const IDLE = Object.freeze({ width: 140, height: 6, radius: 6, ear: 4 });
const FADE_MS = 180;
const HOVER_OPEN_MS = 120;
const HOVER_CLOSE_MS = 350;

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
      this._shownKey = null;

      this._shape = new St.DrawingArea({ x_expand: true, y_expand: true });
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

      Main.layoutManager.addTopChrome(this, { affectsInputRegion: true });
      this._signals.track(Main.layoutManager, "monitors-changed", () => this._applyGeometry());
      // Fullscreen is tracked here rather than with addTopChrome's trackFullscreen,
      // which toggles `visible` itself and would fight _updateVisibility().
      this._signals.track(global.display, "in-fullscreen-changed", () => this._updateVisibility());
      this._signals.track(Main.overview, "showing", () => this._setOverviewHidden(true));
      this._signals.track(Main.overview, "hidden", () => this._setOverviewHidden(false));
      for (const key of ["vertical-offset", "island-style"]) {
        this._signals.track(settings, `changed::${key}`, () => this._applyGeometry());
      }
      this._signals.track(settings, "changed::show-when-idle", () =>
        this._render(this._engine.state),
      );
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
      return this._settings.get_string("island-style") === "floating" ? "floating" : "attached";
    }

    _render(state) {
      const content = state.content;
      const pres = content ? (state.expanded ? content.expanded : content.compact) : null;
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

    _retarget(target) {
      this._width.target = target.width;
      this._height.target = target.height;
      this._radius.target = target.radius ?? target.height / 2;
      this._ear.target = target.ear ?? 0;

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
      const style = this._style;
      const body = {
        width: Math.max(1, Math.round(this._width.value)),
        height: Math.max(1, Math.round(this._height.value)),
        radius: Math.max(0, this._radius.value),
        ear: Math.max(0, this._ear.value),
        style,
      };
      const outer = outerSize(body);
      this._geometry = body;
      this.set_size(outer.width, outer.height);
      // Content lives in the body, not under the ears.
      this._bin.margin_left = outer.ear;
      this._bin.margin_right = outer.ear;
      this._shape.queue_repaint();
      this._reposition(outer.width);
    }

    _paint(area) {
      const cr = area.get_context();
      try {
        const g = this._geometry;
        if (!g) return;
        cr.setSourceRGBA(0, 0, 0, 1);
        for (const c of islandPath(g)) {
          if (c.op === "move") cr.moveTo(c.x, c.y);
          else if (c.op === "line") cr.lineTo(c.x, c.y);
          else if (c.op === "arc") cr.arc(c.xc, c.yc, c.r, c.a1, c.a2);
          else if (c.op === "arcNegative") cr.arcNegative(c.xc, c.yc, c.r, c.a1, c.a2);
          else if (c.op === "close") cr.closePath();
        }
        cr.fill();
      } finally {
        cr.$dispose();
      }
    }

    _reposition(outerWidth = this.width) {
      const monitor = Main.layoutManager.primaryMonitor;
      if (!monitor) return;
      const panelHeight = Main.layoutManager.panelBox?.height ?? 0;
      const offset = this._style === "floating" ? this._settings.get_int("vertical-offset") : 0;
      const x = monitor.x + Math.round((monitor.width - outerWidth) / 2);
      this.set_position(x, monitor.y + panelHeight + offset);
    }

    _setOverviewHidden(hidden) {
      this._overviewHidden = hidden;
      this._updateVisibility();
    }

    _updateVisibility() {
      const fullscreen = global.display.get_monitor_in_fullscreen(Main.layoutManager.primaryIndex);
      const show = this._wantVisible && !this._overviewHidden && !fullscreen;
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
      if (!this._settings.get_boolean("open-on-hover")) return;
      const entering = this.hover;
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
        this._engine.toggleExpanded();
        return Clutter.EVENT_STOP;
      }
      if (button === Clutter.BUTTON_MIDDLE || button === Clutter.BUTTON_SECONDARY) {
        this._engine.dismiss();
        return Clutter.EVENT_STOP;
      }
      return Clutter.EVENT_PROPAGATE;
    }
  },
);

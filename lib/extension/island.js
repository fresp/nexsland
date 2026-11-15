/*
 * This file is part of the Nexsland GNOME extension.
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Island: the single top-chrome actor that renders IslandEngine state. Size and
 * corner radius are driven by springs (lib/engine/spring.js) stepped from a
 * Clutter.Timeline, so a retarget mid-animation keeps its momentum.
 *
 * Phase 0 spike notes (see README "Roadmap"):
 *   - border-radius is animated through set_style(), which re-resolves CSS on
 *     every radius change. Fine for a spike; if profiling shows it is costly the
 *     plan is a rounded-rect clip shader (Shell.GLSLEffect).
 *   - Only the primary monitor, placed just below the top panel. Whether the
 *     island should take over the clock slot is an open design decision.
 */

import Clutter from "gi://Clutter";
import GLib from "gi://GLib";
import GObject from "gi://GObject";
import St from "gi://St";
import * as Main from "resource:///org/gnome/shell/ui/main.js";

import { Spring, SPRING_PRESETS } from "../engine/spring.js";
import { SignalTracker } from "../shared/signals.js";

/** Size used when there is no content (only visible with show-when-idle). */
const IDLE = Object.freeze({ width: 96, height: 12, radius: 6 });
const FADE_MS = 180;

export const Island = GObject.registerClass(
  class NexslandIsland extends St.Widget {
    /**
     * @param {{ engine: import("../engine/engine.js").IslandEngine, settings: import("@girs/gio-2.0").default.Settings }} params
     */
    constructor({ engine, settings }) {
      super({
        style_class: "nexsland-island",
        reactive: true,
        track_hover: true,
        clip_to_allocation: true,
        layout_manager: new Clutter.BinLayout(),
        opacity: 0,
        visible: false,
      });
      this._engine = engine;
      this._settings = settings;
      this._signals = new SignalTracker();
      this._overviewHidden = false;
      this._wantVisible = false;
      this._lastRadius = -1;
      this._lastFrameUs = 0;

      this._bin = new St.Bin({
        x_expand: true,
        y_expand: true,
        x_align: Clutter.ActorAlign.FILL,
        y_align: Clutter.ActorAlign.FILL,
      });
      this.add_child(this._bin);

      const preset = this._preset();
      this._width = new Spring(IDLE.width, preset);
      this._height = new Spring(IDLE.height, preset);
      this._radius = new Spring(IDLE.radius, preset);

      this._timeline = new Clutter.Timeline({ actor: this, duration: 1000, repeat_count: -1 });
      this._frameId = this._timeline.connect("new-frame", () => this._onFrame());

      this.connect("button-release-event", (_actor, event) => this._onClick(event));

      Main.layoutManager.addTopChrome(this, { affectsInputRegion: true });
      this._signals.track(Main.layoutManager, "monitors-changed", () => this._reposition());
      // Fullscreen is tracked here rather than with addTopChrome's trackFullscreen,
      // which toggles `visible` itself and would fight _updateVisibility().
      this._signals.track(global.display, "in-fullscreen-changed", () => this._updateVisibility());
      this._signals.track(Main.overview, "showing", () => this._setOverviewHidden(true));
      this._signals.track(Main.overview, "hidden", () => this._setOverviewHidden(false));
      this._signals.track(settings, "changed::vertical-offset", () => this._reposition());
      this._signals.track(settings, "changed::show-when-idle", () =>
        this._render(this._engine.state),
      );
      this._signals.track(settings, "changed::animation-style", () => {
        const p = this._preset();
        for (const s of [this._width, this._height, this._radius]) s.params = p;
      });

      this._unsubscribe = engine.subscribe((state) => this._render(state));
      this._applyGeometry();
      this._render(engine.state);
    }

    /** Explicit teardown; called from the extension's disable(). */
    teardown() {
      this._unsubscribe?.();
      this._unsubscribe = null;
      this._signals.disconnectAll();
      if (this._timeline) {
        this._timeline.stop();
        this._timeline.disconnect(this._frameId);
        this._timeline = null;
      }
      this.remove_all_transitions();
      Main.layoutManager.removeChrome(this);
      this.destroy();
    }

    _preset() {
      return SPRING_PRESETS[this._settings.get_string("animation-style")] ?? SPRING_PRESETS.bouncy;
    }

    _render(state) {
      const content = state.content;
      const pres = content ? (state.expanded ? content.expanded : content.compact) : null;
      const target = pres ?? IDLE;

      const old = this._bin.get_child();
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

      this._width.target = target.width;
      this._height.target = target.height;
      this._radius.target = target.radius ?? target.height / 2;

      if (!St.Settings.get().enable_animations) {
        this._width.snap(target.width);
        this._height.snap(target.height);
        this._radius.snap(this._radius.target);
        this._applyGeometry();
      } else if (!this._timeline.is_playing()) {
        this._lastFrameUs = 0;
        this._timeline.start();
      }

      this._wantVisible = !!content || this._settings.get_boolean("show-when-idle");
      this._updateVisibility();
    }

    _onFrame() {
      const now = GLib.get_monotonic_time();
      const dt = this._lastFrameUs ? (now - this._lastFrameUs) / 1e6 : 1 / 60;
      this._lastFrameUs = now;
      const settled = [this._width, this._height, this._radius]
        .map((s) => s.step(dt))
        .every(Boolean);
      this._applyGeometry();
      if (settled) {
        this._timeline.stop();
        this._lastFrameUs = 0;
      }
    }

    _applyGeometry() {
      const width = Math.max(1, Math.round(this._width.value));
      const height = Math.max(1, Math.round(this._height.value));
      this.set_size(width, height);
      const radius = Math.round(Math.max(0, Math.min(this._radius.value, height / 2)));
      if (radius !== this._lastRadius) {
        this._lastRadius = radius;
        this.set_style(`border-radius: ${radius}px;`);
      }
      this._reposition();
    }

    _reposition() {
      const monitor = Main.layoutManager.primaryMonitor;
      if (!monitor) return;
      const panelHeight = Main.layoutManager.panelBox?.height ?? 0;
      const x = monitor.x + Math.round((monitor.width - this.width) / 2);
      const y = monitor.y + panelHeight + this._settings.get_int("vertical-offset");
      this.set_position(x, y);
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

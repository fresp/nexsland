/* extension.js
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 2 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 * author: neuromorph
 */

/* exported Openbar */

import St from "gi://St";
import Gio from "gi://Gio";
import Meta from "gi://Meta";
import GLib from "gi://GLib";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import * as PanelMenu from "resource:///org/gnome/shell/ui/panelMenu.js";
import * as LayoutManager from "resource:///org/gnome/shell/ui/layout.js";
import * as Config from "resource:///org/gnome/shell/misc/config.js";
import * as StyleSheets from "./stylesheets.js";

// Nexsland: Open Bar's wallpaper auto-themes (autothemes.js, quantize.js), menu,
// notification, dash and Fitts-widget features are not carried over. Only the top
// bar and its buttons are styled.

// Colour keys that have a value per light/dark mode: [current, dark, light].
// Nexsland: spelled out so every key read is a literal (see bar-schema-keys.test.js).
const MODE_COLOR_KEYS = [
  ["bgcolor", "dark-bgcolor", "light-bgcolor"],
  ["iscolor", "dark-iscolor", "light-iscolor"],
  ["shcolor", "dark-shcolor", "light-shcolor"],
  ["bcolor", "dark-bcolor", "light-bcolor"],
  ["bgcolor-wmax", "dark-bgcolor-wmax", "light-bgcolor-wmax"],
  ["fgcolor", "dark-fgcolor", "light-fgcolor"],
  ["hcolor", "dark-hcolor", "light-hcolor"],
];

// Settings that only change the generated stylesheet: nothing else to update.
const STYLE_KEYS = [
  "reloadstyle",
  "bgcolor",
  "bgalpha",
  "fgcolor",
  "fgalpha",
  "bcolor",
  "balpha",
  "bradius",
  "shcolor",
  "shalpha",
  "iscolor",
  "isalpha",
  "neon",
  "shadow",
  "hcolor",
  "halpha",
  "heffect",
  "bgcolor-wmax",
  "bgalpha-wmax",
  "neon-wmax",
];

// ConnectManager class to manage connections for events to trigger Openbar style updates
// This class is modified from Floating Panel extension (Thanks Aylur!)
class ConnectManager {
  constructor(list = []) {
    this.connections = [];

    list.forEach((c) => {
      let [obj, signal, callback, callback_param] = c;
      this.connect(obj, signal, callback, callback_param);
    });
  }

  connect(obj, signal, callback, callback_param) {
    const id = obj.connect(signal, (object, signal_param) => {
      callback(object, signal, signal_param, callback_param);
    });
    // Remove obj on destroy except following that don't have destroy signal.
    // Nexsland: keep the destroy handler's id too. Upstream never disconnected
    // it, so every enable left another handler on shell actors (panel boxes,
    // window group). Also '||' where upstream had a bitwise '|'.
    let destroyId = 0;
    if (!(
      obj instanceof Gio.Settings ||
      obj instanceof LayoutManager.LayoutManager ||
      obj instanceof Meta.WorkspaceManager ||
      obj instanceof Meta.Display
    )) {
      destroyId = obj.connect("destroy", () => {
        this.removeObject(obj);
      });
    }
    this.connections.push({ id, obj, sig: signal, destroyId });
  }

  // remove an object WITHOUT disconnecting it, use only when you know the object is destroyed
  removeObject(object) {
    this.connections = this.connections.filter(({ obj }) => obj != object);
  }

  disconnect(object, signal) {
    let disconnections = this.connections.filter(
      ({ id, obj, sig }) => obj == object && sig == signal,
    );
    disconnections.forEach((c) => {
      c.obj.disconnect(c.id);
      if (c.destroyId) c.obj.disconnect(c.destroyId);
    });
    this.connections = this.connections.filter(({ obj, sig }) => obj != object || sig != signal);
  }

  disconnectAll() {
    this.connections.forEach((c) => {
      if (c.obj && c.id > 0) c.obj.disconnect(c.id);
      if (c.obj && c.destroyId) c.obj.disconnect(c.destroyId);
    });
    this.connections = [];
  }
}

// Openbar Extension main class
// Nexsland: Open Bar's extension class, turned into a module that Nexsland's own
// extension enables and disables. It receives its settings (the
// org.gnome.shell.extensions.nexsland.bar child schema) instead of inheriting
// them from Extension.
export class OpenBar {
  constructor({ settings, path }) {
    this._barSettings = settings;
    this.path = path;
    this._settings = null;
    this._intSettings = null;
    this._connections = null;
  }

  getSettings() {
    return this._barSettings;
  }

  unloadStylesheet() {
    const theme = this.themeContext.get_theme();
    const stylesheet = this.obarRunDir.get_child("stylesheet.css");
    try {
      theme.unload_stylesheet(stylesheet);
    } catch (e) {
      console.log("Openbar: Error unloading stylesheet: ", e);
    }
  }

  loadStylesheet() {
    const theme = this.themeContext.get_theme();
    const stylesheet = this.obarRunDir.get_child("stylesheet.css");
    try {
      theme.load_stylesheet(stylesheet);
    } catch (e) {
      console.log("Openbar: Error loading stylesheet: ", e);
    }
  }

  reloadStylesheet() {
    // Unload stylesheet
    this.unloadStylesheet();

    // Load stylesheet
    this.loadStylesheet();
  }

  // Add OpenBar style classes to Panel and Panel-Buttons
  // Nexsland: no candybar classes.
  setPanelStyle(obj, key, sig_param, callbk_param) {
    // console.log('setPanelStyle: ', String(obj), key, String(sig_param), callbk_param);
    const panel = Main.panel;
    const bartype = this._settings.get_string("bartype");
    // Add/remove trialnds class as per bartype
    if (bartype == "Trilands") panel.add_style_class_name("trilands");
    else panel.remove_style_class_name("trilands");

    let idx, isFirst, firstIdx, lastIdx;
    for (const box of this.panelBoxes) {
      isFirst = true;
      idx = 0;
      firstIdx = 0;
      lastIdx = 0;
      for (const btn of box) {
        // Screen recording/share indicators use ButtonBox instead of Button
        if (btn.child instanceof PanelMenu.Button || btn.child instanceof PanelMenu.ButtonBox) {
          if (btn.child.visible) {
            if (isFirst) {
              firstIdx = idx;
              isFirst = false;
            }
            lastIdx = idx;
            // console.log('Visible Child: ', String(btn.child));
            btn.add_style_class_name("button-container");

            if (btn.child.constructor.name === "DateMenuButton") {
              // Remove padding widget to get rid of empty space on left when Message/DND indicator is on right
              if (!this.dateMenuLeftPadWidget) {
                this.dateMenuBtnBox = btn.child.get_first_child();
                this.dateMenuLeftPadWidget = this.dateMenuBtnBox.get_first_child();
                this.dateMenuBtnBox.remove_child(this.dateMenuLeftPadWidget);
              }
            }
          }
        }

        idx++;
      }

      // Move the first and last visible buttons to the ends of the box in trilands mode
      let btns = box.get_children();
      if (bartype == "Trilands") {
        for (let k = 0; k < btns.length; k++) {
          if (
            btns[k].child instanceof PanelMenu.Button ||
            btns[k].child instanceof PanelMenu.ButtonBox
          ) {
            if (k == firstIdx && k != lastIdx) box.set_child_at_index(btns[k], 0);
            else if (k == lastIdx && k != firstIdx)
              box.set_child_at_index(btns[k], btns.length - 1);
          }
        }
      }
    }
  }

  // Update panel style when Settings change
  updatePanelStyle(obj, key, sig_param, callbk_param) {
    // console.log('update called with ', key, sig_param, callbk_param);
    // Nexsland: timers and async reloads can land after disable().
    if (!this._settings) return;
    let panel = Main.panel;

    // Nothing to update for the stored per-mode colours
    if (key.startsWith("dark-") || key.startsWith("light-")) return;

    // Window-Max bar settings
    if (key == "wmaxbar") {
      this.onWindowMaxBar();
      return;
    }

    // Update styles on Dark/Light mode change
    if (callbk_param == "color-scheme") {
      this.onModeChange();
      return;
    }

    // Continue to update triland classes if actor (panel button) removed in trilands mode else return
    let bartype = this._settings.get_string("bartype");
    if (key == this.removedSignal && bartype != "Trilands") return;

    // Generate/Reload stylesheet
    if (key == "trigger-reload") {
      // A toggle key to trigger generation and reload of stylesheet
      StyleSheets.reloadStyle(this, this);
      return;
    }
    if (key == "reloadstyle") {
      // A toggle key to trigger reload of existing stylesheet
      this.reloadStylesheet();
    }

    // Set bgalpha on change of bartype
    if (key == "bartype") {
      if (bartype == "Trilands" || bartype == "Islands") {
        this._settings.set_double("bgalpha", 0);
      } else {
        this._settings.set_double("bgalpha", 0.9);
      }
    }

    // Overview hidden: re-check maximized windows
    // Nexsland: the bar is never styled in the Overview (set-overview removed), and
    // keeps its style in fullscreen (set-fullscreen removed, it was on).
    if (key == "hiding" && !panel.has_style_pseudo_class("overview")) {
      this.setWindowMaxBar("hiding");
    }

    // Nexsland: menu, notification, accent, font and Fitts-widget handling removed.

    if (STYLE_KEYS.includes(key)) {
      return;
    }

    // Set PanelBox position
    // Nexsland: the bar is always at the top of the monitor holding the panel.
    if (key == "monitors-changed") this.setPanelBoxPosition();

    this.setPanelStyle(null, key);
  }

  // Find the monitor which has the panel/panelBox
  getPanelMonitor() {
    let panelMonIndex = 0;
    const LM = Main.layoutManager;
    const monitors = LM.monitors;
    const panelBox = LM.panelBox;
    for (let i = 0; i < monitors.length; i++) {
      let monitor = monitors[i];
      if (
        panelBox.x >= monitor.x &&
        panelBox.x < monitor.x + monitor.width &&
        panelBox.y >= monitor.y &&
        panelBox.y < monitor.y + monitor.height
      ) {
        panelMonIndex = i;
        break;
      }
    }
    return [monitors[panelMonIndex], panelMonIndex];
  }

  // Nexsland: top position only (Open Bar's bottom bar is not carried over).
  setPanelBoxPosition() {
    let panelMonitor = this.getPanelMonitor()[0];
    let panelBox = Main.layoutManager.panelBox;
    panelBox.set_position(panelMonitor.x, panelMonitor.y);
    panelBox.set_size(panelMonitor.width, -1);
  }

  // Set panelbox position for window max
  setPanelBoxPosWindowMax(wmax, signal) {
    if (this.panelPositioned) return;
    this.setPanelBoxPosition();
    this.panelPositioned = true;
  }

  // Check for maximized window on Panel monitor
  setWindowMaxBar(obj, signal, sig2) {
    // Retain wmax status as-is in Overview (do nothing here)
    if (!this._settings || Main.panel.has_style_pseudo_class("overview")) return;

    const wmaxbar = this._settings.get_boolean("wmaxbar");
    if (!wmaxbar) {
      if (Main.panel.has_style_pseudo_class("windowmax")) {
        Main.panel.remove_style_pseudo_class("windowmax");
        this.setPanelBoxPosWindowMax(false, signal);
      }
      return;
    }

    // Find out index of the monitor which has the panel/panelBox
    let panelMonIndex = this.getPanelMonitor()[1];

    // Get valid windows maximized on the monitor with panel
    const workspace = global.workspace_manager.get_active_workspace();
    const windows = workspace.list_windows().filter(
      (window) =>
        window.get_monitor() == panelMonIndex &&
        window.showing_on_its_workspace() &&
        !window.is_hidden() &&
        window.get_window_type() !== Meta.WindowType.DESKTOP && // exclude Desktop
        window.get_gtk_application_id() !== "com.rastersoft.ding" && // exclude Desktop Icons NG
        (window.maximized_horizontally || window.maximized_vertically) &&
        !window.fullscreen,
    );
    // for(const window of windows)
    //     console.log('window:', window.get_gtk_application_id());

    if (windows.length) {
      Main.panel.add_style_pseudo_class("windowmax");
      this.setPanelBoxPosWindowMax(true, signal);
    } else {
      Main.panel.remove_style_pseudo_class("windowmax");
      this.setPanelBoxPosWindowMax(false, signal);
    }
  }

  onWindowAdded(obj, signal, windowActor) {
    if (windowActor) {
      this._windowSignals.set(windowActor, [
        windowActor.connect("notify::visible", () => this.setWindowMaxBar("notify-visible")),
      ]);

      if (windowActor.meta_window) {
        this._windowSignals.set(windowActor.meta_window, [
          windowActor.meta_window.connect("notify::minimized", () =>
            this.setWindowMaxBar("minimized"),
          ),
          windowActor.meta_window.connect("size-changed", () =>
            this.setWindowMaxBar("size-changed"),
          ),
          windowActor.meta_window.connect("shown", () => this.setWindowMaxBar("shown")),
        ]);
      }
    }
    this.setWindowMaxBar(this.addedSignal);
  }

  onWindowRemoved(obj, signal, windowActor) {
    let winSigActors = [windowActor, windowActor.meta_window];
    for (const winSigActor of winSigActors) {
      if (winSigActor) {
        let windowSignals = this._windowSignals.get(winSigActor);
        if (windowSignals) {
          for (const id of windowSignals) {
            winSigActor.disconnect(id);
          }
          this._windowSignals.delete(winSigActor);
        }
      }
    }
    this.setWindowMaxBar(this.removedSignal);
  }

  // Connect/disconnect window signals based on Window-Max bar On/Off
  onWindowMaxBar() {
    let wmaxbar = this._settings.get_boolean("wmaxbar");
    if (wmaxbar) {
      this._windowSignals = new Map();
      const windowActors =
        this.gnomeVersion < 48 ? global.get_window_actors() : global.compositor.get_window_actors();
      for (const window of windowActors) {
        this.onWindowAdded(null, "enabled", window);
      }
      this._connections?.connect(
        global.window_group,
        this.addedSignal,
        this.onWindowAdded.bind(this),
      );
      this._connections?.connect(
        global.window_group,
        this.removedSignal,
        this.onWindowRemoved.bind(this),
      );
    } else {
      this._connections.disconnect(global.window_group, this.addedSignal);
      this._connections.disconnect(global.window_group, this.removedSignal);
      this.disconnectWindowSignals();
      Main.panel.remove_style_pseudo_class("windowmax");
      this.setPanelBoxPosWindowMax(false);
    }
  }

  disconnectWindowSignals() {
    if (this._windowSignals) {
      for (const [windowActor, ids] of this._windowSignals) {
        for (const id of ids) {
          // console.log('disconnectWindowSignals - id: ', id);
          if (windowActor && id > 0) windowActor.disconnect(id);
        }
      }
    }
    this._windowSignals = null;
  }

  // Copy the colours stored for the current Dark/Light mode to the current keys
  // Nexsland: Open Bar's AutoThemes.onModeChange, limited to the bar's colours.
  onModeChange() {
    // Pause stylesheet reloading while the colours are updated, to prevent multiple reloads
    this._settings.set_boolean("pause-reload", true);

    const currentMode = this._intSettings.get_string("color-scheme");
    this._settings.set_string("color-scheme", currentMode); // Save mode for preferences
    const dark = currentMode == "prefer-dark";
    for (const [key, darkKey, lightKey] of MODE_COLOR_KEYS)
      this._settings.set_strv(key, this._settings.get_strv(dark ? darkKey : lightKey));

    // Disable pause-reload and trigger style reload
    this._settings.set_boolean("pause-reload", false);
    const triggerReload = this._settings.get_boolean("trigger-reload");
    this._settings.set_boolean("trigger-reload", !triggerReload);
  }

  postStartup() {
    this.postStartupId = setTimeout(() => {
      this.setPanelStyle(null, "post-startup");
      this.postStartupId = null;
    }, 2000);
  }

  enable() {
    // Get Gnome version
    const [major, _minor] = Config.PACKAGE_VERSION.split(".").map((s) => Number(s));
    this.gnomeVersion = major;

    // Get the top panel
    let panel = Main.panel;
    this.panelBoxes = [panel._leftBox, panel._centerBox, panel._rightBox];

    this.main = Main;
    this.panelPositioned = false;
    this.addedSignal = this.gnomeVersion > 45 ? "child-added" : "actor-added";
    this.removedSignal = this.gnomeVersion > 45 ? "child-removed" : "actor-removed";
    this.postStartupId = null;

    // Light/Dark mode
    this._intSettings = new Gio.Settings({ schema_id: "org.gnome.desktop.interface" });
    this.colorScheme = this._intSettings.get_string("color-scheme");

    // Get global theme context (for display scaling)
    this.themeContext = St.ThemeContext.get_for_stage(global.stage);

    this._settings = this.getSettings();
    this._settings.set_boolean("pause-reload", false);

    // Connect to the settings changes
    // Nexsland: keep the id so disable() can drop it; the module can be enabled
    // and disabled repeatedly in one session through enable-bar.
    this._settingsChangedId = this._settings.connect("changed", (settings, key) => {
      this.updatePanelStyle(settings, key);
    });

    let connections = [
      [Main.overview, "hiding", this.updatePanelStyle.bind(this)],
      [Main.overview, "showing", this.updatePanelStyle.bind(this)],
      [Main.layoutManager, "monitors-changed", this.updatePanelStyle.bind(this)],
      [
        global.display,
        "window-entered-monitor",
        this.setWindowMaxBar.bind(this),
        "window-entered-monitor",
      ],
      [
        global.display,
        "window-left-monitor",
        this.setWindowMaxBar.bind(this),
        "window-left-monitor",
      ],
      [Main.layoutManager, "startup-complete", this.postStartup.bind(this)],
      // Nexsland: connected here once; upstream connected it along with the
      // wallpaper signals, again on every monitor change.
      [
        this._intSettings,
        "changed::color-scheme",
        this.updatePanelStyle.bind(this),
        "color-scheme",
      ],
    ];
    // Connections for actor-added/removed OR child-added/removed as per Gnome version
    for (const panelBox of this.panelBoxes) {
      connections.push([panelBox, this.addedSignal, this.updatePanelStyle.bind(this)]);
      connections.push([panelBox, this.removedSignal, this.updatePanelStyle.bind(this)]);
    }
    // Connections for panel buttons notify::visible
    for (const box of this.panelBoxes) {
      for (const btn of box) {
        if (btn.child instanceof PanelMenu.Button || btn.child instanceof PanelMenu.ButtonBox) {
          if (
            btn.child.constructor.name === "ATIndicator" ||
            btn.child.constructor.name === "InputSourceIndicator" ||
            btn.child.constructor.name === "DwellClickIndicator"
          ) {
            connections.push([btn.child, "notify::visible", this.setPanelStyle.bind(this)]);
          }
        }
      }
    }
    // Connection specific to Workspace indicator dots
    if (this.gnomeVersion > 44) {
      connections.push([
        global.workspace_manager,
        "notify::n-workspaces",
        this.updatePanelStyle.bind(this),
      ]);
    }

    // Setup all connections
    // Nexsland: at shell shutdown the panel is destroyed while these handlers
    // are still connected, and a box losing its children restyled boxes that
    // were already disposed. Upstream never handled it.
    connections.push([Main.panel, "destroy", () => this._connections?.disconnectAll()]);
    this._connections = new ConnectManager(connections);

    // If mode was changed (by script/extension) while OpenBar was disabled (screen-lock),
    // detect mode-change and update styles
    let obarScheme = this._settings.get_string("color-scheme");
    if (obarScheme != this.colorScheme) this.onModeChange();

    // OpenBar runtime directory
    // Nexsland: no SVG assets to copy (they were only used by menu styles).
    const userRunDir = GLib.get_user_runtime_dir();
    this.obarRunDir = Gio.File.new_for_path(`${userRunDir}/nexsland/bar`);
    // Create dir if missing
    if (!this.obarRunDir.query_exists(null)) {
      try {
        this.obarRunDir.make_directory_with_parents(null);
      } catch (e) {
        console.error("Error creating OpenBar runtime directory: " + e);
      }
    }

    // Add 'openbar' class to top panel and panelBox
    panel.add_style_class_name("openbar");
    Main.layoutManager.panelBox.add_style_class_name("openbar");
    // Cause stylesheet to save and reload on Enable
    StyleSheets.reloadStyle(this, this);

    // Apply the initial style
    this.updatePanelStyle(null, "enabled");
    // Refresh to fix any indicators added during initial styling
    this.enableStyleTimeoutId = setTimeout(() => {
      this.updatePanelStyle(null, "enabled");
      this.enableStyleTimeoutId = null;
    }, 1000);

    // Set initial Window Max Bar
    this.onWindowMaxBar();
  }

  disable() {
    // Get the top panel
    let panel = Main.panel;

    this._connections?.disconnectAll();
    this._connections = null;
    if (this._settingsChangedId) {
      this._settings?.disconnect(this._settingsChangedId);
      this._settingsChangedId = 0;
    }

    this.disconnectWindowSignals();

    if (this.postStartupId > 0) {
      clearTimeout(this.postStartupId);
      this.postStartupId = null;
    }
    if (this.enableStyleTimeoutId > 0) {
      clearTimeout(this.enableStyleTimeoutId);
      this.enableStyleTimeoutId = null;
    }

    // Remove style class from Panel and PanelBox
    Main.layoutManager.panelBox.remove_style_class_name("openbar");
    panel.remove_style_class_name("openbar");
    panel.remove_style_class_name("trilands");
    // Nexsland: also drop the window-maximized state, upstream left it set.
    panel.remove_style_pseudo_class("windowmax");
    // Reset left padding widget into DateMenu button
    if (this.dateMenuLeftPadWidget) {
      this.dateMenuBtnBox.insert_child_at_index(this.dateMenuLeftPadWidget, 0);
      this.dateMenuLeftPadWidget = null;
    }

    // Unload stylesheet
    this.unloadStylesheet();

    // Reset panel position to Top
    this.setPanelBoxPosition();

    this.main = null;
    this._settings = null;
    this._intSettings = null;
  }
}

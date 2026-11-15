/*
 * This file is part of the Nexsland GNOME extension.
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The open island: a row of tab buttons over the selected tab's content, in the
 * spirit of Atoll's open notch. Tabs are plain objects:
 *
 *   { id, icon, title, build(): Clutter.Actor, hidden?(): void }
 *
 * build() runs each time the tab is selected; hidden() runs when another tab is
 * selected or the panel closes, so tabs can stop polling.
 */

import Clutter from "gi://Clutter";
import St from "gi://St";
import { vbox } from "../shared/compat.js";

/** Open-island geometry (body size, bottom radius, ear radius). */
export const PANEL_SIZE = Object.freeze({ width: 460, height: 172, radius: 24, ear: 14 });

export class Panel {
  /** @param {{ tabs: object[], selected?: string | null }} params */
  constructor({ tabs, selected = null }) {
    this.actor = vbox({
      style_class: "nexsland-panel",
      x_expand: true,
      y_expand: true,
    });
    const header = new St.BoxLayout({ style_class: "nexsland-panel-header" });
    this._buttons = new St.BoxLayout({ style_class: "nexsland-tabs" });
    this._title = new St.Label({
      style_class: "nexsland-panel-title",
      x_expand: true,
      x_align: Clutter.ActorAlign.END,
      y_align: Clutter.ActorAlign.CENTER,
    });
    header.add_child(this._buttons);
    header.add_child(this._title);
    this._content = new St.Bin({
      style_class: "nexsland-tab-content",
      x_expand: true,
      y_expand: true,
      x_align: Clutter.ActorAlign.FILL,
      y_align: Clutter.ActorAlign.FILL,
    });
    this.actor.add_child(header);
    this.actor.add_child(this._content);

    this._tabs = [];
    /** @type {Map<string, any>} */
    this._buttonById = new Map();
    this._current = null;
    this.setTabs(tabs, selected);
  }

  get selectedId() {
    return this._current?.id ?? null;
  }

  /** Replace the tab list, keeping the selection when that tab still exists. */
  setTabs(tabs, selected = this.selectedId) {
    this._buttons.destroy_all_children();
    this._buttonById.clear();
    this._tabs = tabs;
    for (const tab of tabs) {
      const button = new St.Button({
        style_class: "nexsland-tab",
        can_focus: true,
        accessible_name: tab.title,
        child: new St.Icon({ icon_name: tab.icon, icon_size: 14 }),
      });
      // eslint-disable-next-line local/no-untracked-connect -- actor-lifetime-bound: freed with the button
      button.connect("clicked", () => this.select(tab.id));
      this._buttons.add_child(button);
      this._buttonById.set(tab.id, button);
    }
    const keep = tabs.find((t) => t.id === selected) ?? tabs[0];
    if (keep) this.select(keep.id, true);
  }

  /** Show tab `id`; `force` rebuilds it even when already selected. */
  select(id, force = false) {
    const tab = this._tabs.find((t) => t.id === id);
    if (!tab || (!force && tab === this._current)) return;
    if (this._current && this._current !== tab) this._current.hidden?.();
    this._current = tab;
    for (const [tabId, button] of this._buttonById) {
      if (tabId === id) button.add_style_pseudo_class("checked");
      else button.remove_style_pseudo_class("checked");
    }
    this._title.text = tab.title;
    const old = this._content.get_child();
    this._content.set_child(tab.build());
    old?.destroy();
  }

  /** Move `delta` tabs left (negative) or right, wrapping around. */
  step(delta) {
    const n = this._tabs.length;
    if (n < 2) return;
    const i = Math.max(0, this._tabs.indexOf(this._current));
    this.select(this._tabs[(((i + delta) % n) + n) % n].id);
  }

  /** Rebuild tab `id` if it is the one showing. */
  refresh(id) {
    if (this._current?.id === id) this.select(id, true);
  }

  /** Stop the current tab; the actor itself is destroyed by its parent. */
  release() {
    this._current?.hidden?.();
    this._current = null;
  }
}

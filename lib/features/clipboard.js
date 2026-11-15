/*
 * This file is part of the Nexsland GNOME extension.
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Clipboard history tab (opt-in, off by default). Text copies are kept in memory
 * only, never written to disk, and copies flagged by password managers are
 * skipped. Clicking an entry copies it again.
 */

import Clutter from "gi://Clutter";
import Meta from "gi://Meta";
import Pango from "gi://Pango";
import St from "gi://St";
import { gettext as _ } from "resource:///org/gnome/shell/extensions/extension.js";

import { ClipboardHistory, isSensitive, preview } from "./clipboard-model.js";

const TEXT_MIMETYPES = ["text/plain", "text/plain;charset=utf-8", "UTF8_STRING", "STRING"];

export class ClipboardFeature {
  constructor() {
    this._history = new ClipboardHistory();
    this._list = null;
    this._destroyed = false;
    this._selection = global.display.get_selection();
    this._ownerId = this._selection.connect("owner-changed", (sel, type) =>
      this._onOwnerChanged(sel, type),
    );
    this.tab = {
      id: "clipboard",
      icon: "edit-paste-symbolic",
      title: _("Clipboard"),
      build: () => this._build(),
      hidden: () => {
        this._list = null;
      },
    };
  }

  destroy() {
    this._destroyed = true;
    this._selection.disconnect(this._ownerId);
    this._selection = null;
    this._history.clear();
    this._list = null;
  }

  _onOwnerChanged(selection, type) {
    if (type !== Meta.SelectionType.SELECTION_CLIPBOARD) return;
    const mimetypes = selection.get_mimetypes(type);
    if (isSensitive(mimetypes)) return;
    if (!mimetypes.some((m) => TEXT_MIMETYPES.includes(m))) return;
    St.Clipboard.get_default().get_text(St.ClipboardType.CLIPBOARD, (_clipboard, text) => {
      if (this._destroyed) return;
      if (this._history.push(text)) this._populate();
    });
  }

  _build() {
    const root = new St.BoxLayout({
      vertical: true,
      style_class: "nexsland-clipboard",
      x_expand: true,
    });
    const header = new St.BoxLayout({ style_class: "nexsland-clipboard-header" });
    header.add_child(
      new St.Label({
        text: _("Recent copies, kept in memory only"),
        style_class: "nexsland-clipboard-note",
        x_expand: true,
        y_align: Clutter.ActorAlign.CENTER,
      }),
    );
    const clear = new St.Button({
      label: _("Clear"),
      style_class: "nexsland-pill-button",
      can_focus: true,
    });
    // eslint-disable-next-line local/no-untracked-connect -- actor-lifetime-bound: freed with the button
    clear.connect("clicked", () => {
      this._history.clear();
      this._populate();
      return Clutter.EVENT_STOP;
    });
    header.add_child(clear);
    root.add_child(header);

    const scroll = new St.ScrollView({
      style_class: "nexsland-clipboard-scroll",
      x_expand: true,
      y_expand: true,
      hscrollbar_policy: St.PolicyType.NEVER,
      vscrollbar_policy: St.PolicyType.AUTOMATIC,
    });
    this._list = new St.BoxLayout({
      vertical: true,
      style_class: "nexsland-clipboard-list",
      x_expand: true,
    });
    // GNOME 46 replaced add_actor() with set_child() on St.ScrollView.
    if (scroll.set_child) scroll.set_child(this._list);
    else scroll.add_actor(this._list);
    root.add_child(scroll);
    this._populate();
    return root;
  }

  _populate() {
    const list = this._list;
    if (!list) return;
    list.destroy_all_children();
    if (this._history.items.length === 0) {
      list.add_child(
        new St.Label({ text: _("Nothing copied yet"), style_class: "nexsland-clipboard-empty" }),
      );
      return;
    }
    for (const text of this._history.items) {
      const label = new St.Label({ text: preview(text), x_align: Clutter.ActorAlign.START });
      label.clutter_text.ellipsize = Pango.EllipsizeMode.END;
      const item = new St.Button({
        style_class: "nexsland-clipboard-item",
        can_focus: true,
        x_expand: true,
        child: label,
      });
      // eslint-disable-next-line local/no-untracked-connect -- actor-lifetime-bound: freed with the button
      item.connect("clicked", () => {
        St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, text);
        return Clutter.EVENT_STOP;
      });
      list.add_child(item);
    }
  }
}

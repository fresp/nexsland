/*
 * This file is part of the Nexsland GNOME extension.
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The Today list's file in Preferences: where it is, and export and import. An
 * import is written to the same file the shell watches, so a running Today tab
 * picks it up.
 */

import Adw from "gi://Adw";
import Gio from "gi://Gio";
import GLib from "gi://GLib";
import Gtk from "gi://Gtk";

import {
  gettext as _,
  ngettext,
} from "resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js";

import { TodayList, parseTaskRows } from "../features/today-model.js";
import { readText, todosDir, todosFile, writeText } from "../features/today-store.js";

const IMPORT_MODES = ["merge", "replace"];

function jsonFilter() {
  const filter = new Gtk.FileFilter({ name: _("Task lists (JSON)") });
  filter.add_mime_type("application/json");
  filter.add_suffix("json");
  const filters = new Gio.ListStore({ item_type: Gtk.FileFilter });
  filters.append(filter);
  return filters;
}

function suffixButton(label, onClick, suggested = false) {
  const button = new Gtk.Button({ label, valign: Gtk.Align.CENTER });
  if (suggested) button.add_css_class("suggested-action");
  button.connect("clicked", onClick);
  return button;
}

/**
 * Rows for the Today group: the file's location, Export… and Import….
 * @param {Adw.PreferencesWindow} window parent of the dialogs, and where toasts go
 * @returns {Gtk.Widget[]}
 */
export function todoFileRows(window) {
  const toast = (title) => window.add_toast(new Adw.Toast({ title, timeout: 4 }));

  const location = new Adw.ActionRow({
    title: _("Stored in"),
    subtitle: todosFile().get_path(),
    subtitle_selectable: true,
  });
  location.add_suffix(
    suffixButton(_("Open Folder"), () => {
      try {
        const dir = todosDir();
        if (!dir.query_exists(null)) dir.make_directory_with_parents(null);
        Gio.AppInfo.launch_default_for_uri(dir.get_uri(), null);
      } catch (e) {
        toast(_("Could not open the folder: %s").format(e.message));
      }
    }),
  );

  const exportRow = new Adw.ActionRow({
    title: _("Export"),
    subtitle: _("Save every task, past and planned, to a file you choose"),
  });
  exportRow.add_suffix(
    suffixButton(_("Export…"), () => {
      const dialog = new Gtk.FileDialog({
        title: _("Export Tasks"),
        filters: jsonFilter(),
        initial_name: `nexsland-todos-${GLib.DateTime.new_now_local().format("%F")}.json`,
      });
      dialog.save(window, null, (_dialog, result) => {
        let file;
        try {
          file = dialog.save_finish(result);
        } catch {
          return; // cancelled
        }
        try {
          const list = new TodayList(readText() ?? "[]");
          writeText(list.serialize(), file);
          toast(ngettext("Exported %d task", "Exported %d tasks", list.size).format(list.size));
        } catch (e) {
          toast(_("Could not export: %s").format(e.message));
        }
      });
    }),
  );

  const mode = new Gtk.DropDown({
    model: Gtk.StringList.new([_("Merge with my tasks"), _("Replace my tasks")]),
    valign: Gtk.Align.CENTER,
  });
  const importRow = new Adw.ActionRow({
    title: _("Import"),
    subtitle: _("Read tasks from an exported file"),
  });
  importRow.add_suffix(mode);
  importRow.add_suffix(
    suffixButton(
      _("Import…"),
      () => {
        const dialog = new Gtk.FileDialog({ title: _("Import Tasks"), filters: jsonFilter() });
        dialog.open(window, null, (_dialog, result) => {
          let file;
          try {
            file = dialog.open_finish(result);
          } catch {
            return; // cancelled
          }
          try {
            const text = readText(file) ?? "";
            if (parseTaskRows(text) === null) {
              toast(_("This file is not a task list exported from Nexsland"));
              return;
            }
            const imported = new TodayList(text);
            if (IMPORT_MODES[mode.selected] === "replace") {
              writeText(imported.serialize());
              toast(
                ngettext("Replaced with %d task", "Replaced with %d tasks", imported.size).format(
                  imported.size,
                ),
              );
            } else {
              const mine = new TodayList(readText() ?? "[]");
              const added = mine.merge(imported);
              writeText(mine.serialize());
              toast(ngettext("Added %d task", "Added %d tasks", added).format(added));
            }
          } catch (e) {
            toast(_("Could not import: %s").format(e.message));
          }
        });
      },
      true,
    ),
  );

  return [location, exportRow, importRow];
}

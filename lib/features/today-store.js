/*
 * This file is part of the Nexsland GNOME extension.
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Where the Today list lives: a JSON file in the user's data directory
 * (~/.local/share/nexsland/todos.json), written whole and atomically. The shell
 * (Today and Calendar tabs) and the preferences window (export and import) both
 * use it, so each watches it for the others' writes. Gio and GLib only: no shell
 * imports, so prefs.js can load it too.
 */

import Gio from "gi://Gio";
import GLib from "gi://GLib";

const decoder = new TextDecoder();
const encoder = new TextEncoder();

export function todosDir() {
  return Gio.File.new_for_path(GLib.build_filenamev([GLib.get_user_data_dir(), "nexsland"]));
}

export function todosFile() {
  return todosDir().get_child("todos.json");
}

/** Contents of `file`, or null when it does not exist. Other errors are thrown. */
export function readText(file = todosFile()) {
  try {
    const [, bytes] = file.load_contents(null);
    return decoder.decode(bytes);
  } catch (e) {
    if (e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND)) return null;
    throw e;
  }
}

/** Replace `file` with `text` through a temporary file, so a crash never leaves half a list. */
export function writeText(text, file = todosFile()) {
  const parent = file.get_parent();
  if (parent && !parent.query_exists(null)) parent.make_directory_with_parents(null);
  file.replace_contents(
    encoder.encode(text),
    null,
    false,
    Gio.FileCreateFlags.REPLACE_DESTINATION,
    null,
  );
}

/**
 * Call `onChange` after the file changes on disk, once the burst of events from
 * one write has settled. The caller tracks nothing: stop() undoes everything.
 * @param {{ setTimeout: Function, clearTimeout: Function }} scheduler
 * @returns {{ stop: () => void }}
 */
export function watchTodos(scheduler, onChange) {
  const dir = todosDir();
  if (!dir.query_exists(null)) dir.make_directory_with_parents(null);
  // The directory, not the file: an atomic replace is a rename onto the file.
  const monitor = dir.monitor_directory(Gio.FileMonitorFlags.WATCH_MOVES, null);
  const name = todosFile().get_basename();
  let pending = null;
  const id = monitor.connect("changed", (_monitor, file, other) => {
    if (file?.get_basename() !== name && other?.get_basename() !== name) return;
    if (pending !== null) scheduler.clearTimeout(pending);
    pending = scheduler.setTimeout(() => {
      pending = null;
      onChange();
    }, 100);
  });
  return {
    stop() {
      if (pending !== null) scheduler.clearTimeout(pending);
      pending = null;
      monitor.disconnect(id);
      monitor.cancel();
    },
  };
}

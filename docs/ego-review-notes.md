# Notes for extensions.gnome.org review (0.2.0)

Nexsland is a status "island" at the top of the screen. These notes explain the places where it
reaches into the shell beyond public API, and why. Every one of them is undone in `disable()`.

## Lifecycle

- Nothing runs at import time: `extension.js` builds everything in `enable()` and tears it
  down in `disable()`. The Bar module (`lib/bar/`) is imported lazily, only when its setting is
  on, after `enable()`.
- Every signal on an object Nexsland does not own goes through `SignalTracker`
  (`lib/shared/signals.js`) and is disconnected in `disable()`. A custom ESLint rule
  (`eslint-rules/no-untracked-connect.cjs`) rejects untracked `connect()` calls; the few
  exceptions are signals on actors Nexsland creates, marked inline.
- GLib timers go through the extension's scheduler (`extension.js`, `_makeScheduler`), which
  removes any pending source in `disable()`. The Bar module's two timeouts are cleared in its
  own `disable()`.
- No network access, no telemetry, no bundled binaries. File access, all asynchronous except
  creating the Bar module's run directory: writing the Bar module's generated stylesheet under
  `$XDG_RUNTIME_DIR/nexsland/`; reading `/proc/stat`, `/proc/meminfo` and `/proc/net/dev` while
  the System tab is open; watching the Downloads folder for partial files (a setting, on by default); and showing
  a player's local album art file.

## Session modes

`session-modes` includes `unlock-dialog` for the opt-in "Show on lock screen" setting (off by
default): activities and HUDs (volume, battery, media) stay visible while locked. The panel
never opens on the lock screen (`lib/extension/island.js`, `_render` collapses it), so no
interactive UI, clipboard or notification content is exposed there.

## Clipboard

The Clipboard panel tab is opt-in, as the description says. It keeps the last text copies in
memory only, never on disk, and skips copies that password managers flag as sensitive
(`x-kde-passwordManagerHint`, `application/x-nspasteboard-concealed-type`).

## Replacing shell UI

Each of these is a setting, on by default, and restored on disable or when turned off.

- **Volume / brightness OSD** (`lib/providers/osd.js`): `Main.osdWindowManager`'s show methods
  are wrapped with `InjectionManager`. A request the island can show becomes an island HUD;
  anything else, or any time the island is not visible, falls through to the stock OSD.
- **Notification banners** (`lib/providers/banners.js`): banners are held back with
  `MessageTray.bannerBlocked`, the switch the shell itself uses while a menu covers the banner
  area. The top bar writes that property whenever a centre menu opens or closes, which would
  bring the banners back, so while the provider runs `bannerBlocked` is shadowed on the
  `Main.messageTray` instance with `Object.defineProperty`: it keeps banners blocked and
  remembers the value the shell asked for. `destroy()` deletes the instance property and hands
  that value back through the prototype's setter. Initial state is read from the private
  `_bannerBlocked`, since the class has a setter but no getter. Notifications still go to the
  message tray as usual; the island only presents the ones GNOME would have shown as banners,
  by GNOME's own rules (urgency, Do Not Disturb, per-app policy).
- **The clock and Super+V** (`lib/extension/clock.js`): `dateMenu.menu.open/toggle` and
  `Main.panel.toggleCalendar` are wrapped with `InjectionManager` to open the island instead of
  the date menu.
- **Clock in the island** (`lib/extension/island.js`, `_syncClockLook`): while the island shows
  the time, the top bar's clock is hidden. On an Islands bar its slot is kept (`opacity` 0,
  `reactive` false) because the island sits there; otherwise its container is hidden. The
  original values are restored whenever the island is not shown, the setting is off, or on
  disable.
- **Clock pill look** (`_syncAnchorStyle`): on an Islands bar the island draws the clock pill
  itself, so the pill's own background, border and shadow are hidden with an inline style while
  the island is shown, and the previous inline style is restored afterwards.

## Private shell API

- `Main.panel.statusArea.dateMenu._eventSource` (`lib/features/calendar.js`): the Calendar tab
  reads events from the date menu's own event source rather than creating a second
  `DBusEventSource`. The calendar server keeps a single time range for all clients, so a second
  client asking for another range would make the two reload each other indefinitely.
- `Main.panel.statusArea.dateMenu._calendar` (same file): to browse months, the tab moves the
  date menu's calendar with `setDate()`, which requests that month's range itself, and moves it
  back to today when the tab is left or the extension is disabled. Requesting a range directly
  fights that calendar's own requests (see above).
- `Main.messageTray._bannerBlocked`: read once, see Notification banners.

If either `dateMenu` property is missing, the Calendar tab falls back to the date and month grid
without events; nothing throws.

## Bar module (`lib/bar/`)

Top bar styling continued from Open Bar (https://github.com/neuromorph/openbar, GPL), whose
upstream stopped at GNOME 49; credited in `NOTICE`. It is off by default. In 0.2.0 it was cut
down to styling the bar and its island buttons; it no longer themes menus, quick settings,
notifications, the dash, GTK or Flatpak apps, and does not change system settings (accent
colour, GTK or icon theme). Its stylesheet is loaded with `St.ThemeContext` and unloaded on
disable. Changes to upstream code are marked `Nexsland:`.

## Testing

`make check` runs Prettier, ESLint, unit tests for the GI-free core and a strict schema
compile; a unit test checks that every settings key the Bar module reads exists, since a
missing key aborts the shell. Shell-facing code is tested by hand on GNOME Shell 46 and 51.

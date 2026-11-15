# Changelog

## Unreleased

### Added

- **Notch in the top bar** (Island > Style): the island sits in the bar itself, from its top
  edge and as tall as the bar, showing the time in place of the bar's clock, and opens
  downwards from there. Best with a Mainland bar; on an Islands or Trilands bar it merges
  with the clock pill as before.

## 0.2.0 (2026-11-15)

### Added

- **Top bar styling (Bar module)**, continued from Open Bar, which stopped at GNOME 49:
  Mainland, Floating, Islands and Trilands bars; bar, island and text colours; border; neon
  glow; hover effect; shadow; and a solid bar while a window is maximized. Off by default
  (Look > Style the top bar).
- **The island follows the bar**: its fill, text, border, neon glow and hover colours come
  from the bar's.
- **One with the clock**: on an Islands or Trilands bar the island takes the clock pill's
  place instead of hanging below it.
- **Clock in the island** (on by default): the top bar's clock is hidden while the island is
  shown. The idle island shows the time in GNOME's own format, with the unread-notifications
  / Do Not Disturb indicator. The open panel shows the time and date in its header.
- **Text next to the clock**: a line of your own (any language or script) before the time,
  cut short past 280px, and repeated in the panel header.
- **Notifications in the island**: GNOME's banners are replaced by island HUDs, which follow
  GNOME's rules (urgency, Do Not Disturb, per-app settings). Critical notifications also show
  over the overview and fullscreen windows. A player's own "now playing" notification for the
  track already shown is not repeated.
- **Notifications tab**: the shell's notifications with Do Not Disturb, Clear, activate and
  dismiss.
- **Calendar events**: the Calendar tab lists upcoming events (from Evolution / Online
  Accounts calendars), marks days with events, browses months, lists a clicked day's events,
  and opens the calendar app from an event.
- **The clock and Super+V open the island** instead of GNOME's notifications and calendar
  menu (Clock > Super+V opens the island).

### Changed

- **Preferences** are split into five short pages (Island, Clock, Activities, Panel, Look)
  with the page switcher at the bottom. Version and debug logging are behind the About
  button.
- **Show when idle** is on by default.
- **Home tab**: with the clock in the island, an idle Home says what shows up there instead of
  repeating the time.
- **The open panel** is 8px taller (180px).

### Removed

- From Open Bar: theming of menus, quick settings, the calendar, notification popups and the
  dash; candybar button colours; Fitts widgets; colour palettes from the wallpaper; bottom bar
  position; gradients; per-side borders and per-corner radii; and settings import/export. Menus
  and quick settings use GNOME's theme. Their settings are removed (the bar has 42 instead of
  286).

### Fixed

- Enabling on GNOME 51, which rejected a chrome parameter that GNOME 46 accepted.
- Preferences failing to load with "doesn't provide an export named: '\_pgettext'".
- Errors at shell shutdown from handlers still connected to the panel and the clock.

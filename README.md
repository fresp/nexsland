<p align="center">
  <img src="docs/images/logo.svg" alt="Nexsland logo" width="96" />
</p>

<h1 align="center">Nexsland</h1>

<p align="center"><strong>A living, morphing status island for GNOME Shell.</strong></p>

Nexsland turns the top of your GNOME screen into a fluid, glanceable island for media,
system HUDs and live activities. Like a notch, it hangs from the top bar: slim while
something is happening, opening into a full panel when you hover it, with spring physics
throughout. Sibling of [NexTile](https://github.com/fresp/nexTile).

> **Status:** v0.1.0 is out; `main` is heading for 0.2.0 (see [CHANGELOG](CHANGELOG.md)).
> Tested on GNOME Shell 46; GNOME 51 testing is in progress. Not yet published on
> extensions.gnome.org.

## Features

- **Live activities** with priorities: several can be active, the most important one shows.
  Right/middle-click dismisses, and dismissed activities can be restored.
- **Temporary HUDs** that briefly preempt live activities and queue in order.
- **Notch-style shell** attached to the top bar, with concave ears and rounded bottom
  corners. A floating pill style is available in Preferences.
- **Top bar styling** (optional, continued from Open Bar): Mainland, Floating, Islands and
  Trilands bars with your colours, border, neon glow, hover effect and shadow. The island
  follows the bar's look, and on an Islands bar it takes the clock pill's place.
- **Opens into a tabbed panel** on hover, click, Super+V or scrolling down (scroll up closes,
  sideways switches tabs). Home shows the current activity.
- **Clock in the island**: the top bar's clock is hidden and the island shows the time, with
  an optional line of your own text next to it. The open panel shows time and date in its
  header.
- **Notifications in the island** instead of GNOME's banners, following GNOME's rules
  (urgency, Do Not Disturb, per-app settings); critical ones also show over the overview and
  fullscreen windows.
- **Panel tabs**: notifications, a countdown timer (a live activity while it runs), a calendar
  with your events (browse months, click a day, open the calendar app), system stats (CPU,
  memory, network) and an opt-in clipboard history kept in memory only.
- **Now Playing** from any MPRIS player: artwork on the left and live bars on the right
  while closed; large rounded artwork, track info and playback controls when open.
- **Spring-driven morphing** that keeps momentum when content changes mid-animation, with
  bouncy (default, jelly-like), smooth and snappy presets. Honors GNOME's reduced-animation
  setting.
- **Volume, microphone and brightness** in the island instead of the stock OSD, with a level
  bar that updates in place. Falls back to the stock OSD whenever the island is not visible.
- **Battery notices**: charging, unplugged, fully charged, low (20%) and critical (10%).
- **Connectivity**: Bluetooth devices connecting (with their battery level), Wi-Fi, wired and
  VPN connections coming and going, Do Not Disturb on/off.
- **Screen recording** as a live activity with elapsed time and a stop button.
- **Microphone in use**: which apps are recording, for as long as they do. Camera use is not
  covered yet.
- **Downloads**: browser downloads in progress (name and bytes so far) and when they finish,
  detected from partial files in the Downloads folder.
- **NexTile integration**: HUDs for tiling, layout and floating changes, and a Tiling tab with
  NexTile's actions. Needs External control turned on in NexTile.
- **Multi-monitor**: on the primary monitor, or following the focused window's monitor.
- **Lock screen (opt-in)**: activities and HUDs stay visible while locked; the panel never
  opens there.
- Hides in the overview and over fullscreen windows, except for critical notifications.

## Install from source

Requires `glib-compile-schemas`, `make`, `zip` and Node.js 22 for the checks.

```bash
git clone https://github.com/fresp/nexsland.git
cd nexsland
make install
```

Log out and back in (Wayland) so GNOME Shell sees the extension, then:

```bash
gnome-extensions enable nexsland@fresp.github.io
```

## Development

```bash
npm ci
make check    # prettier, eslint, unit tests, strict schema compile
make nested   # install and run a nested Wayland gnome-shell to try changes
make log      # follow Nexsland's journal output
```

Unit tests cover the GI-free core (`lib/engine`, provider models). Anything that touches St,
Clutter or D-Bus is verified in a nested shell. See [AGENTS.md](AGENTS.md) for the layout and
rules.

## Roadmap

| Phase | Scope                                                                                                                                    |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| 0     | Engine, spring morph, island surface, Now Playing (MPRIS). Validate animation cost and geometry.                                         |
| 0.1   | Volume/brightness OSD in the island, battery and charging HUDs (UPower). First EGO submission.                                           |
| 0.2   | Bluetooth, Wi-Fi and VPN events, Do Not Disturb, screen-recording and mic indicators (code done; camera deferred).                       |
| 0.3   | Expanded panel tabs: timer, calendar, system stats, opt-in clipboard history. Hover and scroll gestures (calendar events came in 0.2.0). |
| 0.4   | Lock-screen visibility, multi-monitor, downloads (heuristic), NexTile integration (code done; untested).                                 |

Since v0.1.0 the island also took over the clock and GNOME's notification banners, and gained
optional top bar styling; see the [CHANGELOG](CHANGELOG.md).

## Credits

Inspired by [Atoll](https://github.com/Ebullioscopic/Atoll) and
[DynamicNotch](https://github.com/jackson-storm/DynamicNotch) for macOS. Nexsland is an
independent reimplementation for GNOME. Top bar styling continues
[Open Bar](https://github.com/neuromorph/openbar) by neuromorph. See [NOTICE](NOTICE).

## License

[GPL-3.0-or-later](LICENSE).

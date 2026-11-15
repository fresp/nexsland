<p align="center">
  <img src="docs/images/logo.svg" alt="Nexsland logo" width="96" />
</p>

<h1 align="center">Nexsland</h1>

<p align="center"><strong>A living, morphing status island for GNOME Shell.</strong></p>

Nexsland turns the top of your GNOME screen into a fluid, glanceable island for media,
system HUDs and live activities. It stays small until something is happening, then morphs
with spring physics to show it. Sibling of [NexTile](https://github.com/fresp/nexTile).

> **Status: Phase 0 (spike).** The engine, the morphing island and Now Playing are in place.
> Expect rough edges; not yet published on extensions.gnome.org.

## Features

- **Live activities** with priorities: several can be active, the most important one shows.
  Right/middle-click dismisses, and dismissed activities can be restored.
- **Temporary HUDs** that briefly preempt live activities and queue in order.
- **Now Playing** from any MPRIS player: compact pill with title, tap to expand for artwork,
  artist and playback controls.
- **Spring-driven morphing** that keeps momentum when content changes mid-animation, with
  bouncy, smooth and snappy presets. Honors GNOME's reduced-animation setting.
- Hides in the overview and over fullscreen windows.

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

| Phase | Scope                                                                                                    |
| ----- | -------------------------------------------------------------------------------------------------------- |
| 0     | Engine, spring morph, island surface, Now Playing (MPRIS). Validate animation cost and geometry.         |
| 0.1   | Volume/brightness OSD in the island, battery and charging HUDs (UPower). First EGO submission.           |
| 0.2   | Bluetooth, Wi-Fi and VPN events, Do Not Disturb, screen-recording and camera/mic indicators.             |
| 0.3   | Expanded panel tabs: timer, calendar, system stats, opt-in clipboard history. Hover and scroll gestures. |
| 0.4   | Lock-screen widgets, multi-monitor, downloads (heuristic), NexTile integration.                          |

Open design question: whether the island takes over the clock slot in the top bar or floats
below it (current default).

## Credits

Inspired by [Atoll](https://github.com/Ebullioscopic/Atoll) and
[DynamicNotch](https://github.com/jackson-storm/DynamicNotch) for macOS. Nexsland is an
independent reimplementation for GNOME; see [NOTICE](NOTICE).

## License

[GPL-3.0-or-later](LICENSE).

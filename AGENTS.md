# AGENTS.md

Guidance for AI coding agents in this repository. `CLAUDE.md` imports this file; edit it here.

Nexsland is a GNOME Shell extension (GNOME 46 and 51) that renders a morphing
"island" at the top of the screen for media, system HUDs and live activities.

## Layout

- `lib/engine/` — GI-free core: `engine.js` decides what is shown (live activities with
  priority + dismiss/restore, queued temporary HUDs); `spring.js` drives the morph animation;
  `shape.js` is the island outline (attached notch with concave ears, or floating pill).
  Keep this directory free of `gi://` and `resource://` imports so it stays unit-testable.
- `lib/extension/island.js` — the only actor. Renders engine state; owns no business logic.
- `lib/providers/` — one module per activity source. A provider only calls
  `engine.showLive/hideLive/showTemporary`; it never touches the island. Pure logic goes in a
  sibling `*-model.js` with unit tests.
- `lib/bar/` — the Bar module: top bar styling continued from Open Bar (bar types, bar and island
  colours, border, neon, hover, shadow, maximized-window bar), vendored, adapted and cut down to
  what shapes the bar and the island; loaded lazily when `enable-bar` is on. Its settings are the
  `org.gnome.shell.extensions.nexsland.bar` child schema, edited on the Look page
  (`lib/prefs/look.js`). `tests/unit/bar-schema-keys.test.js` checks every key the code reads
  exists: reading a missing key aborts gnome-shell. Mark every change to upstream code with a
  `Nexsland:` comment. It follows the same Prettier/ESLint rules as the rest, except
  `no-useless-assignment` (upstream's dead initial stores are kept).
- `prefs.js`, `lib/prefs/` — Adw preferences: Island, Clock, Activities, Panel and Look pages.
- `extension.js` — lifecycle and provider toggles.

## Rules

- `make check` must pass (Prettier, ESLint, vitest, strict schema compile).
- Every signal on an object Nexsland does not own goes through `SignalTracker.track()`, and
  every GLib source through the extension scheduler, so `disable()` leaves nothing behind.
  This is the main extensions.gnome.org review criterion.
- No network access, no bundled binaries, no telemetry.
- Code that needs gnome-shell cannot be unit-tested here; say so in the PR and describe the
  manual test (`make nested`).
- Do not copy code or assets from Atoll or DynamicNotch (Swift/macOS; assets carry separate
  copyright). Reimplement behavior. Never use "Dynamic Island" in user-facing names.
- One concern per commit. No co-author or session trailers in commit messages.

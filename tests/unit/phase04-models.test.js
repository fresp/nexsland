import { describe, expect, it } from "vitest";

import { islandMonitor, topInset } from "../../lib/engine/placement.js";
import { DownloadTracker, partialTarget } from "../../lib/providers/downloads-model.js";
import {
  nextileEvents,
  parseNexTileState,
  statusFromErrorName,
} from "../../lib/providers/nextile-model.js";

describe("placement", () => {
  it("follows the focused window's monitor only when asked and valid", () => {
    expect(islandMonitor({ mode: "primary", primaryIndex: 0, focusIndex: 1, nMonitors: 2 })).toBe(
      0,
    );
    expect(islandMonitor({ mode: "focused", primaryIndex: 0, focusIndex: 1, nMonitors: 2 })).toBe(
      1,
    );
    expect(islandMonitor({ mode: "focused", primaryIndex: 0, focusIndex: -1, nMonitors: 2 })).toBe(
      0,
    );
    expect(islandMonitor({ mode: "focused", primaryIndex: 0, focusIndex: 5, nMonitors: 2 })).toBe(
      0,
    );
  });

  it("only insets below the top bar on the primary monitor", () => {
    expect(topInset({ monitorIndex: 0, primaryIndex: 0, panelHeight: 32 })).toBe(32);
    expect(topInset({ monitorIndex: 1, primaryIndex: 0, panelHeight: 32 })).toBe(0);
  });

  it("hangs from a floating bar's visible bottom edge, or the top when the bar is at the bottom", () => {
    expect(
      topInset({
        monitorIndex: 0,
        primaryIndex: 0,
        panelTop: 7,
        panelHeight: 39,
        monitorHeight: 1080,
      }),
    ).toBe(46);
    expect(
      topInset({
        monitorIndex: 0,
        primaryIndex: 0,
        panelTop: 1034,
        panelHeight: 39,
        monitorHeight: 1080,
      }),
    ).toBe(0);
    expect(topInset({ monitorIndex: 0, primaryIndex: 0, panelTop: NaN, panelHeight: 32 })).toBe(32);
  });
});

describe("downloads-model", () => {
  const exists = (names) => (n) => names.includes(n);

  it("recognises partial files", () => {
    expect(partialTarget("report.pdf.crdownload")).toBe("report.pdf");
    expect(partialTarget("song.mp3.part")).toBe("song.mp3");
    expect(partialTarget(".part")).toBe(null);
    expect(partialTarget("notes.txt")).toBe(null);
  });

  it("tracks a Chromium download through its renames", () => {
    const t = new DownloadTracker();
    expect(t.created("Unconfirmed 1234.crdownload")).toEqual({
      kind: "started",
      name: "Unconfirmed 1234",
    });
    expect(t.renamed("Unconfirmed 1234.crdownload", "report.pdf.crdownload")).toBe(null);
    t.setSize("report.pdf.crdownload", 2048);
    expect(t.summary()).toEqual({ count: 1, name: "report.pdf", bytes: 2048 });
    expect(t.renamed("report.pdf.crdownload", "report.pdf")).toEqual({
      kind: "completed",
      name: "report.pdf",
    });
    expect(t.summary().count).toBe(0);
  });

  it("treats a vanished partial file as completed or cancelled", () => {
    const t = new DownloadTracker();
    t.created("a.zip.part");
    t.created("b.zip.part");
    expect(t.summary().count).toBe(2);
    expect(t.deleted("a.zip.part", exists(["a.zip"]))).toEqual({
      kind: "completed",
      name: "a.zip",
    });
    expect(t.deleted("b.zip.part", exists([]))).toEqual({ kind: "cancelled", name: "b.zip" });
    expect(t.deleted("never-seen.part", exists([]))).toBe(null);
  });

  it("ignores ordinary files and duplicate creations", () => {
    const t = new DownloadTracker();
    expect(t.created("photo.jpg")).toBe(null);
    t.created("x.part");
    expect(t.created("x.part")).toBe(null);
    expect(t.renamed("photo.jpg", "y.part")).toEqual({ kind: "started", name: "y" });
  });
});

describe("nextile-model", () => {
  const state = (extra = {}) =>
    JSON.stringify({
      tiling: true,
      workspace: 1,
      scratchpad: { windows: 2, hidden: 1 },
      focus: { wmClass: "firefox", floating: false, layout: "HSPLIT" },
      ...extra,
    });

  it("parses state defensively", () => {
    expect(parseNexTileState(state())).toEqual({
      tiling: true,
      workspace: 1,
      scratchpad: { windows: 2, hidden: 1 },
      focus: { wmClass: "firefox", floating: false, layout: "HSPLIT" },
    });
    expect(parseNexTileState("not json")).toBe(null);
    expect(parseNexTileState('{"focus":null}')).toMatchObject({ tiling: false, focus: null });
  });

  it("reports tiling, layout and float changes for the same window", () => {
    const a = parseNexTileState(state());
    expect(nextileEvents(null, a)).toEqual([]);
    expect(nextileEvents(a, parseNexTileState(state({ tiling: false })))).toEqual([
      { kind: "tiling", on: false },
    ]);
    const tabbed = parseNexTileState(
      state({ focus: { wmClass: "firefox", floating: true, layout: "TABBED" } }),
    );
    expect(nextileEvents(a, tabbed)).toEqual([
      { kind: "layout", layout: "TABBED" },
      { kind: "float", floating: true },
    ]);
  });

  it("does not report focus moving to another window or workspace", () => {
    const a = parseNexTileState(state());
    const other = parseNexTileState(
      state({ focus: { wmClass: "kitty", floating: true, layout: "VSPLIT" } }),
    );
    expect(nextileEvents(a, other)).toEqual([]);
    expect(
      nextileEvents(
        a,
        parseNexTileState(
          state({ workspace: 2, focus: { wmClass: "firefox", floating: false, layout: "VSPLIT" } }),
        ),
      ),
    ).toEqual([]);
  });

  it("classifies D-Bus errors", () => {
    expect(statusFromErrorName("org.gnome.Shell.Extensions.NexTile.Error.Disabled")).toBe(
      "disabled",
    );
    expect(statusFromErrorName("org.freedesktop.DBus.Error.UnknownObject")).toBe("absent");
    expect(statusFromErrorName("org.freedesktop.DBus.Error.UnknownMethod")).toBe("absent");
    expect(statusFromErrorName("org.freedesktop.DBus.Error.Timeout")).toBe("error");
    expect(statusFromErrorName(null)).toBe("error");
  });
});

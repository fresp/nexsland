import { describe, expect, it } from "vitest";

import {
  isMprisName,
  metadataToTrack,
  pickActivePlayer,
  playerLabel,
} from "../../lib/providers/mpris-model.js";

describe("mpris-model", () => {
  it("recognises MPRIS bus names", () => {
    expect(isMprisName("org.mpris.MediaPlayer2.spotify")).toBe(true);
    expect(isMprisName("org.gnome.Shell")).toBe(false);
    expect(isMprisName(undefined)).toBe(false);
  });

  it("prefers Playing over Paused, then the most recent change", () => {
    const players = [
      { busName: "a", status: "Paused", title: "A", changedAt: 30 },
      { busName: "b", status: "Playing", title: "B", changedAt: 10 },
      { busName: "c", status: "Playing", title: "C", changedAt: 20 },
      { busName: "d", status: "Stopped", title: "D", changedAt: 99 },
    ];
    expect(pickActivePlayer(players).busName).toBe("c");
    expect(pickActivePlayer(players.filter((p) => p.status !== "Playing")).busName).toBe("a");
  });

  it("ignores stopped players and players without a title", () => {
    expect(
      pickActivePlayer([
        { busName: "a", status: "Stopped", title: "A", changedAt: 1 },
        { busName: "b", status: "Playing", title: "", changedAt: 2 },
      ]),
    ).toBe(null);
  });

  it("maps metadata defensively", () => {
    expect(
      metadataToTrack({
        "mpris:trackid": "/t/1",
        "xesam:title": "Song",
        "xesam:artist": ["X", "", "Y"],
        "xesam:album": "Album",
        "mpris:artUrl": "file:///tmp/a.png",
      }),
    ).toEqual({
      trackId: "/t/1",
      title: "Song",
      artist: "X, Y",
      album: "Album",
      artUrl: "file:///tmp/a.png",
    });
    expect(metadataToTrack({ "xesam:artist": "Solo", "xesam:title": 42 })).toMatchObject({
      artist: "Solo",
      title: "",
    });
    expect(metadataToTrack(null).title).toBe("");
  });

  it("derives a readable player label", () => {
    expect(playerLabel("org.mpris.MediaPlayer2.spotify")).toBe("spotify");
    expect(playerLabel("org.mpris.MediaPlayer2.firefox.instance_1_23")).toBe(
      "firefox.instance_1_23",
    );
    expect(playerLabel("org.mpris.MediaPlayer2.chromium.instance4321")).toBe("chromium");
  });
});

import { describe, expect, it } from "vitest";

import {
  Urgency,
  bannerDuration,
  echoesTrack,
  wantsBanner,
} from "../../lib/providers/banners-model.js";

describe("banners-model", () => {
  it("follows GNOME's banner rules", () => {
    const n = { acknowledged: false, urgency: Urgency.NORMAL, showBanners: true };
    expect(wantsBanner(n)).toBe(true);
    expect(wantsBanner({ ...n, acknowledged: true })).toBe(false);
    expect(wantsBanner({ ...n, urgency: Urgency.LOW })).toBe(false);
    expect(wantsBanner({ ...n, showBanners: false })).toBe(false);
    expect(wantsBanner({ ...n, showBanners: false, urgency: Urgency.CRITICAL })).toBe(true);
  });

  it("keeps critical banners longer", () => {
    expect(bannerDuration(Urgency.CRITICAL)).toBeGreaterThan(bannerDuration(Urgency.NORMAL));
  });

  it("recognises a player's notification for the track already shown", () => {
    const track = "DJ WINGI ATIKU RAISO NGAPUSI ( RAISO NGAPUSI 2 ) WHY FNKY REMIX";
    expect(echoesTrack({ title: track, body: "WHY FNKY REMIX" }, track)).toBe(true);
    expect(echoesTrack({ title: "DJ WINGI ATIKU RAISO NGAPUSI ( RAISO…" }, track)).toBe(true);
    expect(echoesTrack({ title: "Now playing", body: ` ${track.toLowerCase()} ` }, track)).toBe(
      true,
    );
    expect(echoesTrack({ title: "New message", body: "hi" }, track)).toBe(false);
    expect(echoesTrack({ title: "DJ", body: "" }, track)).toBe(false);
    expect(echoesTrack({ title: track }, null)).toBe(false);
  });
});

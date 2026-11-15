import { describe, expect, it } from "vitest";

import { classifyOsd, iconName } from "../../lib/providers/osd-model.js";

describe("osd-model", () => {
  it("extracts the first themed icon name", () => {
    expect(iconName(". GThemedIcon audio-volume-high-symbolic audio-volume-high")).toBe(
      "audio-volume-high-symbolic",
    );
    expect(iconName("display-brightness-symbolic")).toBe("display-brightness-symbolic");
    expect(iconName(null)).toBe("");
  });

  it("classifies volume, brightness, keyboard backlight and microphone", () => {
    expect(classifyOsd({ icon: "audio-volume-medium-symbolic", level: 0.62, maxLevel: 1 })).toEqual(
      {
        kind: "volume",
        icon: "audio-volume-medium-symbolic",
        percent: 62,
        fraction: 0.62,
        muted: false,
        overAmplified: false,
      },
    );
    expect(classifyOsd({ icon: "display-brightness-symbolic", level: 0.4 })?.kind).toBe(
      "brightness",
    );
    expect(classifyOsd({ icon: "keyboard-brightness-symbolic", level: 1 })?.kind).toBe(
      "keyboard-brightness",
    );
    expect(classifyOsd({ icon: "microphone-sensitivity-low-symbolic", level: 0.2 })?.kind).toBe(
      "microphone",
    );
  });

  it("reports mute from the icon or a zero level", () => {
    expect(classifyOsd({ icon: "audio-volume-muted-symbolic", level: 0.5 })?.muted).toBe(true);
    expect(classifyOsd({ icon: "audio-volume-low-symbolic", level: 0 })?.muted).toBe(true);
  });

  it("handles over-amplification against maxLevel", () => {
    const r = classifyOsd({
      icon: "audio-volume-overamplified-symbolic",
      level: 1.2,
      maxLevel: 1.5,
    });
    expect(r).toMatchObject({ percent: 120, overAmplified: true });
    expect(r?.fraction).toBeCloseTo(0.8, 6);
  });

  it("clamps out-of-range levels", () => {
    expect(
      classifyOsd({ icon: "audio-volume-high-symbolic", level: 3, maxLevel: 1 })?.percent,
    ).toBe(100);
    expect(classifyOsd({ icon: "audio-volume-high-symbolic", level: -1 })?.percent).toBe(0);
  });

  it("leaves requests without a level or with unknown icons to the stock OSD", () => {
    expect(classifyOsd({ icon: "audio-volume-high-symbolic", level: null })).toBe(null);
    expect(classifyOsd({ icon: "input-keyboard-symbolic", level: 0.5 })).toBe(null);
    expect(classifyOsd({ icon: "caps-lock-enabled-symbolic" })).toBe(null);
  });
});

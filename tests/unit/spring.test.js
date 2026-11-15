import { describe, expect, it } from "vitest";

import { Spring, SPRING_PRESETS } from "../../lib/engine/spring.js";

function run(spring, maxFrames = 600, dt = 1 / 60) {
  let peak = spring.value;
  for (let i = 0; i < maxFrames; i++) {
    peak = Math.max(peak, spring.value);
    if (spring.step(dt)) return { frames: i + 1, peak };
  }
  return { frames: Infinity, peak };
}

describe("Spring", () => {
  it("is at rest initially", () => {
    const s = new Spring(10);
    expect(s.atRest).toBe(true);
    expect(s.step(1 / 60)).toBe(true);
  });

  for (const [name, preset] of Object.entries(SPRING_PRESETS)) {
    it(`${name} settles exactly on target within a second`, () => {
      const s = new Spring(100, preset);
      s.target = 400;
      const { frames } = run(s);
      expect(frames).toBeLessThanOrEqual(60);
      expect(s.value).toBe(400);
      expect(s.velocity).toBe(0);
    });
  }

  it("bouncy overshoots visibly but stays bounded, smooth does not", () => {
    const bouncy = new Spring(0, SPRING_PRESETS.bouncy);
    bouncy.target = 100;
    expect(run(bouncy).peak).toBeGreaterThan(108);
    expect(
      run(Object.assign(new Spring(0, SPRING_PRESETS.bouncy), { target: 100 })).peak,
    ).toBeLessThan(120);

    const smooth = new Spring(0, SPRING_PRESETS.smooth);
    smooth.target = 100;
    expect(run(smooth).peak).toBeLessThanOrEqual(100.5);
  });

  it("keeps velocity across a retarget", () => {
    const s = new Spring(0);
    s.target = 300;
    for (let i = 0; i < 5; i++) s.step(1 / 60);
    const v = s.velocity;
    s.target = 400;
    expect(s.velocity).toBe(v);
    expect(v).toBeGreaterThan(0);
    run(s);
    expect(s.value).toBe(400);
  });

  it("survives a long frame stall without blowing up", () => {
    const s = new Spring(0);
    s.target = 100;
    s.step(5);
    expect(Number.isFinite(s.value)).toBe(true);
    expect(Math.abs(s.value)).toBeLessThan(1000);
  });

  it("snap jumps without animation", () => {
    const s = new Spring(0);
    s.target = 50;
    s.step(1 / 60);
    s.snap(20);
    expect([s.value, s.target, s.velocity]).toEqual([20, 20, 0]);
  });
});

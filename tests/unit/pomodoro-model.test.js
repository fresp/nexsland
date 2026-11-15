import { describe, expect, it } from "vitest";

import { POMODORO_OPTIONS, PomodoroCycle, nextOption } from "../../lib/features/pomodoro-model.js";

const config = { focusMin: 25, breakMin: 5, longMin: 15, rounds: 3 };

describe("PomodoroCycle", () => {
  it("alternates focus and break, then ends on the long break", () => {
    const cycle = new PomodoroCycle(config);
    const seen = [];
    do seen.push([cycle.phase, cycle.round, cycle.minutes, cycle.roundsDone]);
    while (cycle.advance());
    expect(seen).toEqual([
      ["focus", 1, 25, 0],
      ["break", 1, 5, 1],
      ["focus", 2, 25, 1],
      ["break", 2, 5, 2],
      ["focus", 3, 25, 2],
      ["long", 3, 15, 3],
    ]);
    expect(cycle.advance()).toBe(false);
  });

  it("goes straight to the long break with a single round", () => {
    const cycle = new PomodoroCycle({ ...config, rounds: 1 });
    expect(cycle.advance()).toBe(true);
    expect(cycle.phase).toBe("long");
  });

  it("rejects lengths below one", () => {
    expect(() => new PomodoroCycle({ ...config, focusMin: 0 })).toThrow();
    expect(() => new PomodoroCycle({ ...config, rounds: NaN })).toThrow();
  });
});

describe("nextOption", () => {
  it("steps to the next option and wraps", () => {
    expect(nextOption(POMODORO_OPTIONS.focus, 25)).toBe(30);
    expect(nextOption(POMODORO_OPTIONS.focus, 50)).toBe(15);
  });

  it("recovers from a value that is not an option", () => {
    expect(nextOption(POMODORO_OPTIONS.break, 4)).toBe(5);
    expect(nextOption(POMODORO_OPTIONS.break, 99)).toBe(3);
  });
});

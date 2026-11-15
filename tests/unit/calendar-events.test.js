import { describe, expect, it } from "vitest";

import { addMonths, agenda, dayOffset, isAllDay } from "../../lib/features/calendar-model.js";

const d = (...a) => new Date(...a);

describe("calendar events", () => {
  it("steps across years", () => {
    expect(addMonths(2026, 10, 2)).toEqual({ year: 2027, month: 0 });
    expect(addMonths(2026, 0, -1)).toEqual({ year: 2025, month: 11 });
    expect(addMonths(2026, 5, -18)).toEqual({ year: 2024, month: 11 });
    expect(addMonths(2026, 5, 0)).toEqual({ year: 2026, month: 5 });
  });

  it("counts calendar days, not 24h spans", () => {
    const now = d(2026, 10, 15, 23, 0);
    expect(dayOffset(d(2026, 10, 16, 1, 0), now)).toBe(1);
    expect(dayOffset(d(2026, 10, 15, 0, 0), now)).toBe(0);
    expect(dayOffset(d(2026, 10, 14, 23, 59), now)).toBe(-1);
  });

  it("recognises all-day events", () => {
    expect(isAllDay({ date: d(2026, 10, 15), end: d(2026, 10, 16) })).toBe(true);
    expect(isAllDay({ date: d(2026, 10, 15), end: d(2026, 10, 18) })).toBe(true);
    expect(isAllDay({ date: d(2026, 10, 15, 9), end: d(2026, 10, 15, 10) })).toBe(false);
  });

  it("lists upcoming events, ongoing first, skipping ended ones", () => {
    const now = d(2026, 10, 15, 10, 0);
    const events = [
      { summary: "Tomorrow", date: d(2026, 10, 16, 9), end: d(2026, 10, 16, 10) },
      { summary: "Ended", date: d(2026, 10, 15, 8), end: d(2026, 10, 15, 9) },
      { summary: "Later", date: d(2026, 10, 15, 14), end: d(2026, 10, 15, 15) },
      { summary: "Now", date: d(2026, 10, 15, 9, 30), end: d(2026, 10, 15, 10, 30) },
      { summary: "Far", date: d(2026, 10, 20, 9), end: d(2026, 10, 20, 10) },
    ];
    expect(agenda(events, now).map((r) => [r.summary, r.day, r.ongoing])).toEqual([
      ["Now", 0, true],
      ["Later", 0, false],
      ["Tomorrow", 1, false],
    ]);
  });
});

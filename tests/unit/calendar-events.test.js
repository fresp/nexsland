import { describe, expect, it } from "vitest";

import {
  agenda,
  dayOffset,
  isAllDay,
  shellCalendarRange,
} from "../../lib/features/calendar-model.js";

const d = (...a) => new Date(...a);

describe("calendar events", () => {
  it("asks for the same range as GNOME's calendar", () => {
    // November 2026 starts on a Sunday.
    expect(shellCalendarRange(2026, 10, 1)).toEqual({ begin: d(2026, 9, 26), end: d(2026, 11, 7) });
    // With a Sunday week start it is padded by a whole week.
    expect(shellCalendarRange(2026, 10, 0)).toEqual({ begin: d(2026, 9, 25), end: d(2026, 11, 6) });
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

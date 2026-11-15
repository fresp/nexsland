import { describe, expect, it } from "vitest";

import { monthGrid, weekdayOrder } from "../../lib/features/calendar-model.js";
import { ClipboardHistory, isSensitive, preview } from "../../lib/features/clipboard-model.js";
import {
  cpuPercent,
  formatBytes,
  netRates,
  parseMeminfo,
  parseNetDev,
  parseProcStat,
} from "../../lib/features/stats-model.js";
import { CountdownTimer } from "../../lib/features/timer-model.js";

describe("CountdownTimer", () => {
  it("runs, pauses, resumes and finishes", () => {
    const t = new CountdownTimer();
    expect(t.state).toBe("idle");
    t.start(60_000, 0);
    expect(t.remaining(10_000)).toBe(50_000);
    t.pause(10_000);
    expect(t.state).toBe("paused");
    expect(t.remaining(99_000)).toBe(50_000);
    t.resume(100_000);
    expect(t.remaining(120_000)).toBe(30_000);
    expect(t.isDone(149_999)).toBe(false);
    expect(t.isDone(150_000)).toBe(true);
    expect(t.remaining(200_000)).toBe(0);
  });

  it("extends without going below zero and resets", () => {
    const t = new CountdownTimer();
    t.start(60_000, 0);
    t.extend(60_000, 0);
    expect(t.remaining(0)).toBe(120_000);
    t.extend(-500_000, 0);
    expect(t.remaining(0)).toBe(0);
    t.reset();
    expect([t.state, t.remaining(0)]).toEqual(["idle", 0]);
    expect(() => t.start(0, 0)).toThrow();
  });
});

describe("stats-model", () => {
  const stat = (user, idle) => `cpu  ${user} 0 0 ${idle} 0 0 0 0 0 0\ncpu0 1 2 3 4\n`;

  it("computes CPU busy percentage between samples", () => {
    const a = parseProcStat(stat(100, 900));
    const b = parseProcStat(stat(150, 950));
    expect(cpuPercent(a, b)).toBe(50);
    expect(cpuPercent(a, a)).toBe(0);
    expect(parseProcStat("garbage")).toBe(null);
  });

  it("parses used memory from MemAvailable", () => {
    const m = parseMeminfo(
      "MemTotal:       16000000 kB\nMemFree: 1 kB\nMemAvailable:    4000000 kB\n",
    );
    expect(m?.percent).toBe(75);
    expect(m?.usedBytes).toBe(12000000 * 1024);
    expect(parseMeminfo("MemTotal: 10 kB\n")).toBe(null);
  });

  it("sums interface traffic except loopback and computes rates", () => {
    const text = `Inter-|   Receive |  Transmit
 face |bytes packets errs drop fifo frame compressed multicast|bytes packets
    lo: 5000 0 0 0 0 0 0 0 5000 0 0 0 0 0 0 0
  wlp1s0: 1000 0 0 0 0 0 0 0 200 0 0 0 0 0 0 0
  enp2s0: 24 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0
`;
    const a = parseNetDev(text);
    expect(a).toEqual({ rx: 1024, tx: 200 });
    expect(netRates(a, { rx: 3072, tx: 1224 }, 2)).toEqual({ rx: 1024, tx: 512 });
    expect(netRates(a, a, 0)).toEqual({ rx: 0, tx: 0 });
  });

  it("formats bytes", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
  });
});

describe("calendar-model", () => {
  it("lays out November 2026 starting on Monday", () => {
    const grid = monthGrid(2026, 10, 1, { year: 2026, month: 10, day: 15 });
    // 1 Nov 2026 is a Sunday: six leading days from October.
    expect(grid[0].map((c) => c.day)).toEqual([26, 27, 28, 29, 30, 31, 1]);
    expect(grid[0][0].inMonth).toBe(false);
    expect(grid.length).toBe(6);
    const today = grid.flat().filter((c) => c.isToday);
    expect(today).toEqual([{ day: 15, inMonth: true, isToday: true }]);
  });

  it("starts on Sunday when asked", () => {
    const grid = monthGrid(2026, 10, 0, { year: 2000, month: 0, day: 1 });
    expect(grid[0][0]).toEqual({ day: 1, inMonth: true, isToday: false });
    expect(weekdayOrder(1)).toEqual([1, 2, 3, 4, 5, 6, 0]);
  });
});

describe("clipboard-model", () => {
  it("keeps newest first, dedupes and caps the size", () => {
    const h = new ClipboardHistory({ max: 3 });
    expect(h.push("a")).toBe(true);
    h.push("b");
    h.push("c");
    expect(h.push("c")).toBe(false);
    h.push("a");
    expect(h.items).toEqual(["a", "c", "b"]);
    h.push("d");
    expect(h.items).toEqual(["d", "a", "c"]);
    expect(h.remove("a")).toBe(true);
    h.clear();
    expect(h.items).toEqual([]);
  });

  it("ignores blank and oversized text", () => {
    const h = new ClipboardHistory({ maxLength: 5 });
    expect(h.push("   ")).toBe(false);
    expect(h.push("toolong")).toBe(false);
    expect(h.push(null)).toBe(false);
  });

  it("detects password-manager hints and previews text", () => {
    expect(isSensitive(["text/plain", "x-kde-passwordManagerHint"])).toBe(true);
    expect(isSensitive(["text/plain"])).toBe(false);
    expect(preview("  hello\n\n  world  ")).toBe("hello world");
    expect(preview("x".repeat(10), 5)).toBe("xxxx…");
  });
});

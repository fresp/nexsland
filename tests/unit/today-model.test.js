import { describe, expect, it } from "vitest";

import { TodayList, formatMinutes, parseEntry, parseTime } from "../../lib/features/today-model.js";

const DAY = "2026-11-15";
const at = (h, m = 0) => h * 60 + m;

describe("parseEntry", () => {
  it("takes a time written as the last or the first word", () => {
    expect(parseEntry("Review PR 16:00")).toEqual({ title: "Review PR", minutes: at(16) });
    expect(parseEntry(" 9.30  standup ")).toEqual({ title: "standup", minutes: at(9, 30) });
  });

  it("keeps anything that is not a time of day in the title", () => {
    expect(parseEntry("Renew cert")).toEqual({ title: "Renew cert", minutes: null });
    expect(parseEntry("Ship 24:00")).toEqual({ title: "Ship 24:00", minutes: null });
    expect(parseEntry("Ratio 16:75")).toEqual({ title: "Ratio 16:75", minutes: null });
    expect(parseEntry("Call at 10:00 sharp").minutes).toBe(null);
  });

  it("needs a title", () => {
    expect(parseEntry("  ")).toBe(null);
    expect(parseEntry("14:30")).toBe(null);
  });
});

describe("TodayList", () => {
  it("orders timed tasks by time, then untimed ones as added", () => {
    const list = new TodayList();
    for (const text of ["Cert", "Review 16:00", "Notes", "Standup 09:00"]) list.add(text, DAY);
    expect(list.tasks.map((t) => t.title)).toEqual(["Standup", "Review", "Cert", "Notes"]);
    expect(formatMinutes(list.tasks[0].minutes)).toBe("09:00");
  });

  it("survives a round trip and drops malformed rows", () => {
    const list = new TodayList();
    list.add("Review 16:00", DAY);
    list.toggle(list.tasks[0].id);
    const copy = new TodayList(list.serialize());
    expect(copy.tasks).toEqual(list.tasks);
    expect(new TodayList("not json").tasks).toEqual([]);
    expect(new TodayList('[{"title":"","day":"x"},{"title":"ok"},7,null]').tasks).toEqual([]);
    expect(new TodayList('{"title":"ok"}').tasks).toEqual([]);
  });

  it("announces a task once, inside the lead window only", () => {
    const list = new TodayList();
    list.add("Review 16:00", DAY);
    expect(list.takeWarnings(DAY, at(15, 49), 10)).toEqual([]);
    expect(list.takeWarnings(DAY, at(15, 50), 10).map((t) => t.title)).toEqual(["Review"]);
    expect(list.takeWarnings(DAY, at(15, 55), 10)).toEqual([]);
    const off = new TodayList();
    off.add("Review 16:00", DAY);
    expect(off.takeWarnings(DAY, at(15, 59), 0)).toEqual([]);
    expect(off.takeWarnings(DAY, at(16), 10)).toEqual([]);
  });

  it("keeps a task due until it is ticked or snoozed", () => {
    const list = new TodayList();
    list.add("Later 17:00", DAY);
    list.add("Review 16:00", DAY);
    list.add("Untimed", DAY);
    const [review] = list.tasks;
    expect(list.due(DAY, at(15, 59))).toEqual([]);
    expect(list.due(DAY, at(17, 5)).map((t) => t.title)).toEqual(["Review", "Later"]);
    list.snooze(review.id, at(17, 5), 10);
    expect(list.due(DAY, at(17, 14)).map((t) => t.title)).toEqual(["Later"]);
    expect(list.due(DAY, at(17, 15)).map((t) => t.title)).toEqual(["Review", "Later"]);
    list.toggle(review.id);
    expect(list.due(DAY, at(18)).map((t) => t.title)).toEqual(["Later"]);
  });

  it("carries unticked tasks to the next day without a time and drops ticked ones", () => {
    const list = new TodayList();
    list.add("Done 09:00", DAY);
    list.add("Open 14:30", DAY);
    list.toggle(list.tasks[0].id);
    list.takeWarnings(DAY, at(14, 25), 10);
    expect(list.rollover(DAY)).toBe(false);
    expect(list.rollover("2026-11-16")).toBe(true);
    expect(list.tasks).toMatchObject([
      { title: "Open", minutes: null, day: "2026-11-16", done: false, warned: false },
    ]);
    expect(list.tasks).toHaveLength(1);
    expect(list.due(DAY, at(23, 59))).toEqual([]);
  });

  it("takes a time entered separately over one in the title", () => {
    const list = new TodayList();
    expect(list.add("Review", DAY, parseTime("16:00")).minutes).toBe(at(16));
    expect(list.add("Standup 09:00", DAY, at(10))).toMatchObject({
      title: "Standup",
      minutes: at(10),
    });
    expect([parseTime(" 9.05 "), parseTime("24:00"), parseTime("4pm"), parseTime("")]).toEqual([
      at(9, 5),
      null,
      null,
      null,
    ]);
  });

  it("keeps tasks for coming days apart and quiet until their day", () => {
    const NEXT = "2026-11-17";
    const list = new TodayList();
    list.add("Later 09:00", NEXT);
    list.add("Now 16:00", DAY);
    list.add("Early 08:00", NEXT);
    expect(list.days()).toEqual([DAY, NEXT]);
    expect(list.tasks.map((t) => t.title)).toEqual(["Now", "Early", "Later"]);
    expect(list.due(DAY, at(23)).map((t) => t.title)).toEqual(["Now"]);
    expect(list.takeWarnings(DAY, at(7, 55), 10)).toEqual([]);
    expect(list.rollover("2026-11-16")).toBe(true);
    expect(list.forDay(NEXT).map((t) => [t.title, t.minutes])).toEqual([
      ["Early", at(8)],
      ["Later", at(9)],
    ]);
    expect(list.rollover(NEXT)).toBe(true);
    expect(list.due(NEXT, at(8)).map((t) => t.title)).toEqual(["Early"]);
    expect(list.takeWarnings(NEXT, at(8, 55), 10).map((t) => t.title)).toEqual(["Later"]);
    expect(list.forDay(NEXT).map((t) => [t.title, t.minutes])).toEqual([
      ["Early", at(8)],
      ["Later", at(9)],
      ["Now", null],
    ]);
  });

  it("removes a task and refuses one without a title", () => {
    const list = new TodayList();
    expect(list.add("16:00", DAY)).toBe(null);
    const task = list.add("Review 16:00", DAY);
    list.remove(task.id);
    expect(list.tasks).toEqual([]);
  });
});

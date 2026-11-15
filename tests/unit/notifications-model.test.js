import { describe, expect, it } from "vitest";

import { age, newestFirst, plainBody } from "../../lib/features/notifications-model.js";

describe("notifications-model", () => {
  it("buckets ages", () => {
    expect(age(1000, 990)).toEqual({ unit: "now", count: 0 });
    expect(age(1000, 2000)).toEqual({ unit: "now", count: 0 });
    expect(age(10000, 10000 - 125)).toEqual({ unit: "minutes", count: 2 });
    expect(age(100000, 100000 - 7300)).toEqual({ unit: "hours", count: 2 });
    expect(age(1000000, 1000000 - 3 * 86400)).toEqual({ unit: "days", count: 3 });
    expect(age(1000, NaN)).toEqual({ unit: "now", count: 0 });
  });

  it("orders newest first, untimed last and stable", () => {
    const list = [{ id: "a", time: 5 }, { id: "b" }, { id: "c", time: 9 }, { id: "d" }];
    expect(newestFirst(list).map((e) => e.id)).toEqual(["c", "a", "b", "d"]);
  });

  it("flattens markup bodies to one line", () => {
    expect(plainBody("<b>Hi</b>\n  there &amp; <i>you</i>", true)).toBe("Hi there & you");
    expect(plainBody("a <b> b\n c")).toBe("a <b> b c");
    expect(plainBody(null)).toBe("");
  });
});

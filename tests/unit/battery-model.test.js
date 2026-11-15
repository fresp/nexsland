import { describe, expect, it } from "vitest";

import {
  UPOWER_TYPE_BATTERY,
  UPowerState,
  batteryEvent,
  isOnAc,
} from "../../lib/providers/battery-model.js";

const snap = (state, percentage, extra = {}) => ({
  present: true,
  type: UPOWER_TYPE_BATTERY,
  state,
  percentage,
  ...extra,
});

const { CHARGING, DISCHARGING, FULLY_CHARGED, PENDING_CHARGE, UNKNOWN } = UPowerState;

describe("battery-model", () => {
  it("treats charging, full and pending-charge as on AC", () => {
    expect([CHARGING, FULLY_CHARGED, PENDING_CHARGE].every(isOnAc)).toBe(true);
    expect(isOnAc(DISCHARGING)).toBe(false);
  });

  it("never fires on the first snapshot", () => {
    expect(batteryEvent(null, snap(CHARGING, 50))).toBe(null);
  });

  it("detects plug and unplug", () => {
    expect(batteryEvent(snap(DISCHARGING, 50), snap(CHARGING, 50))).toBe("plugged");
    expect(batteryEvent(snap(DISCHARGING, 50), snap(PENDING_CHARGE, 50))).toBe("plugged");
    expect(batteryEvent(snap(CHARGING, 50), snap(DISCHARGING, 50))).toBe("unplugged");
  });

  it("reports full when charging completes, plugged when plugging into a full battery", () => {
    expect(batteryEvent(snap(CHARGING, 99), snap(FULLY_CHARGED, 100))).toBe("full");
    expect(batteryEvent(snap(DISCHARGING, 100), snap(FULLY_CHARGED, 100))).toBe("plugged");
    expect(batteryEvent(snap(FULLY_CHARGED, 100), snap(FULLY_CHARGED, 100))).toBe(null);
  });

  it("fires low and critical once when crossing the thresholds while discharging", () => {
    expect(batteryEvent(snap(DISCHARGING, 21), snap(DISCHARGING, 20))).toBe("low");
    expect(batteryEvent(snap(DISCHARGING, 20), snap(DISCHARGING, 19))).toBe(null);
    expect(batteryEvent(snap(DISCHARGING, 11), snap(DISCHARGING, 10))).toBe("critical");
    expect(batteryEvent(snap(DISCHARGING, 25), snap(DISCHARGING, 8))).toBe("critical");
  });

  it("does not fire low while charging", () => {
    expect(batteryEvent(snap(CHARGING, 21), snap(CHARGING, 20))).toBe(null);
  });

  it("ignores devices that are absent, not batteries, or in an unknown state", () => {
    expect(batteryEvent(snap(DISCHARGING, 50), snap(CHARGING, 50, { present: false }))).toBe(null);
    expect(batteryEvent(snap(DISCHARGING, 50), snap(CHARGING, 50, { type: 1 }))).toBe(null);
    expect(batteryEvent(snap(DISCHARGING, 50), snap(UNKNOWN, 50))).toBe(null);
  });
});

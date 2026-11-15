import { describe, expect, it } from "vitest";

import {
  applyDeviceProps,
  bluetoothEvent,
  deviceIconName,
} from "../../lib/providers/bluetooth-model.js";
import { formatElapsed, micUsers } from "../../lib/providers/format.js";
import { networkEvents } from "../../lib/providers/network-model.js";

describe("bluetooth-model", () => {
  const dev = (connected, extra = {}) => ({
    connected,
    alias: "Headphones",
    icon: "audio-headphones",
    battery: null,
    ...extra,
  });

  it("announces transitions only, never the first sighting", () => {
    expect(bluetoothEvent(null, dev(true))).toBe(null);
    expect(bluetoothEvent(dev(false), dev(true))).toBe("connected");
    expect(bluetoothEvent(dev(true), dev(false))).toBe("disconnected");
    expect(bluetoothEvent(dev(true), dev(true, { battery: 70 }))).toBe(null);
  });

  it("merges Device1 and Battery1 properties", () => {
    let d = applyDeviceProps(null, "org.bluez.Device1", { Name: "WH-1", Icon: "audio-headset" });
    expect(d).toEqual({ connected: false, alias: "WH-1", icon: "audio-headset", battery: null });
    d = applyDeviceProps(d, "org.bluez.Device1", { Alias: "My headset", Connected: true });
    d = applyDeviceProps(d, "org.bluez.Battery1", { Percentage: 74 });
    expect(d).toEqual({ connected: true, alias: "My headset", icon: "audio-headset", battery: 74 });
    expect(applyDeviceProps(d, "org.bluez.MediaControl1", { Connected: false })).toEqual(d);
  });

  it("maps BlueZ icon hints to symbolic icons", () => {
    expect(deviceIconName("audio-headphones")).toBe("audio-headphones-symbolic");
    expect(deviceIconName("input-mouse")).toBe("input-mouse-symbolic");
    expect(deviceIconName("")).toBe("bluetooth-active-symbolic");
  });
});

describe("network-model", () => {
  const wifi = (id) => ({ id, type: "802-11-wireless" });
  const snap = (primary, vpns = []) => ({ primary, vpns });

  it("never announces the first snapshot", () => {
    expect(networkEvents(null, snap(wifi("Home")))).toEqual([]);
  });

  it("reports Wi-Fi, wired and generic connections and disconnects", () => {
    expect(networkEvents(snap(null), snap(wifi("Home")))).toEqual([
      { kind: "wifi-connected", name: "Home" },
    ]);
    expect(networkEvents(snap(wifi("Home")), snap(wifi("Office")))).toEqual([
      { kind: "wifi-connected", name: "Office" },
    ]);
    expect(
      networkEvents(snap(null), snap({ id: "Wired connection 1", type: "802-3-ethernet" })),
    ).toEqual([{ kind: "wired-connected", name: "Wired connection 1" }]);
    expect(networkEvents(snap(null), snap({ id: "Phone", type: "gsm" }))).toEqual([
      { kind: "connected", name: "Phone" },
    ]);
    expect(networkEvents(snap(wifi("Home")), snap(null))).toEqual([
      { kind: "disconnected", name: "Home" },
    ]);
    expect(networkEvents(snap(wifi("Home")), snap(wifi("Home")))).toEqual([]);
  });

  it("reports VPNs separately, even when one becomes the primary connection", () => {
    const vpn = { id: "Work", type: "wireguard" };
    expect(networkEvents(snap(wifi("Home")), snap(vpn, ["Work"]))).toEqual([
      { kind: "vpn-connected", name: "Work" },
    ]);
    expect(networkEvents(snap(vpn, ["Work"]), snap(wifi("Home")))).toEqual([
      { kind: "wifi-connected", name: "Home" },
      { kind: "vpn-disconnected", name: "Work" },
    ]);
  });
});

describe("format", () => {
  it("formats elapsed time", () => {
    expect(formatElapsed(0)).toBe("00:00");
    expect(formatElapsed(42.9)).toBe("00:42");
    expect(formatElapsed(605)).toBe("10:05");
    expect(formatElapsed(3723)).toBe("1:02:03");
    expect(formatElapsed(-5)).toBe("00:00");
  });

  it("lists distinct mic users and skips metering apps", () => {
    expect(
      micUsers([
        { appId: "org.PulseAudio.pavucontrol", name: "Peak detect" },
        { appId: "org.mozilla.firefox", name: "Firefox" },
        { appId: "org.mozilla.firefox", name: "Firefox" },
        { appId: null, name: null },
        { appId: "com.obsproject.Studio", name: "" },
      ]),
    ).toEqual(["Firefox", "?", "com.obsproject.Studio"]);
  });
});

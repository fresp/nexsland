import { describe, expect, it } from "vitest";

import { SignalTracker } from "../../lib/shared/signals.js";

function emitter() {
  let next = 1;
  const handlers = new Map();
  return {
    handlers,
    connect: (_sig, cb) => (handlers.set(next, cb), next++),
    disconnect: (id) => handlers.delete(id),
  };
}

describe("SignalTracker", () => {
  it("disconnects everything it connected", () => {
    const a = emitter();
    const b = emitter();
    const t = new SignalTracker();
    t.track(a, "x", () => {});
    t.track(a, "y", () => {});
    t.track(b, "z", () => {});
    expect(t.size).toBe(3);
    t.disconnectAll();
    expect(a.handlers.size + b.handlers.size).toBe(0);
    expect(t.size).toBe(0);
  });

  it("tolerates objects that throw on disconnect", () => {
    const t = new SignalTracker();
    t.track(
      {
        connect: () => 1,
        disconnect: () => {
          throw new Error("finalized");
        },
      },
      "x",
      () => {},
    );
    expect(() => t.disconnectAll()).not.toThrow();
  });
});

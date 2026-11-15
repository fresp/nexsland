import { beforeEach, describe, expect, it } from "vitest";

import { IslandEngine } from "../../lib/engine/engine.js";

/** Manual scheduler: tests advance time explicitly. */
function fakeScheduler() {
  let now = 0;
  let nextId = 1;
  const timers = new Map();
  return {
    setTimeout(fn, ms) {
      const id = nextId++;
      timers.set(id, { fn, at: now + ms });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    advance(ms) {
      now += ms;
      for (const [id, t] of [...timers].sort((a, b) => a[1].at - b[1].at)) {
        if (t.at <= now && timers.has(id)) {
          timers.delete(id);
          t.fn();
        }
      }
    },
    get pending() {
      return timers.size;
    },
  };
}

const live = (id, priority = 0, extra = {}) => ({ id, priority, ...extra });

describe("IslandEngine", () => {
  let sched;
  let engine;
  let emitted;

  beforeEach(() => {
    sched = fakeScheduler();
    engine = new IslandEngine({ scheduler: sched });
    emitted = [];
    engine.subscribe((s) => emitted.push(s));
  });

  it("starts empty", () => {
    expect(engine.state).toEqual({ kind: null, content: null, expanded: false });
  });

  it("shows the highest-priority live activity", () => {
    engine.showLive(live("media", 50));
    engine.showLive(live("timer", 80));
    engine.showLive(live("download", 10));
    expect(engine.state.content.id).toBe("timer");
    expect(engine.liveStack.map((c) => c.id)).toEqual(["timer", "media", "download"]);
  });

  it("breaks priority ties in favour of the newest, keeping older ties in order", () => {
    engine.showLive(live("a"));
    engine.showLive(live("b"));
    engine.showLive(live("c"));
    expect(engine.liveStack.map((c) => c.id)).toEqual(["c", "b", "a"]);
  });

  it("replaces a live activity with the same id or stackId", () => {
    engine.showLive(live("track-1", 0, { stackId: "media" }));
    engine.showLive(live("track-2", 0, { stackId: "media" }));
    expect(engine.liveStack.map((c) => c.id)).toEqual(["track-2"]);
    const updated = live("track-2", 0, { stackId: "media", title: "new" });
    engine.showLive(updated);
    expect(engine.state.content).toBe(updated);
  });

  it("hideLive falls back to the next live activity", () => {
    engine.showLive(live("media", 50));
    engine.showLive(live("timer", 80));
    engine.hideLive("timer");
    expect(engine.state.content.id).toBe("media");
    engine.hideLive("media");
    expect(engine.state.kind).toBe(null);
  });

  it("temporary preempts live, then falls back after its duration", () => {
    engine.showLive(live("media"));
    engine.showTemporary({ id: "volume" }, 1500);
    expect(engine.state).toMatchObject({ kind: "temporary", content: { id: "volume" } });
    sched.advance(1499);
    expect(engine.state.kind).toBe("temporary");
    sched.advance(1);
    expect(engine.state).toMatchObject({ kind: "live", content: { id: "media" } });
  });

  it("same-id temporary replaces content and restarts the timer", () => {
    engine.showTemporary({ id: "volume", level: 1 }, 1000);
    sched.advance(800);
    engine.showTemporary({ id: "volume", level: 2 }, 1000);
    expect(engine.state.content.level).toBe(2);
    sched.advance(800);
    expect(engine.state.kind).toBe("temporary");
    sched.advance(200);
    expect(engine.state.kind).toBe(null);
    expect(sched.pending).toBe(0);
  });

  it("queues different temporaries in arrival order", () => {
    engine.showTemporary({ id: "battery" }, 1000);
    engine.showTemporary({ id: "bluetooth" }, 500);
    expect(engine.state.content.id).toBe("battery");
    sched.advance(1000);
    expect(engine.state.content.id).toBe("bluetooth");
    sched.advance(500);
    expect(engine.state.kind).toBe(null);
  });

  it("rejects bad input", () => {
    expect(() => engine.showLive({})).toThrow();
    expect(() => engine.showTemporary({ id: "x" }, 0)).toThrow();
  });

  it("dismiss stashes a live activity and restore brings it back", () => {
    engine.showLive(live("media", 50));
    engine.showLive(live("timer", 80));
    engine.dismiss();
    expect(engine.state.content.id).toBe("media");
    engine.dismiss();
    expect(engine.state.kind).toBe(null);
    expect(engine.restore()).toBe(true);
    expect(engine.state.content.id).toBe("media");
    expect(engine.restore()).toBe(true);
    expect(engine.state.content.id).toBe("timer");
    expect(engine.restore()).toBe(false);
  });

  it("updating a dismissed activity keeps it dismissed", () => {
    engine.showLive(live("media"));
    engine.dismiss();
    engine.showLive(live("media", 0, { title: "next track" }));
    expect(engine.state.kind).toBe(null);
  });

  it("restore skips activities that ended while dismissed", () => {
    engine.showLive(live("media"));
    engine.dismiss();
    engine.hideLive("media");
    expect(engine.restore()).toBe(false);
  });

  it("non-restorable activities are removed on dismiss", () => {
    engine.showLive(live("toast", 0, { restorable: false }));
    engine.dismiss();
    expect(engine.liveStack).toEqual([]);
    expect(engine.restore()).toBe(false);
  });

  it("dismiss during a temporary cuts it short", () => {
    engine.showLive(live("media"));
    engine.showTemporary({ id: "volume" }, 1000);
    engine.dismiss();
    expect(engine.state.content.id).toBe("media");
    expect(sched.pending).toBe(0);
  });

  it("opens the panel with or without content; a temporary hides it until it ends", () => {
    engine.toggleExpanded();
    expect(engine.state).toEqual({ kind: null, content: null, expanded: true });
    engine.showLive(live("media", 10, { expandable: true }));
    expect(engine.state).toMatchObject({ kind: "live", expanded: true });
    engine.showTemporary({ id: "volume" }, 1000);
    expect(engine.state.expanded).toBe(false);
    sched.advance(1000);
    expect(engine.state.expanded).toBe(true);
    engine.collapse();
    expect(engine.state.expanded).toBe(false);
  });

  it("expand is idempotent and dismiss closes the panel", () => {
    engine.showLive(live("media"));
    engine.expand();
    const count = emitted.length;
    engine.expand();
    expect(emitted.length).toBe(count);
    engine.dismiss();
    expect(engine.state).toEqual({ kind: null, content: null, expanded: false });
  });

  it("does not emit when nothing visible changed", () => {
    engine.showLive(live("media", 50));
    const count = emitted.length;
    engine.showLive(live("background", 10));
    expect(emitted.length).toBe(count);
  });

  it("hideAll and destroy clear timers", () => {
    engine.showLive(live("media"));
    engine.showTemporary({ id: "volume" }, 1000);
    engine.hideAll();
    expect(engine.state.kind).toBe(null);
    expect(sched.pending).toBe(0);
    engine.showTemporary({ id: "volume" }, 1000);
    engine.destroy();
    expect(sched.pending).toBe(0);
  });

  it("unsubscribe stops notifications", () => {
    const seen = [];
    const off = engine.subscribe((s) => seen.push(s));
    off();
    engine.showLive(live("media"));
    expect(seen).toEqual([]);
  });

  it("looks up a live activity by id", () => {
    const engine = new IslandEngine({ scheduler: { setTimeout: () => 1, clearTimeout: () => {} } });
    expect(engine.liveContent("media")).toBe(null);
    engine.showLive({ id: "media", track: { title: "Song" } });
    expect(engine.liveContent("media").track.title).toBe("Song");
    engine.hideLive("media");
    expect(engine.liveContent("media")).toBe(null);
  });

  it("knows whether a temporary is shown or queued", () => {
    const engine = new IslandEngine({ scheduler: { setTimeout: () => 1, clearTimeout: () => {} } });
    engine.showTemporary({ id: "a" }, 1000);
    engine.showTemporary({ id: "b" }, 1000);
    expect(engine.hasTemporary("a")).toBe(true);
    expect(engine.hasTemporary("b")).toBe(true);
    engine.dismiss();
    expect(engine.hasTemporary("a")).toBe(false);
    expect(engine.hasTemporary("b")).toBe(true);
  });
});

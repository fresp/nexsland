import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// Reading a GSettings key that is not in the schema aborts gnome-shell, so every
// key the Bar module (lib/bar) touches must exist in its schema.

const ROOT = join(import.meta.dirname, "../..");
const BAR_DIR = join(ROOT, "lib/bar");
const SCHEMA = join(ROOT, "schemas/org.gnome.shell.extensions.nexsland.bar.gschema.xml");

const BASE_KEYS = [
  "bartype",
  "height",
  "margin",
  "bgcolor",
  "bgalpha",
  "iscolor",
  "isalpha",
  "fgcolor",
  "fgalpha",
  "bcolor",
  "balpha",
  "bwidth",
  "bradius",
  "neon",
  "heffect",
  "hcolor",
  "halpha",
  "shadow",
  "shcolor",
  "shalpha",
  "wmaxbar",
  "bgcolor-wmax",
  "bgalpha-wmax",
  "neon-wmax",
  "color-scheme",
  "trigger-reload",
  "reloadstyle",
  "pause-reload",
];
/** Keys with a stored value per light/dark mode. */
const MODE_KEYS = ["fgcolor", "bgcolor", "iscolor", "shcolor", "bcolor", "hcolor", "bgcolor-wmax"];
const EXPECTED_KEYS = [
  ...BASE_KEYS,
  ...MODE_KEYS.flatMap((key) => [`dark-${key}`, `light-${key}`]),
];

/** Keys of other schemas, by the receiver lib/bar reads them from. */
const OTHER_SCHEMAS = { _intSettings: ["color-scheme"] };

/** Non-literal key arguments, each covered below by a literal table. */
const DYNAMIC_KEY_ARGS = new Set(["key", "dark ? darkKey : lightKey"]);

// Receivers are Gio.Settings objects, which lib/bar always names *settings / *Settings.
const SETTINGS_METHOD =
  /(\w*[sS]ettings)\??\.(get_boolean|get_string|get_double|get_int|get_strv|get_value|set_boolean|set_string|set_double|set_int|set_strv|set_value|reset|bind)\(\s*([^,)]*)/g;

function schemaKeys() {
  const xml = readFileSync(SCHEMA, "utf8").replace(/<!--[\s\S]*?-->/g, "");
  return [...xml.matchAll(/<key\s+type="[^"]+"\s+name="([^"]+)"/g)].map((m) => m[1]);
}

function barSources() {
  return readdirSync(BAR_DIR)
    .filter((name) => name.endsWith(".js") && name !== "prefs.js")
    .map((name) => ({ name, code: readFileSync(join(BAR_DIR, name), "utf8") }));
}

const literal = (arg) => /^(["'`])([^"'`$]*)\1$/.exec(arg.trim())?.[2];

describe("bar schema", () => {
  it("has exactly the keys the bar styling uses", () => {
    expect(schemaKeys().sort()).toEqual([...EXPECTED_KEYS].sort());
  });
});

describe("lib/bar settings keys", () => {
  const keys = new Set(schemaKeys());
  const sources = barSources();

  it("finds settings calls to check", () => {
    const calls = sources.flatMap(({ code }) => [...code.matchAll(SETTINGS_METHOD)]);
    expect(calls.length).toBeGreaterThan(20);
  });

  it("reads and writes only keys in the schema", () => {
    const bad = [];
    for (const { name, code } of sources) {
      for (const [call, receiver, , arg] of code.matchAll(SETTINGS_METHOD)) {
        const key = literal(arg);
        if (key === undefined) {
          if (!DYNAMIC_KEY_ARGS.has(arg.trim())) bad.push(`${name}: non-literal key in ${call}`);
          continue;
        }
        const allowed = OTHER_SCHEMAS[receiver] ?? keys;
        if (!(Array.isArray(allowed) ? allowed.includes(key) : allowed.has(key)))
          bad.push(`${name}: ${call}`);
      }
      for (const [, key] of code.matchAll(/["'`]changed::([\w-]+)["'`]/g)) {
        if (!keys.has(key) && !Object.values(OTHER_SCHEMAS).flat().includes(key))
          bad.push(`${name}: changed::${key}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("covers the dynamic per-mode keys with literal tables that match the schema", () => {
    const bar = readFileSync(join(BAR_DIR, "bar.js"), "utf8");
    const table = /const MODE_COLOR_KEYS = \[([\s\S]*?)\n\];/.exec(bar)?.[1];
    expect(table).toBeDefined();
    const rows = [...table.matchAll(/\[\s*"([\w-]+)",\s*"([\w-]+)",\s*"([\w-]+)"\s*\]/g)];
    expect(rows.map((r) => r[1]).sort()).toEqual([...MODE_KEYS].sort());
    for (const [, key, dark, light] of rows) {
      expect([dark, light]).toEqual([`dark-${key}`, `light-${key}`]);
      for (const k of [key, dark, light]) expect(keys.has(k), k).toBe(true);
    }
  });

  it("only uses schema keys in extension.js's bar theme keys", () => {
    const ext = readFileSync(join(ROOT, "extension.js"), "utf8");
    const list = /const BAR_THEME_KEYS = \[([\s\S]*?)\];/.exec(ext)?.[1];
    expect(list).toBeDefined();
    const names = [...list.matchAll(/"([\w-]+)"/g)].map((m) => m[1]);
    expect(names.length).toBeGreaterThan(0);
    expect(names.filter((k) => !keys.has(k))).toEqual([]);
  });
});

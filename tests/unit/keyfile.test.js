import { describe, expect, it } from "vitest";

import { parseKeyfile, toKeyfile } from "../../lib/shared/keyfile.js";

describe("keyfile", () => {
  it("writes the dconf dump format", () => {
    expect(
      toKeyfile([
        ["bartype", "'Floating'"],
        ["height", "uint32 32"],
        ["palette1", "['255', '0', '0']"],
      ]),
    ).toBe("[/]\nbartype='Floating'\nheight=uint32 32\npalette1=['255', '0', '0']\n");
  });

  it("rejects keys and values that would corrupt the file", () => {
    expect(() => toKeyfile([["bad key", "1"]])).toThrow();
    expect(() => toKeyfile([["k", "'a\nb'"]])).toThrow();
  });

  it("reads the root section of a dconf dump, ignoring the rest", () => {
    const text = `# exported by Open Bar
[/]
bartype='Islands'
font='Cantarell 11'
formula='a=b'

[child]
ignored=true
`;
    expect([...parseKeyfile(text)]).toEqual([
      ["bartype", "'Islands'"],
      ["font", "'Cantarell 11'"],
      ["formula", "'a=b'"],
    ]);
  });

  it("round-trips and lets a later duplicate win", () => {
    const text = toKeyfile([
      ["a", "1"],
      ["b", "'x'"],
    ]);
    expect([...parseKeyfile(`${text}a=2\n`)]).toEqual([
      ["a", "2"],
      ["b", "'x'"],
    ]);
    expect(parseKeyfile("key=1\n").size).toBe(0); // no section
  });
});

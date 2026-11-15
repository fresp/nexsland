// Renders the README island style illustrations (docs/images/style-*.svg) from the real
// outline geometry. Run: node scripts/render-style-images.mjs
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
const repo = fileURLToPath(new URL("..", import.meta.url)).replace(/\/$/, "");
const { islandPath, outerSize } = await import(`${repo}/lib/engine/shape.js`);
const { notchSize, pillPlacement } = await import(`${repo}/lib/engine/placement.js`);

const W = 720,
  BAR = 35;
const f = (n) => Number(n.toFixed(2));
function toD(cmds) {
  let d = "";
  for (const c of cmds) {
    if (c.op === "move") d += `M${f(c.x)} ${f(c.y)}`;
    else if (c.op === "line") d += `L${f(c.x)} ${f(c.y)}`;
    else if (c.op === "close") d += "Z";
    else {
      const sx = c.xc + c.r * Math.cos(c.a1),
        sy = c.yc + c.r * Math.sin(c.a1);
      const ex = c.xc + c.r * Math.cos(c.a2),
        ey = c.yc + c.r * Math.sin(c.a2);
      d += `L${f(sx)} ${f(sy)}A${f(c.r)} ${f(c.r)} 0 0 ${c.op === "arc" ? 1 : 0} ${f(ex)} ${f(ey)}`;
    }
  }
  return d;
}
const FONT = `font-family="system-ui, -apple-system, 'Segoe UI', Cantarell, sans-serif"`;
function island(body, y, fill = "#000") {
  const outer = outerSize(body);
  const x = Math.round((W - outer.width) / 2);
  return {
    svg: `<path transform="translate(${x} ${y})" fill="${fill}" d="${toD(islandPath(body))}"/>`,
    x,
    y,
    outer,
  };
}
const clockText = (cy, fill = "#fff") =>
  `<text x="${W / 2}" y="${cy + 4.5}" ${FONT} font-size="13" font-weight="600" fill="${fill}" text-anchor="middle">Mon 16 Nov   09:41</text>`;
const wall = (h) =>
  `<defs><linearGradient id="w" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#31506b"/><stop offset="1" stop-color="#7a6a8f"/></linearGradient></defs><rect width="${W}" height="${h}" fill="url(#w)"/>`;
const solidBar = () =>
  `<rect width="${W}" height="${BAR}" fill="#25282e"/><text x="16" y="22" ${FONT} font-size="13" font-weight="600" fill="#eef0f2">Activities</text>` +
  [0, 1, 2]
    .map((i) => `<circle cx="${W - 22 - i * 20}" cy="17.5" r="5" fill="#eef0f2" opacity=".8"/>`)
    .join("");
const doc = (h, body, label) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${h}" width="${W}" height="${h}" role="img" aria-label="${label}">${wall(h)}${body}</svg>\n`;

const CLOCK = { width: 170, height: 28, radius: 14, ear: 6 };
const PANEL = { width: 460, height: 180, radius: 24, ear: 14 };
const out = {};

{
  // attached: hangs from the bar's bottom edge
  const i = island({ ...CLOCK, style: "attached" }, BAR);
  out["style-attached"] = doc(
    96,
    solidBar() + i.svg + clockText(BAR + 14),
    "Attached style: the island hangs below the top bar",
  );
}
{
  // notch: in the bar, from its top edge
  const s = notchSize({ target: CLOCK, barHeight: BAR });
  const i = island({ ...s, style: "attached" }, 0);
  out["style-notch"] = doc(
    96,
    solidBar() + i.svg + clockText(BAR / 2),
    "Notch style: the island sits in the top bar",
  );
}
{
  // floating: a pill below the bar (vertical-offset 6)
  const i = island({ ...CLOCK, style: "floating" }, BAR + 6);
  out["style-floating"] = doc(
    96,
    solidBar() + i.svg + clockText(BAR + 6 + 14),
    "Floating style: a pill below the top bar",
  );
}
{
  // Islands bar: the island takes the clock pill's place
  const pillH = 28,
    y = 7,
    fill = "#3b3f47";
  const anchor = { x: (W - 170) / 2, y, width: 170, height: pillH };
  const m = pillPlacement({ anchor, width: 0 });
  const body = { width: m.width, height: pillH, radius: pillH / 2, style: "floating" };
  const pills =
    `<rect x="11" y="${y}" width="110" height="${pillH}" rx="14" fill="${fill}"/><text x="66" y="${y + 18.5}" ${FONT} font-size="13" font-weight="600" fill="#eef0f2" text-anchor="middle">Activities</text>` +
    `<rect x="${W - 11 - 90}" y="${y}" width="90" height="${pillH}" rx="14" fill="${fill}"/>` +
    [0, 1, 2]
      .map(
        (i) => `<circle cx="${W - 36 - i * 20}" cy="${y + 14}" r="5" fill="#eef0f2" opacity=".8"/>`,
      )
      .join("");
  const isl = `<path transform="translate(${m.x} ${m.y})" fill="${fill}" d="${toD(islandPath(body))}"/>`;
  out["style-islands-bar"] = doc(
    96,
    pills + isl + clockText(y + 14),
    "On an Islands bar the island takes the clock pill's place",
  );
}
{
  // notch, open: the panel grows down from the same edge
  const s = notchSize({ target: PANEL, barHeight: BAR });
  const i = island({ ...s, style: "attached" }, 0);
  const left = i.x + i.outer.ear,
    right = left + s.width;
  const tabs = [0, 1, 2, 3, 4]
    .map(
      (k) =>
        `<circle cx="${right - 26 - k * 26}" cy="20" r="6.5" fill="${k === 4 ? "#fff" : "none"}" stroke="#fff" stroke-width="1.4" opacity="${k === 4 ? 1 : 0.6}"/>`,
    )
    .join("");
  const body =
    `<text x="${left + 20}" y="25" ${FONT} font-size="15" font-weight="700" fill="#fff">09:41</text>` +
    `<text x="${left + 68}" y="25" ${FONT} font-size="11" fill="#9aa1aa">Mon, Nov 16</text>` +
    tabs +
    `<text x="${W / 2}" y="104" ${FONT} font-size="14" font-weight="600" fill="#fff" text-anchor="middle">Nothing active</text>` +
    `<text x="${W / 2}" y="124" ${FONT} font-size="12" fill="#9aa1aa" text-anchor="middle">Media, timers and recordings show up here</text>`;
  out["style-notch-open"] = doc(
    220,
    solidBar() + i.svg + body,
    "Notch style, open: the panel grows down from the top edge",
  );
}
for (const [name, svg] of Object.entries(out))
  writeFileSync(`${repo}/docs/images/${name}.svg`, svg);
console.log(Object.keys(out).join(" "));

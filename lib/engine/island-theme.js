/*
 * This file is part of the Nexsland GNOME extension.
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The island's colours, GI-free. By default the island is black with white text.
 * With the Bar module on, it takes the bar's background, foreground and border
 * (Open Bar keys: colours are string triplets of 0-1 floats, alpha separate), so
 * the island reads as part of the bar.
 */

/**
 * @typedef {[number, number, number, number]} RGBA 0-1 channels
 * @typedef {{ fill: RGBA, fg: RGBA, border: { color: RGBA, width: number } | null,
 *   glow: { color: RGBA, size: number, wmax: boolean } | null,
 *   hover: { color: RGBA, width: number, glow: RGBA } | null, light: boolean }} IslandTheme
 *   glow.wmax: keep glowing while a window is maximized (Open Bar's neon-wmax);
 *   hover: border (colour and width) and glow colour while hovered (Open Bar's hover effect)
 */

/** @type {IslandTheme} */
export const DEFAULT_THEME = Object.freeze({
  fill: [0, 0, 0, 1],
  fg: [1, 1, 1, 1],
  border: null,
  glow: null,
  hover: null,
  light: false,
});

/** Below this the island's text would sit on the wallpaper, unreadable. */
export const MIN_FILL_ALPHA = 0.85;
const MIN_FG_ALPHA = 0.6;
const MAX_BORDER_WIDTH = 6;
const DEFAULT_BAR_HEIGHT = 35; // Open Bar's default "height"
/** Open Bar's neon: box-shadow 0 0 4px (spread up to 2px) in the border colour at 0.55. */
export const GLOW_SIZE = 6;
const GLOW_ALPHA = 0.55;

const clamp01 = (v) => Math.min(1, Math.max(0, v));

/** ["0.125", "0.5", "1"] -> [0.125, 0.5, 1], or null when malformed. */
export function parseRgb(strv) {
  if (!Array.isArray(strv) || strv.length < 3) return null;
  const rgb = strv.slice(0, 3).map(Number);
  return rgb.every(Number.isFinite) ? rgb.map(clamp01) : null;
}

/** WCAG relative luminance of an sRGB colour with 0-1 channels. */
export function relativeLuminance([r, g, b]) {
  const lin = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/**
 * @param {{
 *   bartype?: string, bgcolor?: string[], bgalpha?: number, iscolor?: string[], isalpha?: number,
 *   fgcolor?: string[], fgalpha?: number, bcolor?: string[], balpha?: number, bwidth?: number,
 *   neon?: boolean, "neon-wmax"?: boolean, heffect?: boolean, hcolor?: string[], halpha?: number,
 *   height?: number,
 * }} bar Open Bar settings values
 * @returns {IslandTheme}
 */
export function themeFromBar(bar) {
  // Islands/Trilands bars draw their background on the islands, not the bar.
  const islands = bar.bartype === "Islands" || bar.bartype === "Trilands";
  const bg = parseRgb(islands ? bar.iscolor : bar.bgcolor);
  if (!bg) return DEFAULT_THEME;
  const bgAlpha = Number(islands ? bar.isalpha : bar.bgalpha);
  const fill = /** @type {RGBA} */ ([
    ...bg,
    Math.max(MIN_FILL_ALPHA, Number.isFinite(bgAlpha) ? clamp01(bgAlpha) : 1),
  ]);
  const light = relativeLuminance(bg) > 0.5;

  const fgRgb = parseRgb(bar.fgcolor) ?? (light ? [0, 0, 0] : [1, 1, 1]);
  const fgAlpha = Number(bar.fgalpha);
  const fg = /** @type {RGBA} */ ([
    ...fgRgb,
    Math.max(MIN_FG_ALPHA, Number.isFinite(fgAlpha) ? clamp01(fgAlpha) : 1),
  ]);

  const bRgb = parseRgb(bar.bcolor);
  const bAlpha = Number(bar.balpha);
  const bWidth = Number(bar.bwidth);
  const border =
    bRgb && bWidth > 0 && bAlpha > 0
      ? {
          color: /** @type {RGBA} */ ([...bRgb, clamp01(bAlpha)]),
          width: Math.min(MAX_BORDER_WIDTH, bWidth),
        }
      : null;

  // Neon glows in the border colour even when the border itself is off.
  const glow =
    bar.neon && bRgb
      ? {
          color: /** @type {RGBA} */ ([...bRgb, GLOW_ALPHA]),
          size: GLOW_SIZE,
          wmax: Boolean(bar["neon-wmax"]),
        }
      : null;

  // Hover effect: a border in the hover colour, a tenth of the bar's height thick
  // (even when the bar has no border), and the glow in the hover colour too.
  const hRgb = bar.heffect ? parseRgb(bar.hcolor) : null;
  const hAlpha = Number(bar.halpha);
  const barHeight = Number(bar.height);
  const hover = hRgb
    ? {
        color: /** @type {RGBA} */ ([...hRgb, Number.isFinite(hAlpha) ? clamp01(hAlpha) : 1]),
        width: Math.min(
          MAX_BORDER_WIDTH,
          (Number.isFinite(barHeight) && barHeight > 0 ? barHeight : DEFAULT_BAR_HEIGHT) / 10,
        ),
        glow: /** @type {RGBA} */ ([...hRgb, GLOW_ALPHA]),
      }
    : null;

  return { fill, fg, border, glow, hover, light };
}

/** "rgba(r, g, b, a)" with 0-255 channels, for St inline styles. */
export function cssRgba([r, g, b, a]) {
  const c = (v) => Math.round(clamp01(v) * 255);
  return `rgba(${c(r)}, ${c(g)}, ${c(b)}, ${Number(clamp01(a).toFixed(3))})`;
}

/* utils.js
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 2 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 * author: neuromorph
 */

/* exported all functions  */

// Nexsland: only the colour helpers the bar stylesheet uses are kept; the rest
// served the wallpaper auto-themes and menu styles.

// Brightness of color in terms of HSP value
export function getHSP(color, g, b) {
  let r;
  if (g) r = color;
  else [r, g, b] = [color[0], color[1], color[2]];
  // HSP equation for perceived brightness from http://alienryderflex.com/hsp.html
  let hsp = Math.sqrt(0.299 * (r * r) + 0.587 * (g * g) + 0.114 * (b * b));
  return hsp;
}

export function getColorfulness(color) {
  // We consider greater difference between the R, G, B values to indicate colorfulness
  // while similar values for R,G,B to indicate greyscale
  let [r, g, b] = [parseInt(color[0]), parseInt(color[1]), parseInt(color[2])];
  let colorfulness = Math.max(r, g, b) - Math.min(r, g, b);
  return colorfulness;
}

// Called separately for R,G and B. Moves startColor towards or away from endColor
export function colorMix(startColor, endColor, factor) {
  let color = startColor + factor * (endColor - startColor);
  color = color < 0 ? 0 : color > 255 ? 255 : parseInt(color);
  return color;
}

// Check if Dark or Light color as per HSP threshold
export function getBgDark(r, g, b) {
  let hsp = getHSP(r, g, b);
  if (hsp > 155) return false;
  else return true;
}

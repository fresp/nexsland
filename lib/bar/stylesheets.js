/* stylesheets.js
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

/* exported reloadStyle() */

import Gio from "gi://Gio";
import GLib from "gi://GLib";
import * as Utils from "./utils.js";

Gio._promisify(Gio.File.prototype, "replace_async", "replace_finish");
Gio._promisify(Gio.OutputStream.prototype, "write_bytes_async", "write_bytes_finish");

const colorMix = Utils.colorMix;
const getHSP = Utils.getHSP;
const getBgDark = Utils.getBgDark;

// Nexsland: the bar only styles the top bar and its buttons. Open Bar settings that
// were removed are fixed at the value their schema default had:
const BORDER_TYPE = "solid"; // bordertype
const H_PAD = 1; // hpad
const V_PAD = 4; // vpad
const FONT_WEIGHT = 400; // font "" (theme font), autotheme-font false
// Nexsland: off, so the Look page's Text colour (fgcolor) styles the bar; Open Bar's
// default (autofg-bar on) picked 250/5 grey from the background's darkness instead.
const AUTO_FG_BAR = false; // autofg-bar
const AUTO_HG_BAR = true; // autohg-bar: hover background derived from the background
// destruct-color ['0.75', '0.11', '0.16'] and warning-color ['0.96', '0.83', '0.17'] as 0-255
const DESTRUCT_RGB = [191, 28, 40];
const WARNING_RGB = [244, 211, 43];

// Nexsland: menu, notification, dash, candybar and GTK styling and their SVG
// assets are not carried over; only the panel stylesheet is generated.

function parseRGB(rgb) {
  rgb = rgb < 0 ? 0 : rgb > 255 ? 255 : Math.round(rgb);
  return rgb;
}

// Generate stylesheet string and save stylesheet file
function getStylesheet(obar, Me) {
  let bartype = obar._settings.get_string("bartype");
  let bgcolor = obar._settings.get_strv("bgcolor");
  let bgalpha = obar._settings.get_double("bgalpha");
  let fgcolor = obar._settings.get_strv("fgcolor");
  let fgalpha = obar._settings.get_double("fgalpha");
  let borderColor = obar._settings.get_strv("bcolor");
  let balpha = obar._settings.get_double("balpha");
  let borderWidth = obar._settings.get_double("bwidth");
  let borderRadius = obar._settings.get_double("bradius");
  let shcolor = obar._settings.get_strv("shcolor");
  let shalpha = obar._settings.get_double("shalpha");
  let islandsColor = obar._settings.get_strv("iscolor");
  let isalpha = obar._settings.get_double("isalpha");
  let neon = obar._settings.get_boolean("neon");
  let shadow = obar._settings.get_boolean("shadow");
  let height = obar._settings.get_double("height");
  let margin = obar._settings.get_double("margin");
  let hColor = obar._settings.get_strv("hcolor");
  let hAlpha = obar._settings.get_double("halpha");
  let hovereffect = obar._settings.get_boolean("heffect");
  let bgcolorWMax = obar._settings.get_strv("bgcolor-wmax");
  let bgalphaWMax = obar._settings.get_double("bgalpha-wmax");
  let neonWMax = obar._settings.get_boolean("neon-wmax");
  const hPad = H_PAD;
  const vPad = V_PAD;

  const [destructRed, destructGreen, destructBlue] = DESTRUCT_RGB;
  const [warningRed, warningGreen, warningBlue] = WARNING_RGB;

  let fgred = parseInt(parseFloat(fgcolor[0]) * 255);
  let fggreen = parseInt(parseFloat(fgcolor[1]) * 255);
  let fgblue = parseInt(parseFloat(fgcolor[2]) * 255);

  const bgred = parseInt(parseFloat(bgcolor[0]) * 255);
  const bggreen = parseInt(parseFloat(bgcolor[1]) * 255);
  const bgblue = parseInt(parseFloat(bgcolor[2]) * 255);

  let bgredwmax = parseInt(parseFloat(bgcolorWMax[0]) * 255);
  let bggreenwmax = parseInt(parseFloat(bgcolorWMax[1]) * 255);
  let bgbluewmax = parseInt(parseFloat(bgcolorWMax[2]) * 255);

  const isred = parseInt(parseFloat(islandsColor[0]) * 255);
  const isgreen = parseInt(parseFloat(islandsColor[1]) * 255);
  const isblue = parseInt(parseFloat(islandsColor[2]) * 255);

  const bred = parseInt(parseFloat(borderColor[0]) * 255);
  const bgreen = parseInt(parseFloat(borderColor[1]) * 255);
  const bblue = parseInt(parseFloat(borderColor[2]) * 255);

  const shred = parseInt(parseFloat(shcolor[0]) * 255);
  const shgreen = parseInt(parseFloat(shcolor[1]) * 255);
  const shblue = parseInt(parseFloat(shcolor[2]) * 255);

  const hred = parseInt(parseFloat(hColor[0]) * 255);
  const hgreen = parseInt(parseFloat(hColor[1]) * 255);
  const hblue = parseInt(parseFloat(hColor[2]) * 255);

  // Auto Highlight BG colors
  let hgColor,
    bgColor,
    bgLightThresh = 180;

  function getAutoHgColor(bgColor) {
    let bgHsp = getHSP(bgColor);
    let bgSat = Utils.getColorfulness(bgColor);
    let grayFactor = (255 - bgSat) / 255;
    let rgb;
    if (bgHsp <= bgLightThresh) {
      rgb = bgHsp + 40 + 80 * grayFactor;
    } else {
      rgb = bgHsp - 40 - 100 * grayFactor;
    }
    rgb = parseRGB(rgb);
    hgColor = [rgb, rgb, rgb];
    // console.log('getAutoHgColor: hgColor, bgColor, bgHsp ', hgColor, bgColor, bgHsp);
    return hgColor;
  }

  // Bar Auto Highlight
  hgColor = [hred, hgreen, hblue];
  bgColor = [bgred, bggreen, bgblue];
  if (AUTO_HG_BAR) hgColor = getAutoHgColor(bgColor);

  let hbgred = hgColor[0];
  let hbggreen = hgColor[1];
  let hbgblue = hgColor[2];
  let phbg = `rgba(${hbgred},${hbggreen},${hbgblue},${hAlpha})`;

  // Island Auto Highlight
  hgColor = [hred, hgreen, hblue];
  bgColor = [isred, isgreen, isblue];
  if (AUTO_HG_BAR) hgColor = getAutoHgColor(bgColor);

  let ishbgred = parseRGB(isred * (1 - hAlpha) + hgColor[0] * hAlpha);
  let ishbggreen = parseRGB(isgreen * (1 - hAlpha) + hgColor[1] * hAlpha);
  let ishbgblue = parseRGB(isblue * (1 - hAlpha) + hgColor[2] * hAlpha);
  let ihbg = `rgba(${ishbgred},${ishbggreen},${ishbgblue},${1.0})`;

  ///// FG COLORS for BAR
  // Bar highlight fg color
  let hfgred, hfggreen, hfgblue;
  if (bartype == "Mainland" || bartype == "Floating") {
    hfgred = colorMix(fgred, hbgred, -0.12);
    hfggreen = colorMix(fggreen, hbggreen, -0.12);
    hfgblue = colorMix(fgblue, hbgblue, -0.12);
  } else {
    hfgred = colorMix(fgred, ishbgred, -0.12);
    hfggreen = colorMix(fggreen, ishbggreen, -0.12);
    hfgblue = colorMix(fgblue, ishbgblue, -0.12);
  }
  if (AUTO_FG_BAR) {
    // Bar auto fg color
    let dark;
    if (bartype == "Mainland" || bartype == "Floating") dark = getBgDark(bgred, bggreen, bgblue);
    else dark = getBgDark(isred, isgreen, isblue);
    if (dark) {
      fgred = fggreen = fgblue = 250;
      hfgred = hfggreen = hfgblue = 255;
    } else {
      fgred = fggreen = fgblue = 5;
      hfgred = hfggreen = hfgblue = 0;
    }
  }

  //== Define Styles for Bar components ==//

  let fgStyle,
    panelStyle,
    panelLabelStyle,
    btnStyle,
    btnContainerStyle,
    borderStyle,
    radiusStyle,
    islandStyle,
    dotStyle,
    neonStyle,
    triLeftStyle,
    triBothStyle,
    triRightStyle,
    triMidStyle,
    triMidNeonStyle,
    btnHoverStyle;

  // style that applies dynamically to either the panel or the panel buttons as per bar type
  // Nexsland: per-side border widths and per-corner radii are always on.
  borderStyle = ` border: ${borderWidth}px ${BORDER_TYPE} rgba(${bred},${bgreen},${bblue},${balpha}); `;

  if ((bartype == "Islands" || bartype == "Trilands") && neon) {
    // Limit on max border radius (border grows inwards for Islands. '-1' for sub-pixel rounding)
    // Limit is needed for proper rendering of border and neon shadow
    let bWidthRound = Math.ceil(borderWidth);
    if (borderRadius > height / 2 - bWidthRound - 1)
      borderRadius = Math.floor(height / 2 - bWidthRound - 1);
  }
  radiusStyle = ` border-radius: ${borderRadius}px ${borderRadius}px ${borderRadius}px ${borderRadius}px !important; `;

  // foreground style needed for both panel and buttons (all bar types)
  fgStyle = ` color: rgba(${fgred},${fggreen},${fgblue},${fgalpha}) !important; `;

  // panel style for panel only (all bar types)
  panelStyle = ` background-color: rgba(${bgred},${bggreen},${bgblue},${bgalpha}) !important;
      height: ${height}px !important; `;

  panelStyle += ` ${radiusStyle} `;

  // button style for buttons only (all bar types)
  btnStyle = ` margin: 0px; height: ${height}px !important; `;

  // island style for buttons (only island bar type)
  islandStyle = ` background-color: rgba(${isred},${isgreen},${isblue},${isalpha}) !important; `;

  // Triland style for left end btn of box (only triland bar type)
  triLeftStyle = ` border-radius: ${borderRadius}px 0px 0px ${borderRadius}px !important; `;
  // Triland style for single btn box (only triland bar type)
  triBothStyle = ` ${radiusStyle} `;
  // Triland style for right end btn of box (only triland bar type)
  triRightStyle = ` border-radius: 0px ${borderRadius}px ${borderRadius}px 0px !important; `;
  // Triland style for middle btns of box (only triland bar type)
  triMidStyle = ` border-radius: 0px !important; `;

  // Workspace dots style
  dotStyle = ` background-color: rgba(${fgred},${fggreen},${fgblue},${fgalpha}) !important; `;

  // Nexsland: no custom bar font; the theme's font at Open Bar's default weight.
  panelLabelStyle = `   font-weight: ${FONT_WEIGHT}; `;

  // Box shadow not working with rectangular box (for smaller radius), why Gnome??
  // Fix: Negative/low spread to try to contain it in that range. Range depends on bar height
  // padmod: modify formula to account for container padding in islands/trilands
  let padmod = bartype == "Mainland" || bartype == "Floating" ? -2 : vPad;
  let radThreshold = Math.ceil(((height - 2 * padmod) / 10.0 - 1) * 5);

  // Add the neon style if enabled
  // Nexsland: no gradient, so the neon spread is never reduced for it.
  if (neon) {
    let spread;
    if (borderRadius <= radThreshold || borderRadius == 0) spread = 0;
    else spread = 2;

    neonStyle = ` box-shadow: 0px 0px 4px ${spread}px rgba(${bred},${bgreen},${bblue},0.55); `;

    triMidNeonStyle = ` box-shadow: 0px 0px 4px 0px rgba(${bred},${bgreen},${bblue},0.55); `;
  } else {
    neonStyle = ``;
    triMidNeonStyle = ``;
  }
  triMidStyle += triMidNeonStyle;

  // Panel hover/focus style
  let triMidNeonHoverStyle = ``;
  if (hovereffect) {
    // Hover with border
    btnHoverStyle = ` border: ${height / 10.0}px solid rgba(${hred},${hgreen},${hblue},${hAlpha}) !important; `;
    if (neon && (bartype == "Islands" || bartype == "Trilands")) {
      btnHoverStyle += neonStyle.replace(
        `${bred},${bgreen},${bblue}`,
        `${hred},${hgreen},${hblue}`,
      );
      triMidNeonHoverStyle += triMidNeonStyle.replace(
        `${bred},${bgreen},${bblue}`,
        `${hred},${hgreen},${hblue}`,
      );
    }
  } else {
    if (bartype == "Mainland" || bartype == "Floating")
      btnHoverStyle = ` background-color: ${phbg} !important; `;
    else btnHoverStyle = ` background-color: ${ihbg} !important; `;
  }
  if (bartype == "Mainland" || bartype == "Floating" || !neon) {
    btnHoverStyle += ` box-shadow: none !important; `;
  }

  // Add panel shadow if enabled. Use alpha to decide offset, blur, spread and alpha
  if (shadow) {
    if (borderRadius < radThreshold) {
      panelStyle += ` box-shadow: 0px ${shalpha * 10}px ${1.5 + shalpha * 15}px ${shalpha * 10}px rgba(${shred},${shgreen},${shblue}, ${0.85 * shalpha}); `;
    } else {
      panelStyle += ` box-shadow: 0px ${shalpha * 10}px ${1.5 + shalpha * 15}px ${shalpha * 20}px rgba(${shred},${shgreen},${shblue}, ${0.85 * shalpha}); `;
    }
  } else {
    panelStyle += ` box-shadow: none; `;
  }

  // Nexsland: the bar is always at the top, without a separate bottom margin.
  if (bartype == "Mainland") {
    panelStyle += ` margin: 0px; border-radius: 0px; `;
  }
  if (bartype == "Floating") {
    panelStyle += ` margin: ${margin}px ${3 * margin}px; `;
  }
  if (bartype == "Islands" || bartype == "Trilands") {
    panelStyle += ` margin: ${margin}px ${1.5 * margin}px; `;
    panelStyle += ` ${fgStyle} `;

    btnStyle += ` ${borderStyle}
          ${radiusStyle}
          ${fgStyle}
          ${islandStyle}
          ${neonStyle} `;

    btnContainerStyle = ` padding: ${vPad}px ${hPad}px;
          margin: 0px 0px;
          border-radius: ${borderRadius + borderWidth}px; `;
  } else {
    panelStyle += ` ${fgStyle}
          ${borderStyle}
          ${neonStyle} `;

    btnStyle += ` ${fgStyle}
          border-radius: ${Math.max(borderRadius, 5)}px;
          border-width: 0px; `;

    btnContainerStyle = ` padding: ${borderWidth + vPad}px ${borderWidth + hPad}px;
          margin: 0px 0px;
          border-radius: ${borderRadius + borderWidth}px; `;
  }

  // Overview style (reset): the bar is not styled in the Overview.
  // Nexsland: set-overview and apply-all-shell removed (both were off by default).
  const oFgColor = `rgba(230, 230, 230, 1.0)`;
  const oHFgColor = `rgba(255, 255, 255, 1.0)`;
  const oHBgColor = `rgba(180, 180, 180, ${hAlpha})`;
  const overviewStyle = `   background-color: transparent !important;
            border-color: transparent !important;
            box-shadow: none !important;
            color: ${oFgColor} !important; `;
  const barFgOverview = `   color: ${oFgColor} !important;`;
  const barHFgOverview = `   color: ${oHFgColor} !important;`;
  const barHBgOverview = `   background-color: ${oHBgColor} !important;`;
  const dotOverview = `   background-color: ${oFgColor} !important;`;

  // Nexsland: the window-maximized bar keeps the island backgrounds, no border
  // and the bar's margin (buttonbg-wmax on, border-wmax and cust-margin-wmax off).
  let wmaxBgColorStyle = `background-color: rgba(${bgredwmax},${bggreenwmax},${bgbluewmax},${bgalphaWMax}) !important;
     border-color: rgba(${bgredwmax},${bggreenwmax},${bgbluewmax},${bgalphaWMax}) !important;
    `;
  let wmaxColorStyle, wmaxHoverStyle, wmaxDotStyle;
  if (bartype == "Mainland" || bartype == "Floating") {
    if (getBgDark(bgredwmax, bggreenwmax, bgbluewmax)) {
      wmaxColorStyle = `color: rgba(250,250,250,1.0) !important; `;
      wmaxDotStyle = `background-color: rgba(250,250,250,1.0) !important; `;
    } else {
      wmaxColorStyle = `color: rgba(5,5,5,1.0) !important; `;
      wmaxDotStyle = `background-color: rgba(5,5,5,1.0) !important; `;
    }
    let hgColor = [hred, hgreen, hblue],
      bgColor = [bgredwmax, bggreenwmax, bgbluewmax];
    if (AUTO_HG_BAR) hgColor = getAutoHgColor(bgColor);
    // WMax Highlight BG
    wmaxHoverStyle = `background-color: rgba(${hgColor[0]},${hgColor[1]},${hgColor[2]},${hAlpha}) !important; `;
  } else {
    wmaxColorStyle = ``;
    wmaxDotStyle = ``;
    wmaxHoverStyle = ``;
  }

  const heightWMax = height + 2 * margin;
  const marginWMax = margin;

  // Unlock Dialog
  let unlockStyle, unlockHoverStyle;
  if (obar.main.sessionMode.isLocked) {
    unlockStyle = `background-color: transparent !important;
         border-color: transparent !important;
         color: rgba(255,255,255,1.0) !important;
         box-shadow: none !important;
         transition-duration: 150ms;`;
  } else {
    unlockStyle = ``;
  }
  if (obar.main.sessionMode.isLocked) {
    unlockHoverStyle = `color: rgba(255,255,255,1.0) !important;`;
  } else {
    unlockHoverStyle = ``;
  }

  // Placeholder for .openbar class
  let openbarClass = ".openbar";

  // Create Stylesheet string to write to file
  let stylesheet = `
    /* OpenBar stylesheet.css
    * This file is autogenerated. Do Not Edit.
    *
    * SPDX-License-Identifier: GPL-2.0-or-later
    * author: neuromorph
    */
    `;

  // Panel and buttons styles
  stylesheet += `

        #panelBox${openbarClass} {
           background-color: transparent !important;
        }

        #panel${openbarClass} #panelLeft {
            margin-left: ${vPad}px;
        }
        #panel${openbarClass} #panelRight {
            margin-right: ${vPad}px;
        }

        #panel${openbarClass} {
            ${panelStyle}
            ${unlockStyle}
        }

        #panel${openbarClass} StLabel {
            ${panelLabelStyle}
        }

        #panel${openbarClass}:windowmax {
            border-radius: 0px !important;
            border-width: 0px !important;
            box-shadow: none !important;
            margin: 0px !important;
            height: ${heightWMax}px !important;
            ${wmaxBgColorStyle}
            ${wmaxColorStyle}
            ${unlockStyle}
        }

        #panel${openbarClass} .button-container {
            ${btnContainerStyle}
        }
        #panel${openbarClass}:windowmax .button-container {
            margin: ${marginWMax}px 0px;
            padding: ${vPad}px ${hPad}px;
        }

        #panel${openbarClass} .panel-button {
            box-shadow: none;
            ${btnStyle}
            color: rgba(${fgred},${fggreen},${fgblue},${fgalpha});
            ${unlockStyle}
        }
        #panel${openbarClass}:windowmax .panel-button {
            border-color: rgba(${bgredwmax},${bggreenwmax},${bgbluewmax},${bgalphaWMax});
            ${neonWMax ? "" : "box-shadow: none;"}
            ${wmaxColorStyle}
        }

        #panel${openbarClass}:overview, #panel${openbarClass}:overview .panel-button {
            ${overviewStyle}
        }

        #panel${openbarClass}:overview:windowmax {
            ${overviewStyle}
        }


        #panel${openbarClass} .panel-button:hover, #panel${openbarClass} .panel-button:focus,
        #panel${openbarClass} .panel-button:active, #panel${openbarClass} .panel-button:checked {
            ${btnHoverStyle}
            color: rgba(${hfgred},${hfggreen},${hfgblue},${fgalpha}) !important;
            ${unlockHoverStyle}
        }
        #panel${openbarClass}:windowmax .panel-button:hover, #panel${openbarClass}:windowmax .panel-button:focus,
        #panel${openbarClass}:windowmax .panel-button:active, #panel${openbarClass}:windowmax .panel-button:checked {
            ${wmaxColorStyle}
            ${wmaxHoverStyle}
        }
        #panel${openbarClass}:overview .panel-button:hover, #panel${openbarClass}:overview .panel-button:focus,
        #panel${openbarClass}:overview .panel-button:checked, #panel${openbarClass}:overview .panel-button:active,
        #panel${openbarClass}:overview .panel-button:overview {
            ${btnHoverStyle}
            ${barHFgOverview}
            ${barHBgOverview}
        }

        #panel${openbarClass} .panel-button.clock-display .clock {
            color: rgba(${fgred},${fggreen},${fgblue},${fgalpha}) !important;
            border: none; padding: 0px 6px; text-align: center;
            height: ${height}px !important;
        }
        #panel${openbarClass}:windowmax .panel-button.clock-display .clock {
            ${wmaxColorStyle}
        }
        #panel${openbarClass}:overview .panel-button.clock-display .clock {
            ${barFgOverview}
        }

        #panel${openbarClass} .panel-button:hover.clock-display .clock, #panel${openbarClass} .panel-button:focus.clock-display .clock,
        #panel${openbarClass} .panel-button:active.clock-display .clock, #panel${openbarClass} .panel-button:checked.clock-display .clock {
            color: rgba(${hfgred},${hfggreen},${hfgblue},1.0) !important;
        }
        #panel${openbarClass}:windowmax .panel-button:hover.clock-display .clock, #panel${openbarClass}:windowmax .panel-button:focus.clock-display .clock,
        #panel${openbarClass}:windowmax .panel-button:active.clock-display .clock, #panel${openbarClass}:windowmax .panel-button:checked.clock-display .clock {
            ${wmaxColorStyle}
        }
        #panel${openbarClass}:overview .panel-button:hover.clock-display .clock, #panel${openbarClass}:overview .panel-button:focus.clock-display .clock,
        #panel${openbarClass}:overview .panel-button:active.clock-display .clock, #panel${openbarClass}:overview .panel-button:checked.clock-display .clock {
            ${barHFgOverview}
        }

        #panel${openbarClass} .panel-button.clock-display .clock, #panel${openbarClass} .panel-button:hover.clock-display .clock,
        #panel${openbarClass} .panel-button:active.clock-display .clock, #panel${openbarClass} .panel-button:overview.clock-display .clock,
        #panel${openbarClass} .panel-button:focus.clock-display .clock, #panel${openbarClass} .panel-button:checked.clock-display .clock {
            background-color: transparent !important;
            box-shadow: none !important;
        }

        #panel${openbarClass} .panel-button.screen-recording-indicator, #panel${openbarClass}:windowmax .panel-button.screen-recording-indicator {
            transition-duration: 150ms;
            font-weight: bold;
            background-color: rgba(${destructRed},${destructGreen},${destructBlue}, 0.8) !important;
            box-shadow: none !important;
            color: rgba(255,255,255,1.0) !important;
        }
        #panel${openbarClass} .panel-button.screen-sharing-indicator, #panel${openbarClass}:windowmax .panel-button.screen-sharing-indicator,
        #panel${openbarClass} .screencast-indicator, #panel${openbarClass}:windowmax .screencast-indicator,
        #panel${openbarClass} .remote-access-indicator, #panel${openbarClass}:windowmax .remote-access-indicator {
            transition-duration: 150ms;
            font-weight: bold;
            background-color: rgba(${(destructRed + warningRed) / 2},${(destructGreen + warningGreen) / 2},${(destructBlue + warningBlue) / 2}, 0.9) !important;
            box-shadow: none !important;
            color: rgba(255,255,255,1.0) !important;
        }

        #panel${openbarClass} .workspace-dot {
            ${dotStyle}
        }
        #panel${openbarClass}:overview .workspace-dot {
            ${dotOverview}
        }
        #panel${openbarClass}:windowmax .workspace-dot {
            ${wmaxDotStyle}
        }


        #panel${openbarClass}.trilands .panel-button {
            ${triMidStyle}
        }
        #panel${openbarClass}.trilands .button-container:first-child .panel-button {
            ${triLeftStyle}
        }
        #panel${openbarClass}.trilands .button-container:last-child .panel-button {
            ${triRightStyle}
        }
        #panel${openbarClass}.trilands .button-container:first-child:last-child .panel-button {
            ${triBothStyle}
        }

        #panel${openbarClass}.trilands:overview .panel-button {
            box-shadow: none;
        }
        #panel${openbarClass}.trilands:windowmax .panel-button {
            ${neonWMax ? "" : "box-shadow: none;"}
        }
        #panel${openbarClass}.trilands .panel-button:hover, #panel${openbarClass}.trilands .panel-button:focus,
        #panel${openbarClass}.trilands .panel-button:active, #panel${openbarClass}.trilands .panel-button:checked {
            ${triMidNeonHoverStyle}
        }
        #panel${openbarClass}.trilands:overview .panel-button:hover, #panel${openbarClass}.trilands:overview .panel-button:focus,
        #panel${openbarClass}.trilands:overview .panel-button:active, #panel${openbarClass}.trilands:overview .panel-button:checked {
            box-shadow: none;
        }
        #panel${openbarClass}.trilands:windowmax .panel-button:hover, #panel${openbarClass}.trilands:windowmax .panel-button:focus,
        #panel${openbarClass}.trilands:windowmax .panel-button:active, #panel${openbarClass}.trilands:windowmax .panel-button:checked {
            ${neonWMax ? "" : "box-shadow: none;"}
        }

    `;

  return stylesheet;
}

async function writeStylesheet(obar, stylesheet) {
  let stylepath = obar.obarRunDir.get_path() + "/stylesheet.css";
  let file = Gio.File.new_for_path(stylepath);
  let bytearray = new TextEncoder().encode(stylesheet);

  try {
    let stream = await file.replace_async(
      null,
      false,
      Gio.FileCreateFlags.NONE,
      GLib.PRIORITY_DEFAULT,
      null,
    );
    await stream.write_bytes_async(bytearray, GLib.PRIORITY_DEFAULT, null);
    stream.close(null);
  } catch (e) {
    console.log("Failed to write stylsheet file: " + stylepath, e);
  }
}

export async function reloadStyle(obar, Me) {
  // Nexsland: no import-export pause (prefs import/export is not carried over).
  const pauseStyleReload = obar._settings.get_boolean("pause-reload");
  if (pauseStyleReload) return;
  // Get stylesheet string
  let stylesheet = getStylesheet(obar, Me);
  try {
    await writeStylesheet(obar, stylesheet);
  } catch (e) {
    console.log("Failed to reload stylesheet: ", e);
  }

  // Cause stylesheet to reload by toggling 'reloadstyle'
  let reloadstyle = obar._settings.get_boolean("reloadstyle");
  if (reloadstyle) obar._settings.set_boolean("reloadstyle", false);
  else obar._settings.set_boolean("reloadstyle", true);
}

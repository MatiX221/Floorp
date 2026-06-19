/* -*- indent-tabs-mode: nil; js-indent-level: 2 -*-
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import type { zFloorpDesignConfigs } from "../../designs/type.ts";
import type * as t from "io-ts";

// UserJS imports
import leptonUserJs from "@nora/skin/lepton/userjs/lepton.js?raw";
import photonUserJs from "@nora/skin/lepton/userjs/photon.js?raw";
import protonfixUserJs from "@nora/skin/lepton/userjs/protonfix.js?raw";

// CSS raw imports for development
import leptonChromeStylesRaw from "@nora/skin/lepton/css/leptonChrome.css?raw";
import leptonContentStylesRaw from "@nora/skin/lepton/css/leptonContent.css?raw";
import fluerialStylesRaw from "@nora/skin/fluerial/css/fluerial.css?raw";
import {
  FLUERIAL_TAB_CORNER_CSS,
  TAB_COLOR_LIKE_TOOLBAR_CSS,
} from "./tab-color-like-toolbar.css.ts";
// Gecko 152 (Project Nova) compatibility.
// GECKO_152_COLOR_FIX_CSS applies to every design (dialogs/panels go black or
// transparent on 152 regardless of which skin is active); LEPTON_COMPAT_CSS
// layers on the Lepton-specific palette + Floorp icon patches for the
// Lepton family. Both load AFTER the skin's own sheets so equal-specificity
// rules win by source order.
import {
  GECKO_152_COLOR_FIX_CSS,
  LEPTON_COMPAT_CSS,
} from "./lepton-compat-152.css.ts";

/**
 * Lepton / Photon / ProtonFix: match nav-bar and bookmark bar to the toolbar
 * surface color, so they read as one piece with the selected tab.
 *
 * Why this is LWT-aware: under a third-party LWT the theme author often
 * deliberately differentiates the selected-tab color from the toolbar color
 * (e.g. a dark green toolbar with a near-white selected tab). Blindly painting
 * the nav-bar / PersonalToolbar with `--tab-selected-bgcolor` then makes the
 * bar "float" off the toolbar in the theme's lighter tab color — the bug
 * reported on Issue #2489. So:
 *
 *   - Default / built-in themes (default-theme, compact-light, compact-dark):
 *     Firefox does NOT set `[lwtheme]` for these, so they fall through to the
 *     "no theme" branch and are painted with the selected tab color. Lepton's
 *     own `userChrome.tab.color_like_toolbar` aligns the tab to the toolbar
 *     here, so this reads as the intended Lepton "one surface" look.
 *   - Third-party LWTs (community colorways, add-on themes): these DO set the
 *     `[lwtheme]` attribute. We respect the theme's own toolbar color instead
 *     of the tab color, so the bar stays anchored to the toolbar the author
 *     drew and does not "float".
 *
 * Selector note: we branch on the `[lwtheme]` ATTRIBUTE only, never on the
 * `:-moz-lwtheme` pseudo-class. Gecko 152 silently drops any selector that
 * places `:-moz-lwtheme` inside `:not()`, which previously invalidated the
 * whole "no theme" rule and left built-in themes unstyled. `[lwtheme]` is the
 * same attribute Firefox itself sets for LWTs, so it is both reliable and
 * sufficient.
 *
 * Surface color fallback ordering (important): on Gecko 152 the legacy
 * `--toolbar-bgcolor` and the new `--toolbar-background-color` are NOT
 * guaranteed to hold the same value. Firefox 152 still paints the selected
 * `.tab-background` from the legacy `--toolbar-bgcolor` /
 * `--toolbar-non-lwt-bgcolor`, while `--toolbar-background-color` is the
 * 152-introduced toolbar token that can diverge (e.g. default-theme dark:
 * `--toolbar-bgcolor` = `#171717` but `--toolbar-background-color` =
 * `rgb(43,42,51)`). Because Lepton's `color_like_toolbar` aligns the selected
 * tab to `--toolbar-bgcolor` (it unsets `--tab-selected-bgcolor`), the nav-bar
 * must follow the SAME token to stay visually flush with the selected tab.
 * Therefore the chain prefers `--toolbar-bgcolor` first and only falls back to
 * `--toolbar-background-color` when the legacy token is unset.
 */
const navBarBackgroundColorCSS = `
/* No theme loaded (default-theme, built-in Light/Dark, etc.): paint nav-bar /
 * PersonalToolbar with the selected tab color. Lepton's color_like_toolbar
 * unsets --tab-selected-bgcolor, so this resolves to --toolbar-bgcolor -- the
 * exact token that paints the selected .tab-background -- keeping the bars
 * flush with the active tab. */
:root:not([lwtheme]) #nav-bar,
:root:not([lwtheme]) #PersonalToolbar {
  --floorp-chrome-surface-color: var(
    --tab-selected-bgcolor,
    var(--toolbar-bgcolor, var(--toolbar-background-color))
  );
  background-color: var(--floorp-chrome-surface-color) !important;
  color: var(--toolbar-text-color);
}

/* Third-party LWT loaded ([lwtheme] is set): keep nav-bar / PersonalToolbar on
 * the toolbar surface color so the bar does not float off the toolbar in the
 * theme's (often lighter) selected-tab color. --toolbar-bgcolor is preferred
 * because the LWT sets it to its own toolbar color, which is what the selected
 * tab tracks under LWT as well. */
:root[lwtheme] #nav-bar,
:root[lwtheme] #PersonalToolbar {
  --floorp-chrome-surface-color: var(
    --toolbar-bgcolor,
    var(--toolbar-background-color)
  );
  background-color: var(--floorp-chrome-surface-color) !important;
  color: var(--toolbar-text-color);
}

/* Lepton paints PersonalToolbar via background-image; override the image to
 * follow the same surface color in both cases. */
#PersonalToolbar {
  background-image: linear-gradient(
      var(--floorp-chrome-surface-color),
      var(--floorp-chrome-surface-color)
    ),
    var(--lwt-additional-images) !important;
  background-repeat: repeat-x, var(--lwt-background-tiling);
  background-position: 0 0, var(--lwt-background-alignment);
}
`;

interface FCSS {
  styles?: string[]; // chrome:// URLs for production (AGENT_SHEET - applies to all documents)
  stylesRaw?: string[]; // Raw CSS content for development (AGENT_SHEET - applies to all documents)
  chromeStyles?: string[]; // chrome:// URLs for production (DOM style - Chrome UI only)
  chromeStylesRaw?: string[]; // Raw CSS content for development (DOM style - Chrome UI only)
  iconBasePath?: string; // Base path for icons in development
  userjs: string | null;
  useTabColorAsToolbarColor?: boolean;
}

/**
 * Get the chrome:// URL for a skin CSS file (production only)
 */
const getStylePath = (path: string): string => {
  return `chrome://noraneko-skin/content/${path}`;
};

/** Base URL for theme icon assets (dev uses localhost via Vite designs server) */
const getIconBasePath = (skin: string): string => {
  return `${getStylePath(`${skin}/icons`)}`;
};

/**
 * Get CSS configuration based on the selected UI theme
 */
export function getCSSFromConfig(
  pref: t.TypeOf<typeof zFloorpDesignConfigs>,
): FCSS {
  const isDev = import.meta.env.DEV;
  const uiTheme = pref.globalConfigs.userInterface;

  switch (uiTheme) {
    case "fluerial": {
      if (isDev) {
        return {
          chromeStylesRaw: [
            fluerialStylesRaw,
            TAB_COLOR_LIKE_TOOLBAR_CSS,
            FLUERIAL_TAB_CORNER_CSS,
            // Gecko 152 color stabilization (dialog/panel backgrounds). This
            // is NOT Lepton-specific — fluerial surfaces the same symptoms
            // once the built-in-theme signals go unreliable on 152.
            GECKO_152_COLOR_FIX_CSS,
          ],
          iconBasePath: "http://localhost:5174/fluerial/icons",
          userjs: null,
          useTabColorAsToolbarColor: true,
        };
      }
      return {
        chromeStylesRaw: [
          fluerialStylesRaw,
          TAB_COLOR_LIKE_TOOLBAR_CSS,
          FLUERIAL_TAB_CORNER_CSS,
          GECKO_152_COLOR_FIX_CSS,
        ],
        iconBasePath: getIconBasePath("fluerial"),
        userjs: null,
        useTabColorAsToolbarColor: true,
      };
    }

    case "lepton": {
      if (isDev) {
        return {
          chromeStylesRaw: [
            leptonChromeStylesRaw,
            leptonContentStylesRaw,
            LEPTON_COMPAT_CSS,
            navBarBackgroundColorCSS,
          ],
          iconBasePath: "http://localhost:5174/lepton/icons",
          userjs: leptonUserJs,
        };
      }
      return {
        chromeStyles: [
          getStylePath("lepton/css/leptonChrome.css"),
          getStylePath("lepton/css/leptonContent.css"),
        ],
        chromeStylesRaw: [LEPTON_COMPAT_CSS, navBarBackgroundColorCSS],
        userjs: leptonUserJs,
      };
    }

    case "photon": {
      if (isDev) {
        return {
          chromeStylesRaw: [
            leptonChromeStylesRaw,
            LEPTON_COMPAT_CSS,
            navBarBackgroundColorCSS,
          ],
          stylesRaw: [leptonContentStylesRaw],
          iconBasePath: "http://localhost:5174/lepton/icons",
          userjs: photonUserJs,
        };
      }
      return {
        chromeStyles: [
          getStylePath("lepton/css/leptonChrome.css"),
          getStylePath("lepton/css/leptonContent.css"),
        ],
        chromeStylesRaw: [LEPTON_COMPAT_CSS, navBarBackgroundColorCSS],
        styles: [getStylePath("lepton/css/leptonContent.css")],
        userjs: photonUserJs,
      };
    }

    case "protonfix": {
      if (isDev) {
        return {
          chromeStylesRaw: [
            leptonChromeStylesRaw,
            LEPTON_COMPAT_CSS,
            navBarBackgroundColorCSS,
          ],
          stylesRaw: [leptonContentStylesRaw],
          iconBasePath: "http://localhost:5174/lepton/icons",
          userjs: protonfixUserJs,
        };
      }
      return {
        chromeStyles: [
          getStylePath("lepton/css/leptonChrome.css"),
          getStylePath("lepton/css/leptonContent.css"),
        ],
        chromeStylesRaw: [LEPTON_COMPAT_CSS, navBarBackgroundColorCSS],
        styles: [getStylePath("lepton/css/leptonContent.css")],
        userjs: protonfixUserJs,
      };
    }

    case "proton": {
      return { userjs: null };
    }

    default: {
      console.warn(`[getCSSFromConfig] Unknown UI theme: ${uiTheme}`);
      uiTheme satisfies never;
      return { userjs: null };
    }
  }
}

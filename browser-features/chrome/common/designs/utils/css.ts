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
// Gecko 152 (Project Nova) compatibility for Lepton + Floorp icon patches.
// Loaded AFTER Lepton's own sheets so equal-specificity rules win by order.
import { LEPTON_COMPAT_CSS } from "./lepton-compat-152.css.ts";

/** Lepton / Photon / ProtonFix: match nav-bar and bookmark bar to selected tab color */
const navBarBackgroundColorCSS = `
#nav-bar,
#PersonalToolbar {
  --floorp-chrome-surface-color: var(
    --tab-background-color-selected,
    var(
      --tab-selected-bgcolor,
      var(--toolbar-background-color, var(--toolbar-bgcolor))
    )
  );
  background-color: var(--floorp-chrome-surface-color) !important;
  color: var(--toolbar-text-color, var(--toolbar-color));
}

/* Lepton paints PersonalToolbar via background-image; override to follow tab color */
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

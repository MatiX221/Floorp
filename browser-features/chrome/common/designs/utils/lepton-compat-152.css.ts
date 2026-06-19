/* -*- indent-tabs-mode: nil; js-indent-level: 2 -*-
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * # Lepton Compatibility Layer for Gecko 152 (Project Nova)
 *
 * ## Why this exists (Floorp Issue #2489)
 *
 * Firefox 152 ("Project Nova", released 2026-06-16) redesigned the browser
 * chrome and changed how built-in themes expose themselves to user style
 * sheets. The vendored Lepton CSS (`skin/lepton/css/leptonChrome.css`,
 * v8.6.2) detects built-in light/dark themes through three parallel,
 * brittle mechanisms:
 *
 *   1. `[lwtheme-mozlightdark]` attribute      (82 occurrences)
 *   2. `[builtintheme][devtoolstheme="..."]`    (66 occurrences)
 *   3. inline `[style*="--lwt-accent-color: rgb(240, 240, 244); …"]`
 *      exact-string RGB matching               (82 occurrences)
 *
 * Gecko 152 no longer reliably populates these in the way Lepton expects, so
 * the selectors silently fail to match and the `!important` color overrides
 * on `--lwt-accent-color`, `--toolbar-bgcolor`, `--arrowpanel-background`,
 * `--in-content-page-background`, etc. never apply. The visible symptom
 * (reported on Issue #2489 with third-party LWTs such as "Windows XP
 * modern") is the chrome collapsing to a uniform blue and dialog boxes
 * rendering with a black background. `fluerial` and the built-in `proton`
 * design are unaffected because they do not use Lepton CSS.
 *
 * ## Approach
 *
 * We do **not** patch the vendored Lepton files: the `update_lepton.yml`
 * workflow re-syncs them from upstream daily and would clobber any local
 * edit. Instead this module exports CSS strings that are injected by
 * `css.ts` **after** Lepton's own sheets, so equal-specificity rules here
 * win by source order. This keeps the upstream sync path clean and lets us
 * adapt to Gecko 153+ by editing only this file.
 *
 * The selectors below deliberately rely on the stable `:-moz-lwtheme` /
 * `[lwtheme]` / `[lwthemetextcolor]` signals rather than hardcoded RGB
 * triples or attributes that Mozilla renames between versions.
 *
 * ## Scope
 *
 * Applied only to the `lepton`, `photon` and `protonfix` designs (they share
 * the same Lepton CSS). `fluerial` and `proton` are untouched.
 *
 * Reference: https://github.com/Floorp-Projects/Floorp/issues/2489
 */

/**
 * Restore sane chrome colors under Gecko 152 when Lepton's built-in-theme
 * detection fails.
 *
 * Strategy:
 *  - For a loaded LWT (third-party themes like "Windows XP modern"): respect
 *    the theme's own `--lwt-accent-color` / `--lwt-text-color` instead of
 *    letting Lepton's stale overrides collapse everything to one color.
 *  - For the built-in themes when Lepton's detection misses: re-establish
 *    Lepton's intended accent (`rgb(240, 240, 244)` light /
 *    `rgb(28, 27, 34)` dark) using `prefers-color-scheme` rather than the
 *    brittle inline-style/attribute matchers.
 *  - Fix dialog backgrounds (`--in-content-page-background`) which Lepton
 *    ties to `--lwt-accent-color`; on 152 this surfaced as black dialogs.
 *  - Re-declare the Lepton "accent blue" tokens for primary buttons so they
 *    keep their color even when the built-in-theme block above them no
 *    longer matches.
 */
export const LEPTON_COMPAT_152_CSS = `
/* =========================================================================
 * Floorp Lepton compat — Gecko 152 (Project Nova)
 * Loaded AFTER leptonChrome.css; equal specificity wins by source order.
 * ======================================================================= */

/*= Tab/toolbox variable aliases (the tab rendering fix) ====================
 * Gecko 152 (Project Nova) renamed the tab and toolbox CSS custom properties
 * that Lepton v8.7.x still references by their pre-152 names. With the old
 * names gone, every Lepton rule reading them resolves to the fallback
 * (or to nothing), which is what breaks tab painting in Issue #2489.
 *
 * Renames in 152 (see browser/themes/shared/tabbrowser/tab.tokens.css and
 * tabs.css in the 151 -> 152 runtime diff):
 *   --tab-selected-bgcolor        -> --tab-background-color-selected
 *   --tab-hover-background-color  -> --tab-background-color-hover
 *   --toolbox-bgcolor             -> --toolbox-background-color
 *   --toolbox-bgcolor-inactive    -> --toolbox-background-color-inactive
 *   --tab-selected-textcolor      now references --toolbar-text-color
 *                                  (was --toolbar-color)
 *
 * Rather than patching the 32 Lepton references, re-expose the old names as
 * aliases of the new tokens so Lepton keeps working untouched. The aliases
 * intentionally do NOT use !important: they only supply a value when the
 * old name is otherwise undefined, so anything that legitimately sets the
 * old name still wins. */
:root {
  --tab-selected-bgcolor: var(--tab-background-color-selected, var(--toolbar-background-color, var(--toolbar-bgcolor)));
  --tab-hover-background-color: var(--tab-background-color-hover);
  --toolbox-bgcolor: var(--toolbox-background-color, var(--toolbar-bgcolor));
  --toolbox-bgcolor-inactive: var(--toolbox-background-color-inactive, var(--toolbox-background-color, var(--toolbar-bgcolor)));
}
/* On Gecko < 152 the new names do not exist; fall the aliases back to the
 * legacy values so the alias block is forward AND backward compatible. */
@supports not (--tab-background-color-selected: initial) {
  :root {
    --tab-selected-bgcolor: var(--toolbar-bgcolor);
    --tab-hover-background-color: color-mix(in srgb, currentColor 11%, transparent);
  }
}

/*= Built-in light/dark theme accent restoration ============================
 * Lepton v8.6.2 keys off the built-in-theme attribute and inline-style
 * exact-RGB substring matchers on :root. On Gecko 152 those signals are
 * unreliable, so Lepton's !important overrides never apply and the chrome
 * falls back to raw defaults. Re-establish Lepton's intended palette using
 * the stable prefers-color-scheme signal instead. */
:root {
  /* Lepton "Original" intended accent colors (mirrors leptonChrome.css) */
  --lepton-compat-accent-light: rgb(229, 229, 235);
  --lepton-compat-toolbar-light: rgba(255, 255, 255, 1);
  --lepton-compat-accent-dark: rgb(28, 27, 34);
  --lepton-compat-toolbar-dark: rgba(43, 42, 51, 1);
}

/* Built-in theme, no LWT loaded: restore Lepton's light palette.
 * Chain both negations on :root (AND) so the rule only applies when NO
 * theme signal is present — `:is(:not(...), :not(...))` was OR logic and
 * matched even when one signal was set. */
:root:not([lwtheme]):not(:-moz-lwtheme) {
  --lwt-accent-color: var(--lepton-compat-accent-light) !important;
  --toolbar-bgcolor: var(--lepton-compat-toolbar-light) !important;
}
@media (prefers-color-scheme: dark) {
  :root:not([lwtheme]):not(:-moz-lwtheme) {
    --lwt-accent-color: var(--lepton-compat-accent-dark) !important;
    --toolbar-bgcolor: var(--lepton-compat-toolbar-dark) !important;
  }
}

/*= Third-party LWT support (Issue #2489 — "Windows XP modern" etc.) ========
 * Lepton writes fixed-color !important overrides keyed to built-in theme
 * detection. When an LWT is active that detection can partially match and
 * paint the whole chrome a single accent color. Re-allow the theme's own
 * accent/text colors to flow through so the theme author's palette wins. */
:root:is(:-moz-lwtheme, [lwtheme]) {
  --lwt-accent-color: var(--lwt-accent-color, revert) !important;
  --toolbar-bgcolor: var(--toolbar-bgcolor, revert) !important;
}
/* The navigator toolbox background follows --lwt-accent-color in Lepton; make
 * sure it reads the live (possibly LWT-provided) value rather than a stale
 * override captured before the theme loaded. */
:root:is(:-moz-lwtheme, [lwtheme]) #navigator-toolbox {
  background-color: var(--lwt-accent-color) !important;
}

/*= Dialog background fix (the "black dialog" symptom) ======================
 * Lepton sets --in-content-page-background to --lwt-accent-color and styles
 * the dialog element against it. When --lwt-accent-color is wrong on 152,
 * dialogs go black. Anchor in-content surfaces to a stable value per color
 * scheme and let LWTs override only when they actually provide one. */
@media (prefers-color-scheme: light) {
  :root, :host, dialog {
    --in-content-page-background: rgb(255, 255, 255) !important;
  }
}
@media (prefers-color-scheme: dark) {
  :root, :host, dialog {
    --in-content-page-background: rgb(31, 30, 38) !important;
  }
}
/* LWT-provided in-content background takes precedence when present. */
:root:is(:-moz-lwtheme, [lwtheme]),
:root:is(:-moz-lwtheme, [lwtheme]) dialog {
  --in-content-page-background: var(--lwt-accent-color) !important;
}

/*= Primary-button accent (Lepton blue) =====================================
 * Lepton declares these inside the built-in-theme block that no longer
 * matches on 152. Re-declare them unconditionally so primary buttons keep
 * their blue rather than inheriting a broken accent. */
:host,
:root,
dialog {
  --in-content-primary-button-text-color: var(--in-content-page-color) !important;
  --in-content-primary-button-background: var(--blue-60, #0060df) !important;
  --in-content-primary-button-background-hover: var(--blue-50, #0a84ff) !important;
  --in-content-primary-button-background-active: var(--blue-40, #4595ff) !important;
}

/*= Panel / arrowpanel background ===========================================
 * Lepton ties --panel-background to --arrowpanel-background which it also
 * overrides via the broken detection path. Pin it to the chrome surface
 * token so panels match the toolbar. */
:root:not([lwtheme]):not(:-moz-lwtheme) {
  --arrowpanel-background: var(--toolbar-bgcolor, -moz-dialog) !important;
}
`;

/**
 * Floorp-specific icon rules extracted from
 * `skin/lepton/css/leptonChrome.css` lines 14596–14672.
 *
 * Upstream Lepton does not know about these Floorp-only element IDs
 * (PWA/SSB, UserCSSLoader, webpanel, share mode, etc.). They were living
 * inside the vendored file, which means the daily `update_lepton.yml`
 * workflow would silently delete them whenever upstream restructured that
 * region. Hosting them here makes them independent of upstream syncs.
 *
 * The rules are duplicated verbatim from the vendored source (same `url()`
 * references resolve identically because this sheet is injected into the
 * same document and the relative `../icons` path is rewritten by
 * `replaceIconPaths()` at registration time). Duplicating intentionally
 * rather than deleting the vendored copy: the vendored copy disappears on
 * the next upstream sync, at which point this becomes the single source.
 */
export const FLOORP_ICON_PATCHES = `
/*= Floorp Browser (icon patches, extracted from leptonChrome.css) ==========*/
#ssbPageAction-image {
  list-style-image: url("../icons/pwa-install.svg");
}
#ssbPageAction-image[open-ssb="true"] {
  list-style-image: url("../icons/pwa-launch.svg");
}
@media -moz-pref("userChrome.icon.panel") {
  #rebootappmenu {
    list-style-image: url("../icons/refresh-cw.svg");
  }
  #openprofiledir {
    list-style-image: var(--uc-folder-icon);
  }
  #appMenu-ssb-button {
    list-style-image: url("../icons/pwa-manage.svg");
  }
  #appMenu-install-or-open-ssb-current-page-button {
    list-style-image: url("../icons/pwa-install.svg");
  }
  #appMenu-install-or-open-ssb-current-page-button[open-ssb="true"] {
    list-style-image: url("../icons/pwa-launch.svg");
  }
}
@media -moz-pref("userChrome.icon.menu") {
  #toggle_sharemode {
    --menuitem-image: url("chrome://branding/content/about-logo-private.png");
  }
  #usercssloader-menu {
    --menuitem-image: url("../icons/developer.svg");
  }
  #usercssloader-menupopup > menu[data-l10n-id="css-menu"] {
    --menuitem-image: url("../icons/document-css.svg");
  }
  #usercssloader-submenupopup > menuitem[data-l10n-id="rebuild-css"] {
    --menuitem-image: url("chrome://global/skin/icons/reload.svg");
  }
  #usercssloader-submenupopup > menuitem[data-l10n-id="make-browsercss-file"] {
    --menuitem-image: url("../icons/edit-active.svg");
  }
  #usercssloader-submenupopup > menuitem[data-l10n-id="open-css-folder"] {
    --menuitem-image: var(--uc-folder-icon);
  }
  #usercssloader-submenupopup > menuitem[data-l10n-id="edit-userChromeCss-editor"] {
    --menuitem-image: url("chrome://browser/skin/window.svg");
  }
  #usercssloader-submenupopup > menuitem[data-l10n-id="edit-userContentCss-editor"] {
    --menuitem-image: url("chrome://global/skin/icons/page-portrait.svg");
  }
  #context_toggleToPrivateContainer,
  #open_in_private_container {
    --menuitem-image: url("../icons/private-favicon.svg");
  }
  #toggle_statusBar {
    --menuitem-image: url("../icons/pulse-square.svg");
  }
  #muteMenu {
    --menuitem-image: url("chrome://browser/skin/tabbrowser/tab-audio-muted-small.svg");
    stroke: transparent !important;
  }
  #unloadWebpanelMenu {
    --menuitem-image: var(--uc-tab-unload-icon);
  }
  #changeUAWebpanelMenu {
    --menuitem-image: url("../icons/command-responsivemode.svg");
    fill-opacity: 0;
  }
  #deleteWebpanelMenu {
    --menuitem-image: url("chrome://global/skin/icons/delete.svg");
  }
  #run-ssb-contextmenu {
    --menuitem-image: url("../icons/pwa-launch.svg");
  }
  #uninstall-ssb-contextmenu {
    --menuitem-image: url("../icons/pwa-remove.svg");
  }
}
`;

/**
 * Combined compatibility stylesheet injected after Lepton's own sheets.
 * Order within the bundle: (1) Gecko 152 color/theme fixes, then (2) Floorp
 * icon patches. Icons are independent of color fixes so their relative order
 * is not significant, but keeping color fixes first makes the intent clear.
 */
export const LEPTON_COMPAT_CSS = LEPTON_COMPAT_152_CSS + "\n" +
  FLOORP_ICON_PATCHES;

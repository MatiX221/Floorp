// SPDX-License-Identifier: MPL-2.0
// @colocated-env browser
//
// Regression tests for the Lepton / Gecko 152 (Project Nova) compatibility
// layer. See `utils/lepton-compat-152.css.ts` and Floorp Issue #2489.
//
// Background: Lepton v8.6.2 detects built-in themes through brittle selectors
// (`[lwtheme-mozlightdark]`, `[builtintheme]`, exact-RGB inline `style*=`
// matches) that Gecko 152 stopped populating reliably. The result was the
// chrome collapsing to a single color and dialogs going black. These tests
// pin down the compat layer so a future upstream Lepton sync or a Gecko
// version bump cannot silently drop the fix.

import {
  LEPTON_COMPAT_152_CSS,
  LEPTON_COMPAT_CSS,
  FLOORP_ICON_PATCHES,
} from "../utils/lepton-compat-152.css.ts";
import { getCSSFromConfig } from "../utils/css.ts";
import {
  assert,
  assertEquals,
  runTests,
} from "../../../test/utils/test_harness.ts";
import type { TFloorpDesignConfigs } from "../type.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeConfig(
  ui: TFloorpDesignConfigs["globalConfigs"]["userInterface"],
): TFloorpDesignConfigs {
  return {
    globalConfigs: {
      faviconColor: false,
      userInterface: ui,
      appliedUserJs: "",
    },
    tabbar: {
      tabbarStyle: "horizontal",
      tabbarPosition: "default",
      multiRowTabBar: { maxRowEnabled: false, maxRow: 3 },
    },
    tab: {
      tabScroll: { enabled: false, reverse: false, wrap: false },
      tabMinHeight: 30,
      tabMinWidth: 76,
      tabPinTitle: false,
      tabDubleClickToClose: false,
      tabOpenPosition: -1,
    },
    uiCustomization: {
      navbar: { position: "top", searchBarTop: false },
      display: {
        disableFullscreenNotification: false,
        deleteBrowserBorder: false,
      },
      special: {
        optimizeForTreeStyleTab: false,
        hideForwardBackwardButton: false,
        stgLikeWorkspaces: false,
      },
      multirowTab: { newtabInsideEnabled: false },
      bookmarkBar: { focusExpand: false, position: "top" },
      qrCode: { disableButton: false },
    },
  };
}

/** Join every inline (raw) chrome stylesheet for a theme into one string. */
function getInlineChromeCss(
  ui: TFloorpDesignConfigs["globalConfigs"]["userInterface"],
): string {
  const r = getCSSFromConfig(makeConfig(ui));
  return r.chromeStylesRaw?.join("\n") ?? "";
}

// ---------------------------------------------------------------------------
// Tests — compat layer is injected for the affected themes
// ---------------------------------------------------------------------------

/** The three Lepton-backed designs must include the compat CSS inline. */
function testLeptonThemesIncludeCompatCss(): void {
  for (const theme of ["lepton", "photon", "protonfix"] as const) {
    const css = getInlineChromeCss(theme);
    // `LEPTON_COMPAT_CSS` carries the banner comment, which is the most
    // stable fingerprint of the compat layer being present.
    assert(
      css.includes("Floorp Lepton compat"),
      `${theme} should include the Lepton Gecko 152 compat stylesheet`,
    );
  }
}

/** Compat must NOT leak into themes that don't use Lepton. */
function testNonLeptonThemesExcludeCompatCss(): void {
  for (const theme of ["fluerial", "proton"] as const) {
    const css = getInlineChromeCss(theme);
    assert(
      !css.includes("Floorp Lepton compat"),
      `${theme} must NOT include the Lepton compat stylesheet`,
    );
  }
}

// ---------------------------------------------------------------------------
// Tests — the compat layer uses robust, Gecko-152-safe detection
// ---------------------------------------------------------------------------

/**
 * The whole point of the fix: do NOT depend on the brittle matchers that
 * Gecko 152 broke. The compat CSS should steer by `:-moz-lwtheme` /
 * `[lwtheme]` / `prefers-color-scheme`, not by `[lwtheme-mozlightdark]`,
 * `[builtintheme]` or hardcoded RGB triples.
 */
function testCompatAvoidsBrittleSelectors(): void {
  assert(
    !LEPTON_COMPAT_152_CSS.includes("[lwtheme-mozlightdark]"),
    "compat layer must not rely on the [lwtheme-mozlightdark] attribute " +
      "(unreliable on Gecko 152)",
  );
  assert(
    !LEPTON_COMPAT_152_CSS.includes("[builtintheme]"),
    "compat layer must not rely on the [builtintheme] attribute " +
      "(unreliable on Gecko 152)",
  );
  assert(
    !LEPTON_COMPAT_152_CSS.includes(
      '--lwt-accent-color: rgb(240, 240, 244)',
    ),
    "compat layer must not hardcode the light built-in RGB triple " +
      "(Mozilla changes these between versions)",
  );
  assert(
    !LEPTON_COMPAT_152_CSS.includes(
      '--lwt-accent-color: rgb(28, 27, 34)',
    ),
    "compat layer must not hardcode the dark built-in RGB triple " +
      "(Mozilla changes these between versions)",
  );
}

function testCompatUsesRobustLwtSignals(): void {
  assert(
    LEPTON_COMPAT_152_CSS.includes(":-moz-lwtheme"),
    "compat layer should target LWT state via the stable :-moz-lwtheme " +
      "pseudo-class",
  );
  assert(
    LEPTON_COMPAT_152_CSS.includes("prefers-color-scheme"),
    "compat layer should branch light/dark via prefers-color-scheme rather " +
      "than brittle attributes",
  );
}

// ---------------------------------------------------------------------------
// Tests — Gecko 152 tab/toolbox variable aliases (the tab rendering fix)
// ---------------------------------------------------------------------------

/**
 * Gecko 152 renamed the tab/toolbox custom properties Lepton reads. The
 * visible breakage in Issue #2489 (tabs not painting correctly) traces back
 * to Lepton referencing the old names that no longer resolve. The compat
 * layer must re-expose every renamed token under its legacy name.
 */
function testCompatAliasesAllRenamedTabTokens(): void {
  // Each legacy name Lepton uses must be re-exposed as an alias.
  const aliases: Array<[string, string]> = [
    ["--tab-selected-bgcolor", "--tab-background-color-selected"],
    ["--tab-hover-background-color", "--tab-background-color-hover"],
    ["--toolbox-bgcolor", "--toolbox-background-color"],
    ["--toolbox-bgcolor-inactive", "--toolbox-background-color-inactive"],
  ];
  for (const [legacy, renamed] of aliases) {
    const declaresLegacy = new RegExp(`${legacy}\\s*:`).test(
      LEPTON_COMPAT_152_CSS,
    );
    assert(
      declaresLegacy,
      `compat layer must re-expose ${legacy} (removed in Gecko 152)`,
    );
    const referencesRenamed = LEPTON_COMPAT_152_CSS.includes(renamed);
    assert(
      referencesRenamed,
      `compat layer should define ${legacy} in terms of the new ${renamed}`,
    );
  }
}

/** Aliases must not hardcode a single value: they must chain through the new
 *  token so theme/LWT-provided colors still flow correctly. */
function testCompatAliasesChainToNewTokens(): void {
  assert(
    new RegExp(
      "--tab-selected-bgcolor:\\s*var\\(--tab-background-color-selected",
    ).test(LEPTON_COMPAT_152_CSS),
    "--tab-selected-bgcolor alias must chain to --tab-background-color-selected",
  );
}

/** The alias block must stay backward compatible on Gecko < 152 where the
 *  new token names do not exist. */
function testCompatAliasesAreBackwardCompatible(): void {
  assert(
    LEPTON_COMPAT_152_CSS.includes("@supports not") &&
      LEPTON_COMPAT_152_CSS.includes("--tab-background-color-selected: initial"),
    "compat layer must guard the new-token aliases with @supports for Gecko < 152",
  );
}

// ---------------------------------------------------------------------------
// Tests — the two reported symptoms are directly addressed
// ---------------------------------------------------------------------------

/** "The whole UI turns blue" — ensure the LWT's own accent is allowed
 *  through rather than clobbered by a stale Lepton override. */
function testCompatLetsLwtAccentThrough(): void {
  assert(
    LEPTON_COMPAT_152_CSS.includes("--lwt-accent-color") &&
      LEPTON_COMPAT_152_CSS.includes(":-moz-lwtheme"),
    "compat layer should restore --lwt-accent-color flow for LWTs",
  );
}

/** "Dialog boxes show a black background" — ensure in-content / dialog
 *  background is anchored to a stable per-scheme value. */
function testCompatFixesDialogBackground(): void {
  assert(
    LEPTON_COMPAT_152_CSS.includes("--in-content-page-background"),
    "compat layer should pin --in-content-page-background for dialogs",
  );
  assert(
    LEPTON_COMPAT_CSS.includes("dialog"),
    "compat layer should target the dialog element",
  );
}

// ---------------------------------------------------------------------------
// Tests — Floorp-specific icon patches are preserved out-of-vendor
// ---------------------------------------------------------------------------

/**
 * These Floorp-only IDs (PWA/SSB, UserCSSLoader, webpanel, share mode) lived
 * inside the vendored leptonChrome.css and would be wiped by the daily
 * upstream sync. Verify they are hosted in the compat layer so they survive.
 */
function testFloorpIconPatchesPresent(): void {
  const floorpIds = [
    "#ssbPageAction-image",
    "#usercssloader-menu",
    "#unloadWebpanelMenu",
    "#changeUAWebpanelMenu",
    "#deleteWebpanelMenu",
    "#toggle_sharemode",
    "#run-ssb-contextmenu",
    "#uninstall-ssb-contextmenu",
  ];
  for (const id of floorpIds) {
    assert(
      FLOORP_ICON_PATCHES.includes(id),
      `Floorp icon patch for ${id} should be preserved in the compat layer`,
    );
  }
}

/** Bundled export is the sum of the color fix and the icon patches. */
function testBundledCompatIsColorPlusIcons(): void {
  assertEquals(
    LEPTON_COMPAT_CSS,
    LEPTON_COMPAT_152_CSS + "\n" + FLOORP_ICON_PATCHES,
    "LEPTON_COMPAT_CSS must bundle the color fixes and Floorp icon patches",
  );
}

/** The icon patches ride along with the affected themes. */
function testLeptonThemesIncludeFloorpIconPatches(): void {
  for (const theme of ["lepton", "photon", "protonfix"] as const) {
    const css = getInlineChromeCss(theme);
    assert(
      css.includes("#usercssloader-menu"),
      `${theme} should include the Floorp icon patches`,
    );
  }
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

export async function runAllTests(): Promise<void> {
  await runTests("lepton-compat.test.ts", [
    { name: "lepton themes include compat css", fn: testLeptonThemesIncludeCompatCss },
    { name: "non-lepton themes exclude compat css", fn: testNonLeptonThemesExcludeCompatCss },
    { name: "compat avoids brittle selectors", fn: testCompatAvoidsBrittleSelectors },
    { name: "compat uses robust lwt signals", fn: testCompatUsesRobustLwtSignals },
    { name: "compat aliases all renamed tab tokens", fn: testCompatAliasesAllRenamedTabTokens },
    { name: "compat aliases chain to new tokens", fn: testCompatAliasesChainToNewTokens },
    { name: "compat aliases are backward compatible", fn: testCompatAliasesAreBackwardCompatible },
    { name: "compat lets lwt accent through (blue UI symptom)", fn: testCompatLetsLwtAccentThrough },
    { name: "compat fixes dialog background (black dialog symptom)", fn: testCompatFixesDialogBackground },
    { name: "floorp icon patches present", fn: testFloorpIconPatchesPresent },
    { name: "bundled compat is color plus icons", fn: testBundledCompatIsColorPlusIcons },
    { name: "lepton themes include floorp icon patches", fn: testLeptonThemesIncludeFloorpIconPatches },
  ]);
}

await runAllTests();

// SPDX-License-Identifier: MPL-2.0
// @colocated-env browser

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

/** Build a minimal valid config overriding only globalConfigs.userInterface */
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

// ---------------------------------------------------------------------------
// Tests — fluerial theme
// ---------------------------------------------------------------------------

function testFluerialReturnsUserjsNull(): void {
  const result = getCSSFromConfig(makeConfig("fluerial"));
  assertEquals(result.userjs, null, "fluerial should have null userjs");
}

function testFluerialHasUseTabColorAsToolbarColor(): void {
  const result = getCSSFromConfig(makeConfig("fluerial"));
  assertEquals(
    result.useTabColorAsToolbarColor,
    true,
    "fluerial should set useTabColorAsToolbarColor to true",
  );
}

function testFluerialHasStylesOrRaw(): void {
  const result = getCSSFromConfig(makeConfig("fluerial"));
  const hasChromeStyles = (result.chromeStyles?.length ?? 0) > 0 ||
    (result.chromeStylesRaw?.length ?? 0) > 0;
  assert(
    hasChromeStyles,
    "fluerial should have chromeStyles or chromeStylesRaw",
  );
}

// ---------------------------------------------------------------------------
// Tests — lepton theme
// ---------------------------------------------------------------------------

function testLeptonReturnsUserjs(): void {
  const result = getCSSFromConfig(makeConfig("lepton"));
  assert(result.userjs !== null, "lepton should have non-null userjs");
  assert(
    result.userjs!.length > 0,
    "lepton userjs should be a non-empty string",
  );
}

function testLeptonNoUseTabColorAsToolbarColor(): void {
  const result = getCSSFromConfig(makeConfig("lepton"));
  assertEquals(
    result.useTabColorAsToolbarColor,
    undefined,
    "lepton should not set useTabColorAsToolbarColor",
  );
}

function testLeptonHasExpectedStyleEntries(): void {
  const result = getCSSFromConfig(makeConfig("lepton"));
  // Production: chromeStyles = [leptonChrome, leptonContent] (2).
  // Dev:        chromeStylesRaw = [leptonChrome, LEPTON_COMPAT, navBar] (3).
  // Both branches must carry Lepton's chrome + content sheets; the Gecko 152
  // compat layer and the nav-bar color override are layered on as raw CSS.
  const chromeCount = result.chromeStyles?.length ??
    result.chromeStylesRaw?.length ?? 0;
  assert(
    chromeCount >= 2,
    `lepton should expose at least Lepton chrome + content sheets, got ${chromeCount}`,
  );
  assert(
    (result.chromeStylesRaw?.length ?? 0) >= 1,
    "lepton should always carry inline raw chrome CSS (compat + navBar)",
  );
}

function getChromeInlineCss(
  ui: TFloorpDesignConfigs["globalConfigs"]["userInterface"],
): string {
  return getCSSFromConfig(makeConfig(ui)).chromeStylesRaw?.join("\n") ?? "";
}

function testLeptonPhotonProtonfixNavBarCssIncludesPersonalToolbar(): void {
  for (const theme of ["lepton", "photon", "protonfix"] as const) {
    const css = getChromeInlineCss(theme);
    assert(
      css.includes("#PersonalToolbar"),
      `${theme} navBar CSS should style #PersonalToolbar`,
    );
    assert(
      css.includes("--tab-selected-bgcolor"),
      `${theme} navBar CSS should follow selected tab color in the no-theme case`,
    );
  }
}

/**
 * Regression for Issue #2489: under a third-party LWT the nav-bar /
 * PersonalToolbar must follow the TOOLBAR color, not the (often lighter)
 * selected-tab color — otherwise the bar "floats" off the toolbar. The
 * navBar CSS must therefore branch on the LWT signal.
 */
function testNavBarCssIsLwtAware(): void {
  for (const theme of ["lepton", "photon", "protonfix"] as const) {
    const css = getChromeInlineCss(theme);
    // The LWT case must scope the nav-bar/PersonalToolbar to the toolbar
    // surface color, not the tab color.
    assert(
      /:root:is\(:-moz-lwtheme,\s*\[lwtheme\]\)\s+#nav-bar/.test(css),
      `${theme} navBar CSS must scope #nav-bar to the toolbar color under LWT`,
    );
    assert(
      /:root:is\(:-moz-lwtheme,\s*\[lwtheme\]\)\s+#PersonalToolbar/.test(css),
      `${theme} navBar CSS must scope #PersonalToolbar to the toolbar color under LWT`,
    );
    // The LWT branch must read the toolbar color, NOT --tab-selected-bgcolor.
    // The LWT rules form one selector group: `:root:is(...) #nav-bar,
    // :root:is(...) #PersonalToolbar { ... }`. Extract that single block.
    const lwtBlockMatch = css.match(
      /:root:is\(:-moz-lwtheme,\s*\[lwtheme\]\)\s+#nav-bar,[\s\S]*?\}/,
    );
    const lwtBlock = lwtBlockMatch ? lwtBlockMatch[0] : "";
    assert(
      lwtBlock !== "",
      `${theme} navBar CSS must have an LWT-scoped selector group for #nav-bar`,
    );
    assert(
      lwtBlock.includes("--toolbar-background-color"),
      `${theme} LWT navBar branch must read --toolbar-background-color`,
    );
    assert(
      !lwtBlock.includes("--tab-selected-bgcolor"),
      `${theme} LWT navBar branch must NOT read --tab-selected-bgcolor (that is what floats the bar off the toolbar under LWT)`,
    );
  }
}

// ---------------------------------------------------------------------------
// Tests — photon theme
// ---------------------------------------------------------------------------

function testPhotonReturnsUserjs(): void {
  const result = getCSSFromConfig(makeConfig("photon"));
  assert(result.userjs !== null, "photon should have non-null userjs");
}

function testPhotonHasContentStyles(): void {
  const result = getCSSFromConfig(makeConfig("photon"));
  const hasContentStyles = (result.styles?.length ?? 0) > 0 ||
    (result.stylesRaw?.length ?? 0) > 0;
  assert(
    hasContentStyles,
    "photon should have content styles (styles or stylesRaw)",
  );
}

function testPhotonHasChromeStyles(): void {
  const result = getCSSFromConfig(makeConfig("photon"));
  const hasChromeStyles = (result.chromeStyles?.length ?? 0) > 0 ||
    (result.chromeStylesRaw?.length ?? 0) > 0;
  assert(
    hasChromeStyles,
    "photon should have chrome styles (chromeStyles or chromeStylesRaw)",
  );
}

// ---------------------------------------------------------------------------
// Tests — protonfix theme
// ---------------------------------------------------------------------------

function testProtonfixReturnsUserjs(): void {
  const result = getCSSFromConfig(makeConfig("protonfix"));
  assert(result.userjs !== null, "protonfix should have non-null userjs");
}

function testProtonfixNoUseTabColorAsToolbarColor(): void {
  const result = getCSSFromConfig(makeConfig("protonfix"));
  assertEquals(
    result.useTabColorAsToolbarColor,
    undefined,
    "protonfix should not set useTabColorAsToolbarColor (conflicts with userjs color_like_toolbar=false)",
  );
}

// ---------------------------------------------------------------------------
// Tests — proton theme (default Firefox)
// ---------------------------------------------------------------------------

function testProtonReturnsNullUserjs(): void {
  const result = getCSSFromConfig(makeConfig("proton"));
  assertEquals(result.userjs, null, "proton should have null userjs");
}

function testProtonNoStyles(): void {
  const result = getCSSFromConfig(makeConfig("proton"));
  assertEquals(result.styles, undefined, "proton should have no styles");
  assertEquals(
    result.chromeStyles,
    undefined,
    "proton should have no chromeStyles",
  );
}

// ---------------------------------------------------------------------------
// Tests — structural invariants
// ---------------------------------------------------------------------------

function testAllThemesReturnNonNullResult(): void {
  const themes: TFloorpDesignConfigs["globalConfigs"]["userInterface"][] = [
    "fluerial",
    "lepton",
    "photon",
    "protonfix",
    "proton",
  ];
  for (const theme of themes) {
    const result = getCSSFromConfig(makeConfig(theme));
    assert(
      result !== null && result !== undefined,
      `${theme} returned null/undefined`,
    );
    assert(
      typeof result.userjs === "string" || result.userjs === null,
      `${theme} userjs should be string or null`,
    );
  }
}

function testProductionPathsUseChromeProtocol(): void {
  // In production mode, styles should use chrome:// URLs
  // We verify the structural pattern: if chromeStyles exist, they should be chrome:// URLs
  const result = getCSSFromConfig(makeConfig("lepton"));
  if (result.chromeStyles) {
    for (const url of result.chromeStyles) {
      assert(
        url.startsWith("chrome://noraneko-skin/content/"),
        `production chrome style should use chrome:// URL: ${url}`,
      );
    }
  }
  if (result.styles) {
    for (const url of result.styles) {
      assert(
        url.startsWith("chrome://noraneko-skin/content/"),
        `production content style should use chrome:// URL: ${url}`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

export async function runAllTests(): Promise<void> {
  await runTests("css.test.ts", [
    // fluerial
    { name: "fluerial returns null userjs", fn: testFluerialReturnsUserjsNull },
    {
      name: "fluerial has useTabColorAsToolbarColor",
      fn: testFluerialHasUseTabColorAsToolbarColor,
    },
    { name: "fluerial has styles", fn: testFluerialHasStylesOrRaw },
    // lepton
    { name: "lepton returns userjs", fn: testLeptonReturnsUserjs },
    {
      name: "lepton no useTabColorAsToolbarColor",
      fn: testLeptonNoUseTabColorAsToolbarColor,
    },
    { name: "lepton has expected style entries", fn: testLeptonHasExpectedStyleEntries },
    {
      name: "lepton/photon/protonfix navBar CSS includes PersonalToolbar",
      fn: testLeptonPhotonProtonfixNavBarCssIncludesPersonalToolbar,
    },
    {
      name: "lepton/photon/protonfix navBar CSS is LWT-aware",
      fn: testNavBarCssIsLwtAware,
    },
    // photon
    { name: "photon returns userjs", fn: testPhotonReturnsUserjs },
    { name: "photon has content styles", fn: testPhotonHasContentStyles },
    { name: "photon has chrome styles", fn: testPhotonHasChromeStyles },
    // protonfix
    { name: "protonfix returns userjs", fn: testProtonfixReturnsUserjs },
    {
      name: "protonfix no useTabColorAsToolbarColor",
      fn: testProtonfixNoUseTabColorAsToolbarColor,
    },
    // proton
    { name: "proton returns null userjs", fn: testProtonReturnsNullUserjs },
    { name: "proton no styles", fn: testProtonNoStyles },
    // structural
    {
      name: "all themes return non-null result",
      fn: testAllThemesReturnNonNullResult,
    },
    {
      name: "production paths use chrome:// protocol",
      fn: testProductionPathsUseChromeProtocol,
    },
    // Additional tests
    {
      name: "fluerial has iconBasePath in dev",
      fn: testFluerialHasIconBasePathInDev,
    },
    {
      name: "lepton has iconBasePath in dev",
      fn: testLeptonHasIconBasePathInDev,
    },
    {
      name: "photon has both chrome and content styles",
      fn: testPhotonHasBothStyleTypes,
    },
    {
      name: "protonfix has both chrome and content styles",
      fn: testProtonfixHasBothStyleTypes,
    },
    {
      name: "userjs content is non-empty for themes that have it",
      fn: testUserjsContentNonEmpty,
    },
    {
      name: "production themes can combine chromeStyles and chromeStylesRaw",
      fn: testProductionThemesCanCombineChromeStylesAndRaw,
    },
  ]);
}

// ---------------------------------------------------------------------------
// Additional Tests — FCSS edge cases and invariants
// ---------------------------------------------------------------------------

function testFluerialHasIconBasePathInDev(): void {
  const result = getCSSFromConfig(makeConfig("fluerial"));
  // In dev mode, iconBasePath should be present
  // In production, it's undefined (chrome:// URLs don't need it)
  const hasIconPath = result.iconBasePath !== undefined;
  assert(
    hasIconPath || result.chromeStyles !== undefined,
    "fluerial should have iconBasePath in dev or chromeStyles in prod",
  );
}

function testLeptonHasIconBasePathInDev(): void {
  const result = getCSSFromConfig(makeConfig("lepton"));
  const hasIconPath = result.iconBasePath !== undefined;
  assert(
    hasIconPath || result.chromeStyles !== undefined,
    "lepton should have iconBasePath in dev or chromeStyles in prod",
  );
}

function testPhotonHasBothStyleTypes(): void {
  const result = getCSSFromConfig(makeConfig("photon"));
  // Photon has both chrome styles (chromeStyles/chromeStylesRaw)
  // and content styles (styles/stylesRaw)
  const hasChromeStyles = (result.chromeStyles?.length ?? 0) > 0 ||
    (result.chromeStylesRaw?.length ?? 0) > 0;
  const hasContentStyles = (result.styles?.length ?? 0) > 0 ||
    (result.stylesRaw?.length ?? 0) > 0;

  assertEquals(
    hasChromeStyles && hasContentStyles,
    true,
    "photon should have both chrome and content styles",
  );
}

function testProtonfixHasBothStyleTypes(): void {
  const result = getCSSFromConfig(makeConfig("protonfix"));
  // Protonfix also has both chrome and content styles
  const hasChromeStyles = (result.chromeStyles?.length ?? 0) > 0 ||
    (result.chromeStylesRaw?.length ?? 0) > 0;
  const hasContentStyles = (result.styles?.length ?? 0) > 0 ||
    (result.stylesRaw?.length ?? 0) > 0;

  assertEquals(
    hasChromeStyles && hasContentStyles,
    true,
    "protonfix should have both chrome and content styles",
  );
}

function testUserjsContentNonEmpty(): void {
  const themesWithUserjs: Array<
    TFloorpDesignConfigs["globalConfigs"]["userInterface"]
  > = ["lepton", "photon", "protonfix"];

  for (const theme of themesWithUserjs) {
    const result = getCSSFromConfig(makeConfig(theme));
    assertEquals(
      result.userjs !== null && result.userjs!.length > 0,
      true,
      `${theme} should have non-empty userjs`,
    );
  }
}

function testProductionThemesCanCombineChromeStylesAndRaw(): void {
  if (import.meta.env.DEV) {
    return;
  }

  const themes: Array<
    TFloorpDesignConfigs["globalConfigs"]["userInterface"]
  > = ["fluerial", "lepton", "photon", "protonfix"];

  for (const theme of themes) {
    const result = getCSSFromConfig(makeConfig(theme));
    const hasChromeStyles = (result.chromeStyles?.length ?? 0) > 0;
    const hasChromeStylesRaw = (result.chromeStylesRaw?.length ?? 0) > 0;

    assert(
      hasChromeStyles || hasChromeStylesRaw,
      `${theme} should expose chromeStyles and/or chromeStylesRaw in production`,
    );
  }
}

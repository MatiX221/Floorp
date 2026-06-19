/* -*- indent-tabs-mode: nil; js-indent-level: 2 -*-
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * # Gecko 152 (Project Nova) CSS variable aliases — Floorp-wide
 *
 * ## Why this exists
 *
 * Firefox 152 ("Project Nova", 2026-06-16) renamed a large set of CSS custom
 * properties by dropping the legacy `bgcolor` / `textcolor` / `background`
 * suffixes in favor of the more regular `background-color` / `text-color` /
 * `background-color` forms. Both the definitions and the internal references
 * in mozilla-central moved to the new names.
 *
 * Floorp's own chrome components (statusbar, panel-sidebar, workspaces, PWA,
 * split-view, downloadbar, fluerial, command-palette, ui-custom options,
 * ...) still reference the pre-152 names in dozens of places — and the LWT
 * runtime sets `--panel-sidebar-background-color` via `var(--toolbar-bgcolor)`
 * at runtime. With the old names gone on 152, all of those resolve to nothing,
 * which surfaces as transparent / unstyled surfaces (e.g. the status bar
 * turning transparent — the symptom that prompted this file).
 *
 * ## Approach
 *
 * Re-expose every renamed token under its legacy name as an alias of the new
 * name. This is a single, Floorp-wide shim rather than touching 50+ call
 * sites, because:
 *   - the rename is mechanical (same semantics, different spelling),
 *   - it keeps the vendored Lepton CSS untouched (update_lepton.yml safe),
 *   - it is forward-compatible: when Gecko eventually drops the old names
 *     entirely the aliases simply no-op, and Floorp can migrate component by
 *     component.
 *
 * The aliases are declared WITHOUT !important and only set a value when the
 * legacy name is otherwise undefined, so any code that legitimately sets the
 * old name still wins. They are wrapped so they also work on Gecko < 152,
 * where the new names do not exist (the alias then just aliases the legacy
 * name to itself, harmlessly).
 *
 * ## Where the mapping comes from
 *
 * The 151 -> 152 runtime diff (Floorp-Runtime PR #45), cross-checked against
 * live `getComputedStyle()` measurements on :root (which confirmed which old
 * names are now undefined and which new names carry the value).
 *
 * ## Injection point
 *
 * Applied to ALL designs via `browser-design-element.tsx`, not just the
 * Lepton family — because Floorp's own components (not only Lepton) read
 * these names. See Issue #2489.
 */

/**
 * The full alias table. Each entry maps `[legacyName, newName]`. The alias is
 * emitted as `legacyName: var(newName, var(legacyName))` so that:
 *  - on Gecko 152+, where legacyName is undefined but newName is set, the
 *    alias resolves to newName;
 *  - on Gecko < 152, where newName is undefined but legacyName is set, the
 *    alias resolves to legacyName itself (no-op);
 *  - if both are set (transition period), legacyName keeps its own value.
 */
export const GECKO_152_RENAMED_VARS: ReadonlyArray<
  readonly [string, string]
> = [
  // Toolbar / toolbox surface colors
  ["--toolbar-bgcolor", "--toolbar-background-color"],
  ["--toolbar-color", "--toolbar-text-color"],
  ["--toolbox-bgcolor", "--toolbox-background-color"],
  ["--toolbox-textcolor", "--toolbox-text-color"],
  ["--toolbox-bgcolor-inactive", "--toolbox-background-color-inactive"],
  ["--toolbox-textcolor-inactive", "--toolbox-text-color-inactive"],

  // Tab tokens (also covered by the Lepton compat layer, but Floorp's own
  // workspaces CSS reads --tab-selected-bgcolor too, so declare globally)
  ["--tab-selected-bgcolor", "--tab-background-color-selected"],
  /* --tab-selected-textcolor was NOT renamed in Gecko 152 — only its referenced
     value changed from --toolbar-color to --toolbar-text-color (handled below). */
  ["--tab-hover-background-color", "--tab-background-color-hover"],

  // Toolbar buttons
  ["--toolbarbutton-hover-background", "--toolbarbutton-background-color-hover"],
  [
    "--toolbarbutton-active-background",
    "--toolbarbutton-background-color-active",
  ],

  // Panels / arrow panels (arrowpanel-* were folded into the panel-* family)
  ["--arrowpanel-background", "--panel-background-color"],
  ["--arrowpanel-color", "--panel-text-color"],
  ["--arrowpanel-border-color", "--panel-border-color"],
  ["--panel-background", "--panel-background-color"],
  // Note: --panel-text-color was NOT renamed in Gecko 152, so it has no alias
  // entry — a self-referential `var(--panel-text-color, var(--panel-text-color))`
  // would be a cyclic no-op.
  ["--panel-dimmed", "--panel-background-color-dimmed"],
  ["--panel-dimmed-further", "--panel-background-color-dimmed-further"],
];

function buildAliasDeclarations(): string {
  // `var(newName, var(legacyName))`: prefer the new 152 name, fall back to the
  // legacy name on older Gecko. No !important — see module doc.
  const lines = GECKO_152_RENAMED_VARS.map(([legacy, renamed]) =>
    `  ${legacy}: var(${renamed}, var(${legacy}));`
  );
  return lines.join("\n");
}

/**
 * The variable alias stylesheet. Injected for every Floorp design so all
 * Floorp chrome components (and the vendored Lepton CSS) keep resolving the
 * pre-152 variable names.
 */
export const GECKO_152_VAR_ALIASES_CSS = `
/* =========================================================================
 * Floorp Gecko 152 variable aliases (Floorp-wide)
 * Re-exposes pre-152 CSS custom property names as aliases of the 152 names.
 * See utils/gecko-152-var-aliases.css.ts.
 * ======================================================================= */
:root {
${buildAliasDeclarations()}
}
`;

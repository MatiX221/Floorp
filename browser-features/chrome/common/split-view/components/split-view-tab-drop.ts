/* -*- indent-tabs-mode: nil; js-indent-level: 2 -*-
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import i18next from "i18next";
import {
  getGBrowser,
  type SplitViewTab,
  type SplitViewWrapper,
} from "../data/types.js";
import { splitViewConfig } from "../data/config.js";
import {
  computeDropZone,
  computeLayoutForExistingSplit,
  zoneToLayout,
  zoneToTabOrder,
  type DropZone,
} from "../utils/zone-computation.js";
import {
  showDropOverlay,
  hideDropOverlay,
  removeDropOverlay,
} from "./split-view-drop-overlay.js";
import {
  getActiveSplitViewGroupId,
  setPersistedGroupLayout,
} from "../patches/session-restore.js";
import { applyLayout } from "../layout.js";
import { forceCleanupDragState } from "../utils/force-cleanup.js";

const TAB_DROP_TYPE = "application/x-moz-tabbrowser-tab";
const NEW_WINDOW_ZONE_ID = "floorp-new-window-drop-zone";

let activeZone: DropZone = "right";
let isTabDragging = false;
/** Tab being dragged, captured at dragstart. */
let draggedTabAtStart: SplitViewTab | null = null;
let cleanupFns: (() => void)[] = [];
let logger: ConsoleInstance | null = null;
/**
 * Heartbeat timer: dragover fires continuously during a drag (~60fps).
 * If this timer expires, the cursor has left the window — hide overlays.
 * Workaround for Firefox Bugzilla #656164 where dragleave doesn't fire
 * for native tab drags leaving the window.
 */
let dragLeaveTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Watchdog: if `data-floorp-tab-dragging` (or any sibling drag attribute)
 * lingers on tabpanels for more than this duration without a fresh dragover,
 * we assume the drag's terminal events (dragend/drop) were lost and force a
 * cleanup. Keep this short enough that users don't notice a stuck state,
 * but long enough that legitimate pauses in dragover don't trigger it.
 */
const STUCK_DRAG_WATCHDOG_MS = 2000;
let stuckDragWatchdog: ReturnType<typeof setTimeout> | null = null;

const t = (key: string, opts?: Record<string, string>): string =>
  (i18next.t as (k: string, o?: Record<string, string>) => string)(key, opts);

function getTabpanels(): HTMLElement | null {
  return document?.getElementById("tabbrowser-tabpanels") as HTMLElement | null;
}

/**
 * Find any existing split view wrapper by scanning tabs for `splitview`.
 * Works even after Firefox "deactivates" the split view by switching tabs,
 * because the wrapper reference persists on the tab objects.
 */
function findExistingSplitView(): SplitViewWrapper | null {
  const gBrowser = getGBrowser();
  if (!gBrowser) return null;
  if (gBrowser.activeSplitView) return gBrowser.activeSplitView;
  for (const tab of gBrowser.tabs) {
    if (tab.splitview) return tab.splitview as unknown as SplitViewWrapper;
  }
  return null;
}

/**
 * Find the most recently active tab (highest _lastAccessed) that is NOT the
 * dragged tab. Uses Firefox's internal _lastAccessed timestamp — same pattern
 * as gecko-show-previously-selected-tab in mouse-gesture/utils/actions.ts.
 * Split view tabs are included so the user's last-viewed tab is always chosen.
 */
function findLastActivePartnerTab(
  gBrowser: NonNullable<ReturnType<typeof getGBrowser>>,
  excludeTab: SplitViewTab,
): SplitViewTab | null {
  let best: SplitViewTab | null = null;
  let bestTime = -1;
  for (const tab of gBrowser.tabs) {
    if (tab === excludeTab) continue;
    const accessed = (tab as SplitViewTab & { _lastAccessed?: number })
      ._lastAccessed;
    // Infinity = currently selected tab — most recently active, return immediately
    if (accessed === Infinity) return tab as SplitViewTab;
    if (accessed === undefined || accessed === null) continue;
    if (accessed > bestTime) {
      best = tab as SplitViewTab;
      bestTime = accessed;
    }
  }
  return best;
}

function isTabDrag(event: DragEvent): boolean {
  const types = event.dataTransfer?.types;
  if (!types) return false;
  return Array.from(types).includes(TAB_DROP_TYPE);
}

/** Check if the cursor is over the content area (tabpanels rect). */
function isOverContentArea(event: DragEvent): boolean {
  const tabpanels = getTabpanels();
  if (!tabpanels) return false;
  const rect = tabpanels.getBoundingClientRect();
  return (
    event.clientX >= rect.left &&
    event.clientX <= rect.right &&
    event.clientY >= rect.top &&
    event.clientY <= rect.bottom
  );
}

/**
 * Check if the drag event targets an element inside a popup/panel that floats
 * over the content area (e.g. the "List all tabs" menu, app menu, context
 * menus). Such panels host their own drag/drop handling, so we must NOT
 * intercept their events — otherwise tab reordering inside the panel breaks
 * (Issue #2490). These panels visually overlap the content area, so
 * `isOverContentArea` returns true, but `event.target` is the panel's child
 * element, which we use to tell the two cases apart.
 */
function isEventTargetInsidePanel(event: DragEvent): boolean {
  const target = event.target;
  if (!(target instanceof Element)) return false;
  return !!target.closest("panel, panelmultiview, panelview, menupopup");
}

// --- New window drop zone ---

function getOrCreateNewWindowZone(): HTMLElement | null {
  const existing = document?.getElementById(NEW_WINDOW_ZONE_ID);
  if (existing) return existing as HTMLElement;

  const zone = document?.createElement("div") as HTMLElement;
  if (!zone) return null;
  zone.id = NEW_WINDOW_ZONE_ID;

  const icon = document?.createElement("div") as HTMLElement;
  if (icon) {
    icon.className = "floorp-new-window-zone-icon";
    zone.appendChild(icon);
  }

  const label = document?.createElement("div") as HTMLElement;
  if (label) {
    label.className = "floorp-new-window-zone-label";
    label.textContent = t("splitView.dropZone.newWindow");
    zone.appendChild(label);
  }

  zone.addEventListener("dragover", onNewWindowZoneDragOver);
  zone.addEventListener("dragleave", onNewWindowZoneDragLeave);
  zone.addEventListener("drop", onNewWindowZoneDrop);

  document.documentElement!.appendChild(zone);
  return zone;
}

function showNewWindowZone(): void {
  const zone = getOrCreateNewWindowZone();
  if (zone) {
    zone.setAttribute("drag-active", "true");
    const label = zone.querySelector(".floorp-new-window-zone-label");
    if (label) {
      label.textContent = t("splitView.dropZone.newWindow");
    }
  }
}

function removeNewWindowZone(): void {
  const zone = document?.getElementById(NEW_WINDOW_ZONE_ID);
  if (zone) {
    zone.removeEventListener("dragover", onNewWindowZoneDragOver);
    zone.removeEventListener("dragleave", onNewWindowZoneDragLeave);
    zone.removeEventListener("drop", onNewWindowZoneDrop);
    zone.remove();
  }
}

function onNewWindowZoneDragOver(event: DragEvent): void {
  if (!isTabDrag(event)) return;
  const zone = document?.getElementById(NEW_WINDOW_ZONE_ID);
  if (zone) zone.setAttribute("drag-hover", "true");
}

function onNewWindowZoneDragLeave(): void {
  const zone = document?.getElementById(NEW_WINDOW_ZONE_ID);
  if (zone) zone.removeAttribute("drag-hover");
}

function onNewWindowZoneDrop(event: DragEvent): void {
  event.stopPropagation();
  event.preventDefault();
  const zone = document?.getElementById(NEW_WINDOW_ZONE_ID);
  if (zone) zone.removeAttribute("drag-hover");

  const gBrowser = getGBrowser();
  const draggedTab = draggedTabAtStart;
  if (!gBrowser || !draggedTab) {
    cleanup();
    return;
  }

  // Move the dragged tab to a new window
  cleanup();
  gBrowser.replaceTabWithWindow(draggedTab);
}

// --- Document-level drag handlers (capture phase) ---

/** Check if the event target is inside the new window drop zone. */
function isEventInsideNewWindowZone(event: DragEvent): boolean {
  const zone = document.getElementById(NEW_WINDOW_ZONE_ID);
  if (!zone) return false;
  const target = event.target;
  return target instanceof Node ? zone.contains(target) : false;
}

function onDragOver(event: DragEvent): void {
  const types = event.dataTransfer?.types;
  const hasTabType = types ? Array.from(types).includes(TAB_DROP_TYPE) : false;
  if (!hasTabType) return;

  // Heartbeat: dragover stops firing when cursor leaves the window.
  // Reset the timer on every event; if it expires, hide the overlays.
  if (dragLeaveTimer) clearTimeout(dragLeaveTimer);
  dragLeaveTimer = setTimeout(() => {
    if (isTabDragging) {
      hideDropOverlay();
      // Also fully remove the overlay element so a transparent overlay can
      // never linger over the content area and absorb clicks if dragend
      // never fires (Firefox Bugzilla #656164).
      removeDropOverlay();
      removeNewWindowZone();
    }
  }, 150);

  // When over the new window zone, still preventDefault so Firefox's
  // built-in detach-to-window does NOT fire before our drop handler.
  // We skip overlay/zone-computation though — only the zone's own
  // dragover handler (onNewWindowZoneDragOver) needs to run.
  if (isEventInsideNewWindowZone(event)) {
    event.preventDefault();
    event.dataTransfer!.dropEffect = "move";
    return;
  }

  const overContent = isOverContentArea(event);
  if (!overContent) {
    // Bug 4: Hide overlay when cursor leaves the content area
    hideDropOverlay();
    return;
  }

  // Don't claim the drop target when the drag is actually over a floating
  // panel (e.g. the "List all tabs" menu). Such panels handle their own
  // drag/drop and visually overlap the content area, so without this guard
  // our capture-phase preventDefault/stopPropagation would swallow their drop
  // events and break tab reordering inside them (Issue #2490).
  if (isEventTargetInsidePanel(event)) {
    hideDropOverlay();
    return;
  }

  // Prevent default to claim the drop target (prevents detach-to-window)
  event.preventDefault();
  event.dataTransfer!.dropEffect = "move";

  // Bug 3: Set data-floorp-tab-dragging attribute to disable pointer events on content
  const tabpanels = getTabpanels();
  if (tabpanels) {
    tabpanels.setAttribute("data-floorp-tab-dragging", "true");
    // Arm the stuck-drag watchdog: if dragover events stop arriving without
    // a matching dragend/drop, force a cleanup so the attribute can never
    // linger and permanently block mouse input on the content area.
    scheduleStuckDragWatchdog();
  }

  if (!isTabDragging) {
    isTabDragging = true;
  }
  // Re-show the new window zone if the heartbeat timer removed it
  if (!document.getElementById(NEW_WINDOW_ZONE_ID)) {
    showNewWindowZone();
  }

  const draggedTab = draggedTabAtStart;
  const activeSplitView = findExistingSplitView();
  const maxPanes = splitViewConfig().maxPanes;

  if (draggedTab?.splitview) return;
  if (activeSplitView && activeSplitView.tabs.length >= maxPanes) return;

  if (!tabpanels) return;
  const rect = tabpanels.getBoundingClientRect();
  const relX = (event.clientX - rect.left) / rect.width;
  const relY = (event.clientY - rect.top) / rect.height;
  activeZone = computeDropZone(relX, relY);
  showDropOverlay(activeZone);
}

function onDrop(event: DragEvent): void {
  if (!isTabDrag(event)) return;

  // Bug 2: Don't intercept drops inside the new window zone
  if (isEventInsideNewWindowZone(event)) return;

  if (!isOverContentArea(event)) return;

  // Don't intercept drops that target a floating panel (e.g. the "List all
  // tabs" menu) over the content area — let the panel's own drop handler run
  // so tabs can be reordered inside it (Issue #2490).
  if (isEventTargetInsidePanel(event)) return;

  event.preventDefault();
  event.stopPropagation();

  const gBrowser = getGBrowser();
  if (!gBrowser) {
    cleanup();
    return;
  }

  const draggedTab = draggedTabAtStart;
  if (!draggedTab) {
    cleanup();
    return;
  }

  if (draggedTab.splitview) {
    cleanup();
    return;
  }

  // Save state before cleanup — split view creation is deferred so that
  // Firefox's handle_dragend (finishAnimateTabMove, _resetTabsAfterDrop)
  // completes its cleanup first.  Without this delay, handle_dragend resets
  // drag transforms AFTER we've already moved tabs into the wrapper,
  // corrupting the tab bar layout.
  const zone = activeZone;
  const tab = draggedTab;

  cleanup();

  setTimeout(() => {
    // Guard: if tab was closed or destroyed between cleanup and this deferred callback,
    // skip all operations to avoid acting on stale state.
    if (!tab.linkedBrowser) return;
    if (!logger) return;

    // Re-query the current split view state rather than using the pre-cleanup
    // snapshot — the wrapper may have been destroyed or mutated by Firefox's
    // own drag-end handling that ran between cleanup() and this callback.
    const currentSplitView = findExistingSplitView();
    const currentMaxPanes = splitViewConfig().maxPanes;

    try {
      if (tab.splitview) return;

      // Center zone: add pane to existing split view, or create new with default layout
      if (zone === "center") {
        if (currentSplitView && currentSplitView.tabs.length < currentMaxPanes) {
          currentSplitView.addTabs([tab]);
          const newPaneCount = currentSplitView.tabs.length;
          if (newPaneCount === 3) {
            const gridLayout = "grid-3pane-right-main";
            const groupId = getActiveSplitViewGroupId();
            if (groupId) {
              setPersistedGroupLayout(groupId, gridLayout);
            }
            applyLayout(logger);
          } else if (newPaneCount === 4) {
            const groupId = getActiveSplitViewGroupId();
            if (groupId) {
              setPersistedGroupLayout(groupId, "grid-2x2");
            }
            applyLayout(logger);
          }
        } else if (!currentSplitView) {
          const partnerTab = findLastActivePartnerTab(gBrowser, tab);
          if (!partnerTab) return;
          if (partnerTab.splitview) {
            const existingWrapper = partnerTab.splitview as unknown as SplitViewWrapper;
            if (existingWrapper.tabs.length < currentMaxPanes) {
              existingWrapper.addTabs([tab]);
              // Apply grid-3pane layout for 2→3 pane transition on center drop
              const newPaneCount = existingWrapper.tabs.length;
              if (newPaneCount === 3) {
                const groupId = getActiveSplitViewGroupId();
                if (groupId) {
                  setPersistedGroupLayout(groupId, "grid-3pane-right-main");
                }
              }
              applyLayout(logger);
            }
          } else {
            const wrapper = gBrowser.addTabSplitView([partnerTab, tab]);
            if (wrapper) {
              applyLayout(logger);
            }
          }
        }
        return;
      }

      // Edge zones: add to existing split view if partner is in one,
      // otherwise create a new split view with the most recently active tab.
      {
        const partnerTab = findLastActivePartnerTab(gBrowser, tab);
        if (!partnerTab) return;
        if (partnerTab.splitview) {
          const existingWrapper = partnerTab.splitview as unknown as SplitViewWrapper;
          if (existingWrapper.tabs.length < currentMaxPanes) {
            existingWrapper.addTabs([tab]);
            const layout = computeLayoutForExistingSplit(zone, existingWrapper.tabs.length - 1);
            if (layout) {
              const groupId = getActiveSplitViewGroupId();
              if (groupId) setPersistedGroupLayout(groupId, layout);
            }
            applyLayout(logger);
          }
        } else {
          const layout = zoneToLayout(zone);
          const [first, second] = zoneToTabOrder(zone, partnerTab, tab);
          const wrapper = gBrowser.addTabSplitView([first, second]);
          if (wrapper) {
            const groupId = getActiveSplitViewGroupId();
            if (groupId) {
              setPersistedGroupLayout(groupId, layout);
            }
            applyLayout(logger);
          }
        }
      }
    } catch (err) {
      logger.error("[tab-drop] Error in deferred drop handler:", err);
    }
  }, 0);
}

function onDragEnd(): void {
  cleanup();
  // Belt-and-suspenders: ensure Firefox's "movingtab" attribute is cleared.
  // handle_dragend normally does this, but if the dragged tab was consumed
  // by our drop handler, the attribute may linger on gNavToolbox, which
  // applies `pointer-events: none` to the nav-bar and blocks all clicks
  // (including context menus).
  document.getElementById("tabbrowser-tabs")?.removeAttribute("movingtab");
  document.getElementById("navigator-toolbox")?.removeAttribute("movingtab");
}

/**
 * When the drag leaves the document (cursor moves outside the browser window),
 * hide the overlay and new-window zone so they don't linger. dragend may not
 * fire reliably when Firefox natively detaches the tab to a new window.
 * The elements are re-shown on the next dragover if the cursor returns.
 */
function onDragLeave(event: DragEvent): void {
  if (!isTabDragging) return;
  // relatedTarget is null when the pointer leaves the document entirely.
  // When moving between children of the same document, relatedTarget is
  // the element being entered.
  const related = event.relatedTarget;
  if (related === null || !(related instanceof Node) || !document.contains(related)) {
    hideDropOverlay();
    removeNewWindowZone();
  }
}

/** Capture split view state and dragged tab on dragstart. */
function onDragStart(event: DragEvent): void {
  const types = event.dataTransfer?.types;
  if (!types) return;
  if (!Array.from(types).includes(TAB_DROP_TYPE)) return;
  const gBrowser = getGBrowser();
  if (!gBrowser) return;

  // Try to identify the actual dragged tab:
  // 1. event.target on tabContainer is the tab element, which has a
  //    linkedTab property pointing to the SplitViewTab.
  // 2. Firefox's tabContainer exposes _tabForDragEvent(event) which
  //    resolves the tab element from the drag event source node.
  // 3. Fallback to selectedTab only when both above fail.
  const target = event.target;
  if (
    target &&
    typeof target === "object" &&
    "linkedTab" in target &&
    target.linkedTab
  ) {
    draggedTabAtStart = target.linkedTab as SplitViewTab;
    return;
  }

  const tabContainer = gBrowser.tabContainer as unknown as HTMLElement & {
    _tabForDragEvent?: (e: DragEvent) => SplitViewTab | null;
  };
  if (tabContainer._tabForDragEvent) {
    const dragTab = tabContainer._tabForDragEvent(event);
    if (dragTab) {
      draggedTabAtStart = dragTab;
      return;
    }
  }

  draggedTabAtStart = gBrowser.selectedTab ?? null;
}

function cleanup(): void {
  if (dragLeaveTimer) {
    clearTimeout(dragLeaveTimer);
    dragLeaveTimer = null;
  }
  clearStuckDragWatchdog();
  isTabDragging = false;
  draggedTabAtStart = null;
  activeZone = "right";
  removeDropOverlay();
  removeNewWindowZone();
  // Belt-and-suspenders: clear every drag-related attribute and overlay
  // element that could leak across event races. `dragend` may not fire
  // reliably (Firefox Bugzilla #656164 — e.g. when the tab is detached to
  // a new window), so every exit path must guarantee a full cleanup.
  // `forceCleanupDragState` is idempotent and a no-op when nothing is leaked.
  forceCleanupDragState(logger);
}

/**
 * Arm (or re-arm) the stuck-drag watchdog. Called on every dragover while
 * `data-floorp-tab-dragging` is set. If `STUCK_DRAG_WATCHDOG_MS` elapses
 * without a fresh dragover, dragend, or drop, we treat the drag as lost
 * (the most common cause is detach-to-window, where Firefox never delivers
 * dragend/drop to this window) and force a cleanup so mouse input on the
 * content area is restored instead of staying blocked until restart.
 */
function scheduleStuckDragWatchdog(): void {
  if (stuckDragWatchdog) clearTimeout(stuckDragWatchdog);
  stuckDragWatchdog = setTimeout(() => {
    stuckDragWatchdog = null;
    const tabpanels = getTabpanels();
    const stuck = tabpanels?.hasAttribute("data-floorp-tab-dragging") ?? false;
    if (stuck) {
      logger?.warn(
        "[tab-drop] stuck-drag watchdog fired — dragend/drop was lost, " +
          "forcing cleanup to restore mouse input",
      );
      cleanup();
    }
  }, STUCK_DRAG_WATCHDOG_MS);
}

function clearStuckDragWatchdog(): void {
  if (stuckDragWatchdog) {
    clearTimeout(stuckDragWatchdog);
    stuckDragWatchdog = null;
  }
}

// --- Public API ---

export function initTabDrop(initLogger: ConsoleInstance): void {
  logger = initLogger;
  const onOver = (e: Event) => onDragOver(e as DragEvent);
  const onDropFn = (e: Event) => onDrop(e as DragEvent);
  const onEnd = () => onDragEnd();
  const onStart = (e: Event) => onDragStart(e as DragEvent);
  const onLeave = (e: Event) => onDragLeave(e as DragEvent);

  // Safety-net listeners: `dragend`/`drop` can be lost (Firefox Bugzilla
  // #656164) and leave `data-floorp-tab-dragging` on tabpanels, which
  // permanently blocks mouse input on the content area. Reaching a mouseup,
  // a window blur, a visibility change, or a TabClose during an active drag
  // is a strong signal that the drag is over — force a cleanup in those
  // cases. `cleanup()` is idempotent and a no-op when nothing is active.
  const onGlobalMouseUp = (): void => {
    if (isTabDragging) cleanup();
  };
  const onWindowBlur = (): void => {
    if (isTabDragging) cleanup();
  };
  const onVisibilityChange = (): void => {
    if (document.hidden && isTabDragging) cleanup();
  };
  // Detach-to-window: when a tab is dragged out of the window, Firefox
  // closes the source tab (dispatching TabClose on it) and opens a new
  // window — but never delivers dragend/drop to this window. This is the
  // exact race the PR's other safety nets can only approximate (the watchdog
  // recovers it after a delay); TabClose lets us recover *instantly*. We
  // only react when the closed tab is the one we captured at dragstart, so
  // an unrelated tab closing mid-drag does not abort the active drag.
  const onTabClose = (event: Event): void => {
    if (!isTabDragging) return;
    const closingTab = event.target as SplitViewTab | null;
    if (closingTab && closingTab === draggedTabAtStart) {
      logger?.warn(
        "[tab-drop] dragged tab closed mid-drag — assuming detach-to-window, " +
          "forcing cleanup to restore mouse input",
      );
      cleanup();
    }
  };

  // Capture split view state on dragstart (before Firefox switches tabs).
  const tabContainer = getGBrowser()?.tabContainer;
  if (tabContainer) {
    tabContainer.addEventListener("dragstart", onStart);
  }

  // Use capture phase on document to intercept events before they
  // reach the browser content area (which forwards to content process).
  document.addEventListener("dragover", onOver, true);
  document.addEventListener("drop", onDropFn, true);
  document.addEventListener("dragend", onEnd);
  document.addEventListener("dragleave", onLeave);

  // Global safety nets (capture phase so we see them first).
  globalThis.addEventListener("mouseup", onGlobalMouseUp, true);
  globalThis.addEventListener("blur", onWindowBlur, true);
  document.addEventListener("visibilitychange", onVisibilityChange);
  globalThis.addEventListener("TabClose", onTabClose);

  cleanupFns = [
    () => tabContainer?.removeEventListener("dragstart", onStart),
    () => document.removeEventListener("dragover", onOver, true),
    () => document.removeEventListener("drop", onDropFn, true),
    () => document.removeEventListener("dragend", onEnd),
    () => document.removeEventListener("dragleave", onLeave),
    () => globalThis.removeEventListener("mouseup", onGlobalMouseUp, true),
    () => globalThis.removeEventListener("blur", onWindowBlur, true),
    () => document.removeEventListener("visibilitychange", onVisibilityChange),
    () => globalThis.removeEventListener("TabClose", onTabClose),
  ];

  logger.debug("[tab-drop] document-level listeners attached (capture phase)");
}

export function destroyTabDrop(): void {
  for (const fn of cleanupFns) fn();
  cleanupFns = [];
  removeDropOverlay();
  removeNewWindowZone();
  clearStuckDragWatchdog();
  cleanup();
  logger = null;
}

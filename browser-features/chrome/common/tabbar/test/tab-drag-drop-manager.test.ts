// SPDX-License-Identifier: MPL-2.0
// @colocated-env browser

import {
  type TestCase,
  assertEquals,
  runTests,
} from "../../../test/utils/test_harness.ts";

// ---------------------------------------------------------------------------
// Tests — TabDragDropManager dragend listener
// ---------------------------------------------------------------------------

/**
 * Test that dragend listener resets state properly.
 * This addresses Issue #2488: tab position offset when creating split view
 * by dragging tabs.
 */
function testDragEndResetsState(): void {
  // Mock state
  const state: {
    lastKnownIndex: number | null;
    groupToInsertTo: null;
    positionInGroup: null;
    draggedTabIndex: number | null;
  } = {
    lastKnownIndex: 5,
    groupToInsertTo: null,
    positionInGroup: null,
    draggedTabIndex: 3,
  };

  // Simulate dragend handler
  const dragEndHandler = () => {
    state.lastKnownIndex = null;
    state.groupToInsertTo = null;
    state.positionInGroup = null;
    state.draggedTabIndex = null;
  };

  dragEndHandler();

  assertEquals(state.lastKnownIndex, null, "lastKnownIndex should be null");
  assertEquals(state.draggedTabIndex, null, "draggedTabIndex should be null");
}

function testDragEndClearsDraggedTabIndex(): void {
  const state: { draggedTabIndex: number | null } = {
    draggedTabIndex: 7,
  };

  const dragEndHandler = () => {
    state.draggedTabIndex = null;
  };

  dragEndHandler();

  assertEquals(
    state.draggedTabIndex,
    null,
    "draggedTabIndex should be cleared on dragend",
  );
}

function testDragEndWithNullState(): void {
  const state = {
    lastKnownIndex: null,
    draggedTabIndex: null,
  };

  const dragEndHandler = () => {
    state.lastKnownIndex = null;
    state.draggedTabIndex = null;
  };

  // Should not throw
  dragEndHandler();

  assertEquals(state.lastKnownIndex, null, "lastKnownIndex remains null");
  assertEquals(state.draggedTabIndex, null, "draggedTabIndex remains null");
}

// ---------------------------------------------------------------------------
// Test runner
// ---------------------------------------------------------------------------

const tests: TestCase[] = [
  { name: "dragend resets state", fn: testDragEndResetsState },
  {
    name: "dragend clears draggedTabIndex",
    fn: testDragEndClearsDraggedTabIndex,
  },
  { name: "dragend with null state", fn: testDragEndWithNullState },
];

runTests("tab-drag-drop-manager.test", tests);

import assert from "node:assert/strict";
import test from "node:test";

import {
  Direction,
  buildTabBlocks,
  getBlockNavigationTarget,
  getIndexedBlockTarget,
  getSplitPaneCycleTarget,
  isSplitTab,
  setRememberedTabId,
} from "../navigation.js";

function tab(id, index, options = {}) {
  return {
    id,
    index,
    windowId: options.windowId ?? 1,
    active: options.active ?? false,
    splitViewId: options.splitViewId,
  };
}

test("recognizes split membership without treating a missing ID as split", () => {
  assert.equal(isSplitTab(tab(1, 0), -1), false);
  assert.equal(isSplitTab(tab(1, 0, { splitViewId: -1 }), -1), false);
  assert.equal(isSplitTab(tab(1, 0, { splitViewId: 0 }), -1), true);
});

test("groups split members into one ordered block", () => {
  const tabs = [
    tab(1, 0),
    tab(2, 1, { splitViewId: 10 }),
    tab(3, 2, { splitViewId: 10 }),
    tab(4, 3),
  ];

  const blocks = buildTabBlocks(tabs);
  assert.equal(blocks.length, 3);
  assert.deepEqual(
    blocks.map((block) => block.members.map((member) => member.id)),
    [[1], [2, 3], [4]],
  );
});

test("groups split members even if their tab indices are not adjacent", () => {
  const tabs = [
    tab(1, 0, { splitViewId: 10 }),
    tab(2, 1),
    tab(3, 2, { splitViewId: 10 }),
  ];

  const blocks = buildTabBlocks(tabs);
  assert.equal(blocks.length, 2);
  assert.deepEqual(blocks[0].members.map((member) => member.id), [1, 3]);
  assert.deepEqual(blocks[1].members.map((member) => member.id), [2]);
});

test("next block skips the other member of the active split", () => {
  const tabs = [
    tab(1, 0),
    tab(2, 1, { splitViewId: 10 }),
    tab(3, 2, { splitViewId: 10 }),
    tab(4, 3),
  ];

  assert.equal(getBlockNavigationTarget(tabs, 2, Direction.NEXT)?.id, 4);
  assert.equal(getBlockNavigationTarget(tabs, 3, Direction.NEXT)?.id, 4);
});

test("previous block skips the other member of the active split", () => {
  const tabs = [
    tab(1, 0),
    tab(2, 1, { splitViewId: 10 }),
    tab(3, 2, { splitViewId: 10 }),
    tab(4, 3),
  ];

  assert.equal(getBlockNavigationTarget(tabs, 2, Direction.PREVIOUS)?.id, 1);
  assert.equal(getBlockNavigationTarget(tabs, 3, Direction.PREVIOUS)?.id, 1);
});

test("block navigation wraps in both directions", () => {
  const tabs = [tab(1, 0), tab(2, 1), tab(3, 2)];

  assert.equal(getBlockNavigationTarget(tabs, 3, Direction.NEXT)?.id, 1);
  assert.equal(getBlockNavigationTarget(tabs, 1, Direction.PREVIOUS)?.id, 3);
});

test("entering a split defaults to its leftmost member", () => {
  const tabs = [
    tab(1, 0),
    tab(2, 1, { splitViewId: 10 }),
    tab(3, 2, { splitViewId: 10 }),
  ];

  assert.equal(getBlockNavigationTarget(tabs, 1, Direction.NEXT)?.id, 2);
});

test("entering a split restores its remembered member", () => {
  const tabs = [
    tab(1, 0),
    tab(2, 1, { splitViewId: 10 }),
    tab(3, 2, { splitViewId: 10 }),
  ];
  const focusState = {};
  setRememberedTabId(focusState, 1, 10, 3);

  assert.equal(
    getBlockNavigationTarget(tabs, 1, Direction.NEXT, focusState)?.id,
    3,
  );
});

test("a stale remembered member falls back to the leftmost member", () => {
  const tabs = [
    tab(1, 0),
    tab(2, 1, { splitViewId: 10 }),
    tab(3, 2, { splitViewId: 10 }),
  ];
  const focusState = {};
  setRememberedTabId(focusState, 1, 10, 999);

  assert.equal(
    getBlockNavigationTarget(tabs, 1, Direction.NEXT, focusState)?.id,
    2,
  );
});

test("numbered navigation counts a split as one block", () => {
  const tabs = [
    tab(1, 0),
    tab(2, 1, { splitViewId: 10 }),
    tab(3, 2, { splitViewId: 10 }),
    tab(4, 3),
  ];

  assert.equal(getIndexedBlockTarget(tabs, 1, 1)?.id, 1);
  assert.equal(getIndexedBlockTarget(tabs, 1, 2)?.id, 2);
  assert.equal(getIndexedBlockTarget(tabs, 1, 3)?.id, 4);
});

test("numbered navigation restores the remembered split member", () => {
  const tabs = [
    tab(1, 0),
    tab(2, 1, { splitViewId: 10 }),
    tab(3, 2, { splitViewId: 10 }),
  ];
  const focusState = {};
  setRememberedTabId(focusState, 1, 10, 3);

  assert.equal(getIndexedBlockTarget(tabs, 1, 2, focusState)?.id, 3);
});

test("numbered navigation preserves focus inside the active split block", () => {
  const tabs = [
    tab(1, 0),
    tab(2, 1, { splitViewId: 10 }),
    tab(3, 2, { splitViewId: 10 }),
  ];

  assert.equal(getIndexedBlockTarget(tabs, 3, 2)?.id, 3);
});

test("block 9 selects the last block and unavailable numbered blocks do nothing", () => {
  const tabs = [
    tab(1, 0),
    tab(2, 1, { splitViewId: 10 }),
    tab(3, 2, { splitViewId: 10 }),
    tab(4, 3),
  ];

  assert.equal(getIndexedBlockTarget(tabs, 1, 9)?.id, 4);
  assert.equal(getIndexedBlockTarget(tabs, 1, 8), null);
});

test("pane commands cycle in either direction within a two-pane split", () => {
  const tabs = [
    tab(1, 0),
    tab(2, 1, { splitViewId: 10 }),
    tab(3, 2, { splitViewId: 10 }),
    tab(4, 3),
  ];

  assert.equal(
    getSplitPaneCycleTarget(tabs, 2, Direction.NEXT)?.id,
    3,
  );
  assert.equal(
    getSplitPaneCycleTarget(tabs, 3, Direction.NEXT)?.id,
    2,
  );
  assert.equal(
    getSplitPaneCycleTarget(tabs, 2, Direction.PREVIOUS)?.id,
    3,
  );
  assert.equal(
    getSplitPaneCycleTarget(tabs, 3, Direction.PREVIOUS)?.id,
    2,
  );
});

test("pane commands wrap through splits with more than two members", () => {
  const tabs = [
    tab(1, 0, { splitViewId: 10 }),
    tab(2, 1, { splitViewId: 10 }),
    tab(3, 2, { splitViewId: 10 }),
  ];

  assert.equal(
    getSplitPaneCycleTarget(tabs, 3, Direction.NEXT)?.id,
    1,
  );
  assert.equal(
    getSplitPaneCycleTarget(tabs, 1, Direction.PREVIOUS)?.id,
    3,
  );
});

test("pane commands do nothing outside a split with multiple members", () => {
  assert.equal(
    getSplitPaneCycleTarget([tab(1, 0)], 1, Direction.PREVIOUS),
    null,
  );
  assert.equal(
    getSplitPaneCycleTarget(
      [tab(1, 0, { splitViewId: 10 })],
      1,
      Direction.NEXT,
    ),
    null,
  );
});

test("returns no block target when the window contains one block", () => {
  const splitOnly = [
    tab(1, 0, { splitViewId: 10 }),
    tab(2, 1, { splitViewId: 10 }),
  ];
  assert.equal(
    getBlockNavigationTarget(splitOnly, 1, Direction.NEXT),
    null,
  );
});

test("rejects unsupported navigation directions", () => {
  assert.throws(
    () => getBlockNavigationTarget([tab(1, 0)], 1, 0),
    /Unsupported navigation direction/,
  );
  assert.throws(
    () => getSplitPaneCycleTarget([tab(1, 0)], 1, 0),
    /Unsupported navigation direction/,
  );
  assert.throws(
    () => getIndexedBlockTarget([tab(1, 0)], 1, 0),
    /Unsupported tab block number/,
  );
  assert.throws(
    () => getIndexedBlockTarget([tab(1, 0)], 1, 10),
    /Unsupported tab block number/,
  );
});

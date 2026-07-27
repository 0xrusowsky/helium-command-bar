import assert from "node:assert/strict";
import test from "node:test";

import {
  Direction,
  buildTabBlocks,
  getAdjacentBlockIndex,
  getBlockNavigationTarget,
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

test("an open viewer supports arbitrary next and previous movement", () => {
  const blocks = buildTabBlocks([
    tab(1, 0),
    tab(2, 1, { splitViewId: 10 }),
    tab(3, 2, { splitViewId: 10 }),
    tab(4, 3),
  ]);
  let selectedKey = null;

  function move(direction) {
    const index = getAdjacentBlockIndex(blocks, 1, selectedKey, direction);
    selectedKey = blocks[index].key;
    return blocks[index].members.map((member) => member.id);
  }

  assert.deepEqual(move(Direction.NEXT), [2, 3]);
  assert.deepEqual(move(Direction.NEXT), [4]);
  assert.deepEqual(move(Direction.PREVIOUS), [2, 3]);
  assert.deepEqual(move(Direction.PREVIOUS), [1]);
  assert.deepEqual(move(Direction.PREVIOUS), [4]);
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
    () => getAdjacentBlockIndex(buildTabBlocks([tab(1, 0)]), 1, null, 0),
    /Unsupported navigation direction/,
  );
  assert.throws(
    () => getSplitPaneCycleTarget([tab(1, 0)], 1, 0),
    /Unsupported navigation direction/,
  );
});

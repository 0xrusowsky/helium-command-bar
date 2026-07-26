export const Direction = Object.freeze({
  PREVIOUS: -1,
  NEXT: 1,
});

export function isSplitTab(tab, splitViewIdNone = -1) {
  return (
    tab?.splitViewId !== undefined &&
    tab.splitViewId !== null &&
    tab.splitViewId !== splitViewIdNone
  );
}

function compareTabs(left, right) {
  return left.index - right.index || left.id - right.id;
}

/**
 * Groups a window's tabs into ordered navigation blocks. A normal tab forms a
 * block by itself; every tab with the same splitViewId shares one block.
 */
export function buildTabBlocks(tabs, splitViewIdNone = -1) {
  const blocksByKey = new Map();

  for (const tab of [...tabs].sort(compareTabs)) {
    const split = isSplitTab(tab, splitViewIdNone);
    const key = split ? `split:${tab.splitViewId}` : `tab:${tab.id}`;

    let block = blocksByKey.get(key);
    if (!block) {
      block = {
        key,
        type: split ? "split" : "normal",
        splitViewId: split ? tab.splitViewId : null,
        members: [],
        index: tab.index,
      };
      blocksByKey.set(key, block);
    }

    block.members.push(tab);
    block.index = Math.min(block.index, tab.index);
  }

  return [...blocksByKey.values()]
    .map((block) => ({
      ...block,
      members: block.members.sort(compareTabs),
    }))
    .sort((left, right) => left.index - right.index);
}

export function findBlockIndex(blocks, tabId) {
  return blocks.findIndex((block) =>
    block.members.some((member) => member.id === tabId),
  );
}

function focusStateKey(windowId, splitViewId) {
  return `${windowId}:${splitViewId}`;
}

export function getRememberedTabId(lastFocusedBySplit, windowId, splitViewId) {
  return lastFocusedBySplit?.[focusStateKey(windowId, splitViewId)];
}

export function setRememberedTabId(
  lastFocusedBySplit,
  windowId,
  splitViewId,
  tabId,
) {
  lastFocusedBySplit[focusStateKey(windowId, splitViewId)] = tabId;
}

export function removeRememberedTabId(lastFocusedBySplit, windowId, splitViewId) {
  delete lastFocusedBySplit[focusStateKey(windowId, splitViewId)];
}

/** Returns the tab that should receive focus when entering a block. */
export function selectBlockMember(block, lastFocusedBySplit = {}) {
  if (!block || block.members.length === 0) {
    return null;
  }

  if (block.type !== "split") {
    return block.members[0];
  }

  const windowId = block.members[0].windowId;
  const rememberedTabId = getRememberedTabId(
    lastFocusedBySplit,
    windowId,
    block.splitViewId,
  );

  return (
    block.members.find((member) => member.id === rememberedTabId) ??
    block.members[0]
  );
}

/**
 * Returns the destination for block-aware next/previous navigation. Split
 * members are never traversed individually.
 */
export function getBlockNavigationTarget(
  tabs,
  activeTabId,
  direction,
  lastFocusedBySplit = {},
  splitViewIdNone = -1,
) {
  if (direction !== Direction.NEXT && direction !== Direction.PREVIOUS) {
    throw new TypeError(`Unsupported navigation direction: ${direction}`);
  }

  const blocks = buildTabBlocks(tabs, splitViewIdNone);
  const currentBlockIndex = findBlockIndex(blocks, activeTabId);
  if (blocks.length < 2 || currentBlockIndex === -1) {
    return null;
  }

  const targetBlockIndex =
    (currentBlockIndex + direction + blocks.length) % blocks.length;
  return selectBlockMember(blocks[targetBlockIndex], lastFocusedBySplit);
}

/**
 * Returns a numbered block using Chromium's conventional semantics: 1–8 select
 * that exact block and 9 selects the final block. A split counts as one block.
 */
export function getIndexedBlockTarget(
  tabs,
  activeTabId,
  blockNumber,
  lastFocusedBySplit = {},
  splitViewIdNone = -1,
) {
  if (!Number.isInteger(blockNumber) || blockNumber < 1 || blockNumber > 9) {
    throw new TypeError(`Unsupported tab block number: ${blockNumber}`);
  }

  const blocks = buildTabBlocks(tabs, splitViewIdNone);
  const targetBlockIndex = blockNumber === 9 ? blocks.length - 1 : blockNumber - 1;
  const targetBlock = blocks[targetBlockIndex];
  if (!targetBlock) {
    return null;
  }

  // Selecting the block that is already active must not unexpectedly move
  // focus to a different member of the same split.
  const activeMember = targetBlock.members.find(
    (member) => member.id === activeTabId,
  );
  return activeMember ?? selectBlockMember(targetBlock, lastFocusedBySplit);
}

/**
 * Returns the next split member in the requested direction, wrapping at both
 * ends. With a two-pane split, either direction toggles to the other pane.
 */
export function getSplitPaneCycleTarget(
  tabs,
  activeTabId,
  direction,
  splitViewIdNone = -1,
) {
  if (direction !== Direction.NEXT && direction !== Direction.PREVIOUS) {
    throw new TypeError(`Unsupported navigation direction: ${direction}`);
  }

  const activeTab = tabs.find((tab) => tab.id === activeTabId);
  if (!isSplitTab(activeTab, splitViewIdNone)) {
    return null;
  }

  const members = tabs
    .filter(
      (tab) =>
        tab.windowId === activeTab.windowId &&
        tab.splitViewId === activeTab.splitViewId,
    )
    .sort(compareTabs);

  const currentMemberIndex = members.findIndex(
    (member) => member.id === activeTabId,
  );
  if (members.length < 2 || currentMemberIndex === -1) {
    return null;
  }

  const targetMemberIndex =
    (currentMemberIndex + direction + members.length) % members.length;
  return members[targetMemberIndex];
}

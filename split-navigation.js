import {
  Direction,
  buildTabBlocks,
  getAdjacentBlockIndex,
  getSplitPaneCycleTarget,
  isSplitTab,
  selectBlockMember,
  setRememberedTabId,
  sortTabBlocksByRecentUse,
  unfocusedNewTabIds,
} from "./navigation.js";
import {
  DEFAULT_COMMAND_BAR_COLOR,
  normalizeThemeColor,
} from "./theme.js";
import { duplicateTabIds } from "./search.js";
import { checkForExtensionUpdate } from "./update.js";

const FOCUS_STATE_KEY = "lastFocusedBySplit";
const SPLIT_VIEW_ID_NONE = chrome.tabs.SPLIT_VIEW_ID_NONE ?? -1;

const COMMANDS = Object.freeze({
  "cycle-split-pane": { type: "pane", value: Direction.NEXT },
  "previous-split-pane": { type: "pane", value: Direction.PREVIOUS },
  "next-tab-block": { type: "block", value: Direction.NEXT },
  "previous-tab-block": { type: "block", value: Direction.PREVIOUS },
});

let navigationQueue = Promise.resolve();
let focusStateQueue = Promise.resolve();
const viewerSessions = new Map();

async function getFocusState() {
  await focusStateQueue;
  const stored = await chrome.storage.session.get(FOCUS_STATE_KEY);
  return stored[FOCUS_STATE_KEY] ?? {};
}

function mutateFocusState(mutate) {
  focusStateQueue = focusStateQueue
    .catch(() => undefined)
    .then(async () => {
      const stored = await chrome.storage.session.get(FOCUS_STATE_KEY);
      const state = stored[FOCUS_STATE_KEY] ?? {};
      mutate(state);
      await chrome.storage.session.set({ [FOCUS_STATE_KEY]: state });
    });
  return focusStateQueue;
}

async function rememberFocusedSplitTab(tab) {
  if (!isSplitTab(tab, SPLIT_VIEW_ID_NONE)) return;

  await mutateFocusState((state) => {
    setRememberedTabId(state, tab.windowId, tab.splitViewId, tab.id);
  });
}

async function cleanUpTabs(preferredTabId) {
  const [tabs, settings] = await Promise.all([
    chrome.tabs.query({}),
    chrome.storage.sync.get({
      closeDuplicateTabsOnActivation: false,
      closeNewTabsOnActivation: false,
    }),
  ]);
  const tabIds = new Set(
    settings.closeNewTabsOnActivation ? unfocusedNewTabIds(tabs) : [],
  );
  if (settings.closeDuplicateTabsOnActivation) {
    for (const tabId of duplicateTabIds(tabs, preferredTabId)) tabIds.add(tabId);
  }
  if (tabIds.size) await chrome.tabs.remove([...tabIds]);
}

async function getActiveWindowTabs() {
  const browserWindow = await chrome.windows.getLastFocused();
  if (!browserWindow || browserWindow.id === chrome.windows.WINDOW_ID_NONE) {
    return null;
  }

  const tabs = await chrome.tabs.query({ windowId: browserWindow.id });
  const activeTab = tabs.find((tab) => tab.active);
  return activeTab ? { activeTab, tabs } : null;
}

async function activateTab(tab, activeTabId) {
  if (!tab || tab.id === undefined) return;
  if (tab.id !== activeTabId) await chrome.tabs.update(tab.id, { active: true });
  await rememberFocusedSplitTab(tab);
}

function tabSubtitle(tab) {
  const value = tab.url || tab.pendingUrl || "";
  try {
    const url = new URL(value);
    return url.hostname || url.protocol.replace(":", "");
  } catch {
    return value;
  }
}

function tabForViewer(tab) {
  return {
    id: tab.id,
    title: tab.title || "Untitled tab",
    subtitle: tabSubtitle(tab),
    favIconUrl: tab.favIconUrl || "",
  };
}

function viewerItems(blocks, focusState) {
  return blocks.map((block) => ({
    key: block.key,
    type: block.type,
    targetTabId: selectBlockMember(block, focusState)?.id,
    members: block.members.map(tabForViewer),
  }));
}

async function hideViewer(session) {
  try {
    await chrome.tabs.sendMessage(session.originTabId, {
      type: "helium-tab-viewer:hide",
      sessionId: session.id,
    });
  } catch {
    // The origin tab may be closed, navigating, or protected.
  }
}

async function cancelViewerSession(windowId, sessionId) {
  const session = viewerSessions.get(windowId);
  if (!session || (sessionId && session.id !== sessionId)) return;
  viewerSessions.delete(windowId);
  await hideViewer(session);
}

async function commitViewerSession(windowId, sessionId) {
  const session = viewerSessions.get(windowId);
  if (!session || session.id !== sessionId) return;
  viewerSessions.delete(windowId);
  await hideViewer(session);

  const tabs = await chrome.tabs.query({ windowId });
  const blocks = sortTabBlocksByRecentUse(
    buildTabBlocks(tabs, SPLIT_VIEW_ID_NONE),
  );
  const selectedBlock = blocks.find((block) => block.key === session.selectedBlockKey);
  if (!selectedBlock) return;

  const focusState = await getFocusState();
  const target = selectBlockMember(selectedBlock, focusState);
  const activeTab = tabs.find((tab) => tab.active);
  await activateTab(target, activeTab?.id);
}

async function closeViewerSelection(windowId, sessionId) {
  const session = viewerSessions.get(windowId);
  if (!session || session.id !== sessionId) return;

  const tabs = await chrome.tabs.query({ windowId });
  const blocks = sortTabBlocksByRecentUse(
    buildTabBlocks(tabs, SPLIT_VIEW_ID_NONE),
  );
  const selectedIndex = blocks.findIndex(
    (block) => block.key === session.selectedBlockKey,
  );
  const selectedBlock = blocks[selectedIndex];
  if (!selectedBlock) return;

  const focusState = await getFocusState();
  const target = selectBlockMember(selectedBlock, focusState);
  if (!target?.id) return;

  const closesOrigin = target.id === session.originTabId;
  await chrome.tabs.remove(target.id);
  if (closesOrigin || !viewerSessions.has(windowId)) return;

  const remainingTabs = await chrome.tabs.query({ windowId });
  const remainingBlocks = sortTabBlocksByRecentUse(
    buildTabBlocks(remainingTabs, SPLIT_VIEW_ID_NONE),
  );
  if (!remainingBlocks.length) {
    await cancelViewerSession(windowId, sessionId);
    return;
  }

  const nextIndex = Math.min(selectedIndex, remainingBlocks.length - 1);
  session.selectedBlockKey = remainingBlocks[nextIndex].key;
  await showViewer(session, remainingBlocks, await getFocusState());
}

async function showViewer(session, blocks, focusState) {
  try {
    if (!session.accentColor) {
      const settings = await chrome.storage.sync.get({
        commandBarColor: DEFAULT_COMMAND_BAR_COLOR,
      });
      session.accentColor = normalizeThemeColor(settings.commandBarColor);
    }
    if (!session.injected) {
      await chrome.scripting.executeScript({
        target: { tabId: session.originTabId },
        files: ["tab-viewer.js"],
      });
      session.injected = true;
    }
    await chrome.tabs.sendMessage(session.originTabId, {
      type: "helium-tab-viewer:show",
      sessionId: session.id,
      accentColor: session.accentColor,
      items: viewerItems(blocks, focusState),
      selectedIndex: blocks.findIndex(
        (block) => block.key === session.selectedBlockKey,
      ),
    });
    return true;
  } catch {
    return false;
  }
}

async function runBlockViewer(direction, context, focusState) {
  const { activeTab, tabs } = context;
  const blocks = sortTabBlocksByRecentUse(
    buildTabBlocks(tabs, SPLIT_VIEW_ID_NONE),
  );
  if (!blocks.length) return;

  let session = viewerSessions.get(activeTab.windowId);
  if (session && session.originTabId !== activeTab.id) {
    await cancelViewerSession(activeTab.windowId, session.id);
    session = null;
  }

  const selectedIndex = getAdjacentBlockIndex(
    blocks,
    activeTab.id,
    session?.selectedBlockKey,
    direction,
  );
  if (selectedIndex === -1) return;
  if (!session) {
    session = {
      id: crypto.randomUUID(),
      windowId: activeTab.windowId,
      originTabId: activeTab.id,
      selectedBlockKey: blocks[selectedIndex].key,
      injected: false,
    };
    viewerSessions.set(activeTab.windowId, session);
  } else {
    session.selectedBlockKey = blocks[selectedIndex].key;
  }

  if (!await showViewer(session, blocks, focusState)) {
    viewerSessions.delete(activeTab.windowId);
    const target = selectBlockMember(blocks[selectedIndex], focusState);
    await activateTab(target, activeTab.id);
  }
}

async function runCommand(commandName) {
  const command = COMMANDS[commandName];
  if (!command) return;

  let context = await getActiveWindowTabs();
  if (!context) return;

  try {
    await checkForExtensionUpdate();
    await cleanUpTabs(context.activeTab.id);
  } catch (error) {
    // Cleanup should never prevent the requested navigation.
    console.info("Could not clean up tabs", error);
  }

  // Cleanup can remove tabs from the active window, so refresh navigation data.
  context = await getActiveWindowTabs();
  if (!context) return;

  const { activeTab, tabs } = context;
  let target = null;

  if (command.type === "block") {
    const focusState = await getFocusState();
    await runBlockViewer(command.value, context, focusState);
    return;
  }

  target = getSplitPaneCycleTarget(
    tabs,
    activeTab.id,
    command.value,
    SPLIT_VIEW_ID_NONE,
  );
  await activateTab(target, activeTab.id);
}

chrome.commands.onCommand.addListener((commandName) => {
  if (!COMMANDS[commandName]) return;
  navigationQueue = navigationQueue
    .catch(() => undefined)
    .then(() => runCommand(commandName))
    .catch((error) => {
      console.error(`Split navigation command failed: ${commandName}`, error);
    });
});

chrome.runtime.onMessage.addListener((message, sender) => {
  const session = sender.tab?.windowId === undefined
    ? null
    : viewerSessions.get(sender.tab.windowId);
  if (
    !session ||
    sender.tab.id !== session.originTabId ||
    message?.sessionId !== session.id
  ) {
    return;
  }

  if (
    message.type === "helium-tab-viewer:hover" ||
    message.type === "helium-tab-viewer:select"
  ) {
    session.selectedBlockKey = message.blockKey;
  }
  if (
    message.type === "helium-tab-viewer:commit" ||
    message.type === "helium-tab-viewer:select"
  ) {
    navigationQueue = navigationQueue
      .catch(() => undefined)
      .then(() => commitViewerSession(session.windowId, session.id))
      .catch((error) => console.error("Tab viewer commit failed", error));
  } else if (message.type === "helium-tab-viewer:close-selected") {
    if (message.blockKey) session.selectedBlockKey = message.blockKey;
    navigationQueue = navigationQueue
      .catch(() => undefined)
      .then(() => closeViewerSelection(session.windowId, session.id))
      .catch((error) => console.error("Closing viewer selection failed", error));
  } else if (message.type === "helium-tab-viewer:cancel") {
    navigationQueue = navigationQueue
      .catch(() => undefined)
      .then(() => cancelViewerSession(session.windowId, session.id))
      .catch((error) => console.error("Tab viewer cancel failed", error));
  }
});

chrome.tabs.onActivated.addListener(({ tabId, windowId }) => {
  const session = viewerSessions.get(windowId);
  if (session && session.originTabId !== tabId) {
    void cancelViewerSession(windowId, session.id);
  }
  chrome.tabs.get(tabId).then(rememberFocusedSplitTab).catch(() => {
    // The tab can disappear before the asynchronous lookup finishes.
  });
});

chrome.tabs.onRemoved.addListener((tabId, { windowId }) => {
  const session = viewerSessions.get(windowId);
  if (session?.originTabId === tabId) {
    void cancelViewerSession(windowId, session.id);
  }
  void mutateFocusState((state) => {
    for (const [key, rememberedTabId] of Object.entries(state)) {
      if (rememberedTabId === tabId) delete state[key];
    }
  });
});

chrome.windows.onRemoved.addListener((windowId) => {
  const session = viewerSessions.get(windowId);
  if (session) void cancelViewerSession(windowId, session.id);
});

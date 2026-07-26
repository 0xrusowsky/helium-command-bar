import {
  Direction,
  getBlockNavigationTarget,
  getIndexedBlockTarget,
  getSplitPaneCycleTarget,
  isSplitTab,
  setRememberedTabId,
} from "./navigation.js";

const FOCUS_STATE_KEY = "lastFocusedBySplit";
const SPLIT_VIEW_ID_NONE = chrome.tabs.SPLIT_VIEW_ID_NONE ?? -1;

const COMMANDS = {
  "cycle-split-pane": { type: "pane", value: Direction.NEXT },
  "next-tab-block": { type: "block", value: Direction.NEXT },
  "previous-tab-block": { type: "block", value: Direction.PREVIOUS },
};
for (let blockNumber = 1; blockNumber <= 9; blockNumber += 1) {
  COMMANDS[`select-tab-block-${blockNumber}`] = {
    type: "indexed-block",
    value: blockNumber,
  };
}
Object.freeze(COMMANDS);

let navigationQueue = Promise.resolve();
let focusStateQueue = Promise.resolve();

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

async function runCommand(commandName) {
  const command = COMMANDS[commandName];
  if (!command) return;

  const context = await getActiveWindowTabs();
  if (!context) return;

  const { activeTab, tabs } = context;
  let target = null;

  if (command.type === "pane") {
    target = getSplitPaneCycleTarget(
      tabs,
      activeTab.id,
      command.value,
      SPLIT_VIEW_ID_NONE,
    );
  } else {
    const focusState = await getFocusState();
    target = command.type === "block"
      ? getBlockNavigationTarget(
          tabs,
          activeTab.id,
          command.value,
          focusState,
          SPLIT_VIEW_ID_NONE,
        )
      : getIndexedBlockTarget(
          tabs,
          activeTab.id,
          command.value,
          focusState,
          SPLIT_VIEW_ID_NONE,
        );
  }

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

chrome.tabs.onActivated.addListener(({ tabId }) => {
  chrome.tabs.get(tabId).then(rememberFocusedSplitTab).catch(() => {
    // The tab can disappear before the asynchronous lookup finishes.
  });
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void mutateFocusState((state) => {
    for (const [key, rememberedTabId] of Object.entries(state)) {
      if (rememberedTabId === tabId) delete state[key];
    }
  });
});

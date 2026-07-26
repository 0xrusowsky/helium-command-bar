import {
  filterRecentlyClosed,
  filterSettings,
  filterTabBlocks,
  filterTabs,
  getSettingById,
  isSplitTab,
  resolveInput,
  sessionToItem
} from "./search.js";

const NATIVE_SPLIT_PICKER_URL = "chrome://tab-search.top-chrome/split_new_tab_page.html";
const interceptingSplitTabs = new Set();

let commandBarCssPromise;

function getCommandBarCss() {
  if (!commandBarCssPromise) {
    commandBarCssPromise = fetch(chrome.runtime.getURL("popup.css"))
      .then((response) => response.text())
      .then((css) => `${css.replaceAll(":root", ":host")}
        :host {
          color-scheme: light dark;
        }
        .command-bar {
          width: min(620px, calc(100vw - 32px));
          max-height: min(580px, calc(100vh - 40px));
          overflow: hidden;
          border-radius: 15px;
          color: var(--text);
          font: 13px/1.35 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          box-shadow: 0 24px 80px rgba(0, 0, 0, 0.35);
        }
      `);
  }
  return commandBarCssPromise;
}

function tabForOverlay(tab) {
  return {
    id: tab.id,
    windowId: tab.windowId,
    title: tab.title || "",
    url: tab.url || "",
    pendingUrl: tab.pendingUrl || "",
    favIconUrl: tab.favIconUrl || "",
    active: Boolean(tab.active),
    lastAccessed: tab.lastAccessed || 0,
    index: tab.index ?? 0,
    splitViewId: tab.splitViewId
  };
}

async function queryRows(query) {
  const input = typeof query === "string" ? query.slice(0, 4096) : "";
  const [tabs, sessions, css, settings] = await Promise.all([
    chrome.tabs.query({}),
    chrome.sessions.getRecentlyClosed({ maxResults: 25 }),
    getCommandBarCss(),
    chrome.storage.sync.get({ defaultSplitMode: "compact" })
  ]);
  const matchedBlocks = filterTabBlocks(tabs, input, chrome.tabs.SPLIT_VIEW_ID_NONE ?? -1);
  const matchedClosed = filterRecentlyClosed(sessions, input);
  const matchedSettings = filterSettings(input);
  const target = resolveInput(input);
  const openRows = matchedBlocks.flatMap((block) => block.type === "split"
    ? block.members.map((tab) => ({
        kind: "split-member",
        tab: tabForOverlay(tab),
        splitKey: block.key,
        splitViewId: block.splitViewId,
        splitSize: block.members.length
      }))
    : [{ kind: "tab", tab: tabForOverlay(block.members[0]) }]);
  const rows = [
    ...(target ? [{ kind: "launch", target }] : []),
    ...matchedSettings.map((setting) => ({ kind: "setting", setting })),
    ...openRows,
    ...matchedClosed.map((closed) => ({ kind: "closed", closed }))
  ];

  let label;
  if (!input.trim() || rows.length > 1) {
    label = `${openRows.length} open · ${matchedClosed.length} recently closed`;
  } else {
    label = "No matching tabs";
  }

  return {
    css,
    rows,
    label,
    defaultSplitExpanded: settings.defaultSplitMode === "expanded"
  };
}

async function querySplitPickerRows(query, pickerTabId) {
  const input = typeof query === "string" ? query.slice(0, 4096) : "";
  const [tabs, sessions] = await Promise.all([
    chrome.tabs.query({}),
    chrome.sessions.getRecentlyClosed({ maxResults: 25 })
  ]);
  const eligibleTabs = tabs.filter((tab) =>
    tab.id !== pickerTabId &&
    !isSplitTab(tab, chrome.tabs.SPLIT_VIEW_ID_NONE ?? -1) &&
    tab.url !== chrome.runtime.getURL("split-picker.html")
  );
  const matchedTabs = filterTabs(eligibleTabs, input);
  const matchedClosed = filterRecentlyClosed(sessions, input);
  const target = resolveInput(input);

  return {
    rows: [
      ...(target ? [{ kind: "launch", target }] : []),
      ...matchedTabs.map((tab) => ({ kind: "tab", tab: tabForOverlay(tab) })),
      ...matchedClosed.map((closed) => ({ kind: "closed", closed }))
    ],
    label: `${matchedTabs.length} open · ${matchedClosed.length} recently closed`
  };
}

async function handleOverlayMessage(message, sender) {
  if (sender.id !== chrome.runtime.id || sender.tab?.id === undefined) return undefined;

  switch (message?.type) {
    case "helium-command-bar:query":
      return queryRows(message.query);

    case "split-picker:query":
      return querySplitPickerRows(message.query, sender.tab.id);

    case "helium-command-bar:activate-tab": {
      const tabId = Number(message.tabId);
      const windowId = Number(message.windowId);
      if (!Number.isInteger(tabId) || !Number.isInteger(windowId)) throw new Error("Invalid tab");
      await chrome.windows.update(windowId, { focused: true });
      await chrome.tabs.update(tabId, { active: true });
      return { ok: true };
    }

    case "helium-command-bar:restore-session":
      if (typeof message.sessionId !== "string" || !message.sessionId) throw new Error("Invalid session");
      await chrome.sessions.restore(message.sessionId);
      return { ok: true };

    case "helium-command-bar:close-tab": {
      const tabId = Number(message.tabId);
      if (!Number.isInteger(tabId)) throw new Error("Invalid tab");
      await chrome.tabs.remove(tabId);
      return { ok: true };
    }

    case "helium-command-bar:open-setting": {
      const setting = getSettingById(message.settingId);
      if (!setting) throw new Error("Unknown settings destination");
      await chrome.tabs.create({ url: setting.url, active: true, windowId: sender.tab.windowId });
      return { ok: true };
    }

    case "helium-command-bar:open-input": {
      const target = resolveInput(typeof message.input === "string" ? message.input.slice(0, 4096) : "");
      if (!target) return { ok: false };

      if (target.kind === "url") {
        await chrome.tabs.create({ url: target.url, active: true, windowId: sender.tab.windowId });
      } else if (chrome.search?.query) {
        chrome.search.query({ text: target.text, disposition: "NEW_TAB" });
      } else {
        await chrome.tabs.create({
          url: `https://www.google.com/search?q=${encodeURIComponent(target.text)}`,
          active: true,
          windowId: sender.tab.windowId
        });
      }
      return { ok: true };
    }

    case "split-picker:open-input": {
      const target = resolveInput(typeof message.input === "string" ? message.input.slice(0, 4096) : "");
      if (!target) return { ok: false };

      if (target.kind === "url") {
        await chrome.tabs.update(sender.tab.id, { url: target.url });
      } else if (chrome.search?.query) {
        await chrome.tabs.update(sender.tab.id, { active: true });
        chrome.search.query({ text: target.text, disposition: "CURRENT_TAB" });
      } else {
        await chrome.tabs.update(sender.tab.id, {
          url: `https://www.google.com/search?q=${encodeURIComponent(target.text)}`
        });
      }
      return { ok: true };
    }

    case "split-picker:open-tab": {
      const tabId = Number(message.tabId);
      if (!Number.isInteger(tabId)) throw new Error("Invalid tab");
      const sourceTab = await chrome.tabs.get(tabId);
      const url = sourceTab.url || sourceTab.pendingUrl;
      if (!url) return { ok: false };
      await chrome.tabs.update(sender.tab.id, { url });
      return { ok: true };
    }

    case "split-picker:open-closed": {
      if (typeof message.sessionId !== "string" || !message.sessionId) throw new Error("Invalid session");
      const sessions = await chrome.sessions.getRecentlyClosed({ maxResults: 25 });
      const item = sessions.map(sessionToItem).find((candidate) => candidate?.sessionId === message.sessionId);
      if (!item?.url) return { ok: false };
      await chrome.tabs.update(sender.tab.id, { url: item.url });
      return { ok: true };
    }

    case "split-picker:close":
      await chrome.tabs.remove(sender.tab.id);
      return { ok: true };

    default:
      return undefined;
  }
}

function isNativeSplitPicker(tab) {
  return (
    tab?.url?.startsWith(NATIVE_SPLIT_PICKER_URL) &&
    isSplitTab(tab, chrome.tabs.SPLIT_VIEW_ID_NONE ?? -1)
  );
}

async function enhanceNativeSplitPicker(tab) {
  if (!isNativeSplitPicker(tab) || interceptingSplitTabs.has(tab.id)) {
    return;
  }

  interceptingSplitTabs.add(tab.id);
  try {
    await chrome.tabs.update(tab.id, {
      url: chrome.runtime.getURL("split-picker.html")
    });
  } catch (error) {
    console.error("Could not open the enhanced split picker", error);
  } finally {
    interceptingSplitTabs.delete(tab.id);
  }
}

async function scanForNativeSplitPickers() {
  const tabs = await chrome.tabs.query({});
  await Promise.all(tabs.map(enhanceNativeSplitPicker));
}

async function openAnchoredFallback(tab) {
  if (!tab?.id) return;

  await chrome.action.setPopup({ tabId: tab.id, popup: "popup.html" });
  try {
    await chrome.action.openPopup({ windowId: tab.windowId });
    // Changing the future action behavior does not close the popup that is
    // already open. The next invocation can therefore try the overlay again.
    await chrome.action.setPopup({ tabId: tab.id, popup: "" });
  } catch (error) {
    // Older Chromium builds may not support openPopup(). Leave the normal
    // popup assigned so the user can open it by clicking the toolbar action.
    console.info("Click the toolbar action to open the command bar on this protected page", error);
  }
}

async function openCommandBar(tab) {
  if (!tab?.id) return;

  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["overlay.js"]
    });
  } catch (error) {
    // Chromium blocks content scripts on internal pages, the Web Store, and
    // other protected surfaces. Fall back to the original anchored popup.
    console.info("Using the anchored popup on this protected page", error);
    await openAnchoredFallback(tab);
  }
}

chrome.runtime.onMessage.addListener((message, sender) => handleOverlayMessage(message, sender));

chrome.action.onClicked.addListener(openCommandBar);
chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "open-command-bar") return;
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  await openCommandBar(tab);
});

chrome.tabs.onCreated.addListener((tab) => void enhanceNativeSplitPicker(tab));
chrome.tabs.onUpdated.addListener((_tabId, _changeInfo, tab) => {
  if (tab.url?.startsWith(NATIVE_SPLIT_PICKER_URL)) void enhanceNativeSplitPicker(tab);
});
chrome.tabs.onRemoved.addListener((tabId) => {
  interceptingSplitTabs.delete(tabId);
});
chrome.runtime.onInstalled.addListener(() => void scanForNativeSplitPickers());
chrome.runtime.onStartup.addListener(() => void scanForNativeSplitPickers());

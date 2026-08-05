import "./split-navigation.js";

import { createExtensionIconImageData } from "./icon.js";
import {
  DEFAULT_RESULT_SECTION_ORDER,
  attachBookmarkMetadata,
  bookmarkUrlKey,
  bookmarksInFolders,
  displayTabTitle,
  duplicateTabIds,
  filterBookmarks,
  filterRecentlyClosed,
  filterSettings,
  filterTabActions,
  filterTabBlocks,
  filterTabs,
  flattenBookmarks,
  getSettingById,
  getSettingForTab,
  isSplitTab,
  normalizeResultSectionOrder,
  resolveInput,
  sessionToItem
} from "./search.js";
import {
  DEFAULT_COMMAND_BAR_COLOR,
  commandBarThemeCss
} from "./theme.js";
import { unfocusedNewTabIds } from "./navigation.js";
import { checkForExtensionUpdate, getExtensionUpdateState } from "./update.js";

const NATIVE_SPLIT_PICKER_URL = "chrome://tab-search.top-chrome/split_new_tab_page.html";
const VISUAL_PERMISSION = { origins: ["<all_urls>"] };
const interceptingSplitTabs = new Set();
const blurredPartnersByOwner = new Map();
const inactiveEffectByTab = new Map();
let lastFocusedWindowId;
let previousFocusedWindowId;

let commandBarCssPromise;
let bookmarkCachePromise;

async function refreshActionIcon(value) {
  try {
    const color = value || (await chrome.storage.sync.get({
      commandBarColor: DEFAULT_COMMAND_BAR_COLOR
    })).commandBarColor;
    const imageData = Object.fromEntries(
      [16, 32, 48, 128].map((size) => [
        size,
        createExtensionIconImageData(color, size)
      ])
    );
    await chrome.action.setIcon({ imageData });
  } catch (error) {
    console.info("Could not update the command bar icon", error);
  }
}

void refreshActionIcon();

function getBookmarks() {
  if (!chrome.bookmarks) return Promise.resolve([]);
  if (!bookmarkCachePromise) {
    bookmarkCachePromise = chrome.bookmarks.getTree().then(flattenBookmarks);
  }
  return bookmarkCachePromise;
}

function invalidateBookmarks() {
  bookmarkCachePromise = null;
}

function removeInactiveEffect(extensionId) {
  document.getElementById(`helium-command-bar-inactive-blur-${extensionId}`)?.remove();
}

async function setInactiveEffect(tabId, mode) {
  if (inactiveEffectByTab.get(tabId) === mode) return true;

  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["inactive-blur.js"]
    });
    await chrome.tabs.sendMessage(tabId, {
      type: "helium-command-bar:set-inactive-effect",
      mode
    });
    inactiveEffectByTab.set(tabId, mode);
    return true;
  } catch {
    // Protected pages and pages without granted host access remain unchanged.
    inactiveEffectByTab.delete(tabId);
    return false;
  }
}

async function removeInactiveEffectFromTab(tabId) {
  inactiveEffectByTab.delete(tabId);
  try {
    await chrome.tabs.sendMessage(tabId, {
      type: "helium-command-bar:set-inactive-effect",
      mode: "remove"
    });
  } catch {
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        func: removeInactiveEffect,
        args: [chrome.runtime.id]
      });
    } catch {
      // The tab may be closed, protected, or navigating.
    }
  }
}

async function removeUntrackedInactiveEffect(tabId) {
  try {
    await chrome.tabs.sendMessage(tabId, {
      type: "helium-command-bar:set-inactive-effect",
      mode: "remove"
    });
  } catch {
    // No injected layer is present in this tab.
  }
}

function getSplitPartners(tabs, ownerTab) {
  if (!isSplitTab(ownerTab, chrome.tabs.SPLIT_VIEW_ID_NONE ?? -1)) return [];
  return tabs.filter((tab) =>
    tab.id !== ownerTab.id &&
    tab.windowId === ownerTab.windowId &&
    tab.splitViewId === ownerTab.splitViewId
  );
}

async function visualEffectEnabled() {
  const [settings, allowed] = await Promise.all([
    chrome.storage.sync.get({ blurInactiveSplitPane: false }),
    chrome.permissions.contains(VISUAL_PERMISSION)
  ]);
  return Boolean(settings.blurInactiveSplitPane && allowed);
}

async function syncInactiveSplitEffects(providedTabs) {
  if (!await visualEffectEnabled()) {
    blurredPartnersByOwner.clear();
    await Promise.allSettled([...inactiveEffectByTab.keys()].map(removeInactiveEffectFromTab));
    return;
  }

  const tabs = providedTabs || await chrome.tabs.query({});
  const tabsById = new Map(tabs.map((tab) => [tab.id, tab]));
  const desired = new Map();

  for (const activeTab of tabs.filter((tab) => tab.active)) {
    if (getSplitPartners(tabs, activeTab).length) desired.set(activeTab.id, "focus");
  }

  for (const [ownerTabId, partnerIds] of blurredPartnersByOwner) {
    const owner = tabsById.get(ownerTabId);
    if (!owner?.active) {
      blurredPartnersByOwner.delete(ownerTabId);
      continue;
    }
    for (const partnerId of partnerIds) {
      if (tabsById.has(partnerId)) desired.set(partnerId, "blur");
    }
  }

  const knownCleanupIds = [...inactiveEffectByTab.keys()].filter((tabId) => !desired.has(tabId));
  const activeUnknownCleanupIds = tabs
    .filter((tab) => tab.active && !desired.has(tab.id) && !inactiveEffectByTab.has(tab.id))
    .map((tab) => tab.id);
  await Promise.allSettled([
    ...[...desired].map(([tabId, mode]) => setInactiveEffect(tabId, mode)),
    ...knownCleanupIds.map(removeInactiveEffectFromTab),
    ...activeUnknownCleanupIds.map(removeUntrackedInactiveEffect)
  ]);
}

async function clearInactiveSplitBlur(ownerTabId, additionalPartnerIds = []) {
  blurredPartnersByOwner.delete(ownerTabId);
  for (const tabId of additionalPartnerIds.filter(Number.isInteger)) {
    if (!inactiveEffectByTab.has(tabId)) inactiveEffectByTab.set(tabId, "blur");
  }
  await syncInactiveSplitEffects();
}

function forgetBlurredTab(tabId) {
  inactiveEffectByTab.delete(tabId);
  blurredPartnersByOwner.delete(tabId);
  for (const [ownerTabId, partnerIds] of blurredPartnersByOwner) {
    partnerIds.delete(tabId);
    if (!partnerIds.size) blurredPartnersByOwner.delete(ownerTabId);
  }
}

async function ensureInactiveSplitBlur(tabs, ownerTab) {
  if (!await visualEffectEnabled()) return [];
  const partners = getSplitPartners(tabs, ownerTab);
  if (!partners.length) return [];

  const partnerIds = new Set(partners.map((tab) => tab.id));
  blurredPartnersByOwner.set(ownerTab.id, partnerIds);
  await syncInactiveSplitEffects(tabs);
  return [...partnerIds].filter((tabId) => inactiveEffectByTab.get(tabId) === "blur");
}

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

function faviconUrlForPage(pageUrl) {
  const url = new URL(chrome.runtime.getURL("/_favicon/"));
  url.searchParams.set("pageUrl", pageUrl);
  url.searchParams.set("size", "32");
  return url.href;
}

function bookmarkForOverlay(bookmark) {
  return {
    ...bookmark,
    favIconUrl: faviconUrlForPage(bookmark.url)
  };
}

function tabForOverlay(tab) {
  return {
    id: tab.id,
    windowId: tab.windowId,
    title: displayTabTitle(tab),
    url: tab.url || "",
    pendingUrl: tab.pendingUrl || "",
    favIconUrl: tab.favIconUrl || "",
    active: Boolean(tab.active),
    pinned: Boolean(tab.pinned),
    bookmarkId: tab.bookmarkId || null,
    lastAccessed: tab.lastAccessed || 0,
    index: tab.index ?? 0,
    splitViewId: tab.splitViewId
  };
}

async function queryRows(query, requesterTab) {
  const input = typeof query === "string" ? query.slice(0, 4096) : "";
  const [tabs, sessions, bookmarks, css, settings, updateState] = await Promise.all([
    chrome.tabs.query({}),
    chrome.sessions.getRecentlyClosed({ maxResults: 25 }),
    getBookmarks(),
    getCommandBarCss(),
    chrome.storage.sync.get({
      defaultSplitMode: "compact",
      blurInactiveSplitPane: false,
      commandBarColor: DEFAULT_COMMAND_BAR_COLOR,
      showFavorites: true,
      showRecentlyClosed: true,
      favoriteFolderIds: null,
      resultSectionOrder: DEFAULT_RESULT_SECTION_ORDER
    }),
    getExtensionUpdateState()
  ]);
  const configuredBookmarks = bookmarksInFolders(bookmarks, settings.favoriteFolderIds);
  const enabledBookmarks = settings.showFavorites === false ? [] : configuredBookmarks;
  const regularTabs = attachBookmarkMetadata(
    tabs.filter((tab) => tab.id !== requesterTab.id && !getSettingForTab(tab)),
    enabledBookmarks
  );
  const matchedBlocks = filterTabBlocks(regularTabs, input, chrome.tabs.SPLIT_VIEW_ID_NONE ?? -1);
  const matchedClosed = settings.showRecentlyClosed === false
    ? []
    : filterRecentlyClosed(sessions, input);
  const matchedBookmarks = settings.showFavorites === false
    ? []
    : filterBookmarks(bookmarks, input, tabs, settings.favoriteFolderIds);
  const matchedSettings = filterSettings(input);
  const currentActionTab = attachBookmarkMetadata([requesterTab], configuredBookmarks)[0];
  const matchedTabActions = filterTabActions(input, currentActionTab);
  const target = resolveInput(input);
  const openSettingTabs = new Map();
  for (const tab of [...tabs].sort((left, right) =>
    Number(Boolean(right.active)) - Number(Boolean(left.active)) ||
    (right.lastAccessed || 0) - (left.lastAccessed || 0)
  )) {
    const setting = getSettingForTab(tab);
    if (setting && !openSettingTabs.has(setting.id)) openSettingTabs.set(setting.id, tab);
  }
  const openRows = matchedBlocks.flatMap((block) => block.type === "split"
    ? block.members.map((tab) => ({
        kind: "split-member",
        tab: tabForOverlay(tab),
        splitKey: block.key,
        splitViewId: block.splitViewId,
        splitSize: block.members.length
      }))
    : [{ kind: "tab", tab: tabForOverlay(block.members[0]) }]);
  const searchRows = [
    ...(updateState?.updateAvailable ? [{
      kind: "update",
      setting: {
        title: "Update extension",
        description: `Reload version ${updateState.availableVersion}`,
        icon: "settings"
      }
    }] : []),
    ...(target ? [{ kind: "launch", target }] : []),
    ...matchedSettings.flatMap((setting) => {
      const parent = {
        kind: "setting",
        setting,
        expandable: setting.id === "extensions",
        tab: openSettingTabs.has(setting.id)
          ? tabForOverlay(openSettingTabs.get(setting.id))
          : null
      };
      if (setting.id !== "extensions") return [parent];
      const extensionSettings = getSettingById("extension-settings");
      return [parent, {
        kind: "extension-setting",
        parentSettingId: "extensions",
        setting: extensionSettings,
        tab: openSettingTabs.has(extensionSettings.id)
          ? tabForOverlay(openSettingTabs.get(extensionSettings.id))
          : null
      }, {
        kind: "extension-update",
        parentSettingId: "extensions",
        setting: {
          title: "Update extension",
          description: "Reload the Helium Command Bar extension",
          icon: "settings"
        }
      }];
    }),
    ...matchedTabActions.map((action) => ({
      kind: "tab-action",
      action,
      tabId: requesterTab.id
    }))
  ];
  const sectionOrder = normalizeResultSectionOrder(settings.resultSectionOrder);
  const sectionRows = {
    open: openRows,
    favorites: matchedBookmarks.map((bookmark) => ({
      kind: "bookmark",
      bookmark: bookmarkForOverlay(bookmark)
    })),
    closed: matchedClosed.map((closed) => ({ kind: "closed", closed }))
  };
  const rows = [
    ...searchRows,
    ...sectionOrder.flatMap((key) => sectionRows[key])
  ];

  let label;
  if (!input.trim() || rows.length > 1) {
    label = `${openRows.length} open · ${matchedBookmarks.length} bookmarks · ${matchedClosed.length} recently closed`;
  } else {
    label = "No matching tabs";
  }

  let blurredPartnerIds = [];
  if (
    settings.blurInactiveSplitPane &&
    isSplitTab(requesterTab, chrome.tabs.SPLIT_VIEW_ID_NONE ?? -1)
  ) {
    blurredPartnerIds = await ensureInactiveSplitBlur(tabs, requesterTab);
  } else {
    await clearInactiveSplitBlur(requesterTab.id);
  }

  return {
    css: `${css}\n${commandBarThemeCss(settings.commandBarColor, ":host")}`,
    rows,
    label,
    sectionOrder,
    defaultSplitExpanded: settings.defaultSplitMode === "expanded",
    blurredPartnerIds
  };
}

async function querySplitPickerRows(query, pickerTabId) {
  const input = typeof query === "string" ? query.slice(0, 4096) : "";
  const [tabs, sessions, bookmarks, settings] = await Promise.all([
    chrome.tabs.query({}),
    chrome.sessions.getRecentlyClosed({ maxResults: 25 }),
    getBookmarks(),
    chrome.storage.sync.get({
      showFavorites: true,
      showRecentlyClosed: true,
      favoriteFolderIds: null
    })
  ]);
  const enabledBookmarks = settings.showFavorites === false
    ? []
    : bookmarksInFolders(bookmarks, settings.favoriteFolderIds);
  const eligibleTabs = attachBookmarkMetadata(tabs.filter((tab) =>
    tab.id !== pickerTabId &&
    !isSplitTab(tab, chrome.tabs.SPLIT_VIEW_ID_NONE ?? -1) &&
    tab.url !== chrome.runtime.getURL("split-picker.html")
  ), enabledBookmarks);
  const matchedTabs = filterTabs(eligibleTabs, input);
  const matchedClosed = settings.showRecentlyClosed === false
    ? []
    : filterRecentlyClosed(sessions, input);
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
  if (sender.id !== chrome.runtime.id) return undefined;

  if (message?.type === "helium-command-bar:set-pinned") {
    const tabId = Number(message.tabId);
    if (!Number.isInteger(tabId)) throw new Error("Invalid tab");
    if (sender.tab?.id !== undefined && sender.tab.id !== tabId) {
      throw new Error("Cannot pin a different tab");
    }
    await chrome.tabs.update(tabId, { pinned: Boolean(message.pinned) });
    return { ok: true };
  }

  if (message?.type === "helium-command-bar:set-favorite") {
    if (!chrome.bookmarks) return { ok: false };
    const tabId = Number(message.tabId);
    if (!Number.isInteger(tabId)) throw new Error("Invalid tab");
    if (sender.tab?.id !== undefined && sender.tab.id !== tabId) {
      throw new Error("Cannot favorite a different tab");
    }

    const tab = await chrome.tabs.get(tabId);
    const pageUrl = tab.url || tab.pendingUrl;
    if (!pageUrl) return { ok: false };
    const pageKey = bookmarkUrlKey(pageUrl);
    const matches = (await getBookmarks()).filter((bookmark) =>
      bookmarkUrlKey(bookmark.url) === pageKey
    );
    const settings = await chrome.storage.sync.get({ favoriteFolderIds: null });
    const favoriteMatches = bookmarksInFolders(matches, settings.favoriteFolderIds);

    if (message.favorite) {
      if (!favoriteMatches.length) {
        const createDetails = {
          title: displayTabTitle(tab) || tab.title || pageUrl,
          url: pageUrl
        };
        if (Array.isArray(settings.favoriteFolderIds)) {
          let parentId = settings.favoriteFolderIds[0];
          if (!parentId) {
            const [root] = await chrome.bookmarks.getTree();
            parentId = root?.children?.find((node) => !node.url)?.id;
            if (parentId) {
              await chrome.storage.sync.set({ favoriteFolderIds: [parentId] });
            }
          }
          if (parentId) createDetails.parentId = parentId;
        }
        await chrome.bookmarks.create(createDetails);
      }
    } else {
      const requested = typeof message.bookmarkId === "string"
        ? favoriteMatches.find((bookmark) => bookmark.id === message.bookmarkId)
        : null;
      const bookmark = requested || favoriteMatches[0];
      if (bookmark) await chrome.bookmarks.remove(bookmark.id);
    }
    invalidateBookmarks();
    return { ok: true };
  }

  if (message?.type === "helium-command-bar:activate-tab") {
    const tabId = Number(message.tabId);
    const windowId = Number(message.windowId);
    if (!Number.isInteger(tabId) || !Number.isInteger(windowId)) throw new Error("Invalid tab");
    await chrome.tabs.update(tabId, { active: true });
    await chrome.windows.update(windowId, { focused: true });
    return { ok: true };
  }

  if (sender.tab?.id === undefined) return undefined;

  switch (message?.type) {
    case "helium-command-bar:query":
      return queryRows(message.query, sender.tab);

    case "helium-command-bar:reload-extension":
      await clearInactiveSplitBlur(
        sender.tab.id,
        Array.isArray(message.blurredPartnerIds) ? message.blurredPartnerIds : []
      );
      chrome.runtime.reload();
      return { ok: true };

    case "helium-command-bar:close-overlay":
      await clearInactiveSplitBlur(
        sender.tab.id,
        Array.isArray(message.blurredPartnerIds) ? message.blurredPartnerIds : []
      );
      return { ok: true };

    case "split-picker:query":
      return querySplitPickerRows(message.query, sender.tab.id);

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
      if (!setting) throw new Error("Unknown browser destination");

      const tabId = Number(message.tabId);
      if (Number.isInteger(tabId)) {
        const existingTab = await chrome.tabs.get(tabId);
        if (getSettingForTab(existingTab)?.id === setting.id) {
          await chrome.windows.update(existingTab.windowId, { focused: true });
          await chrome.tabs.update(existingTab.id, { active: true });
          return { ok: true };
        }
      }

      if (setting.extensionOptions) {
        await chrome.tabs.create({
          url: chrome.runtime.getURL(setting.url),
          active: true,
          windowId: sender.tab.windowId
        });
      } else {
        await chrome.tabs.create({ url: setting.url, active: true, windowId: sender.tab.windowId });
      }
      return { ok: true };
    }

    case "helium-command-bar:open-bookmark": {
      if (typeof message.bookmarkId !== "string" || !message.bookmarkId) {
        throw new Error("Invalid bookmark");
      }
      const [bookmark] = await chrome.bookmarks.get(message.bookmarkId);
      if (!bookmark?.url) return { ok: false };

      const bookmarkKey = bookmarkUrlKey(bookmark.url);
      const existingTab = (await chrome.tabs.query({})).find((tab) =>
        bookmarkUrlKey(tab.url || tab.pendingUrl || "") === bookmarkKey
      );
      if (existingTab) {
        await chrome.windows.update(existingTab.windowId, { focused: true });
        await chrome.tabs.update(existingTab.id, { active: true });
      } else {
        await chrome.tabs.create({
          url: bookmark.url,
          active: true,
          windowId: sender.tab.windowId
        });
      }
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

async function closeDuplicateTabs(preferredTabId) {
  const { closeDuplicateTabsOnActivation } = await chrome.storage.sync.get({
    closeDuplicateTabsOnActivation: false
  });
  if (!closeDuplicateTabsOnActivation) return;

  const tabs = await chrome.tabs.query({});
  const tabIds = duplicateTabIds(tabs, preferredTabId);
  if (tabIds.length) await chrome.tabs.remove(tabIds);
}

async function closeUnfocusedNewTabs() {
  const { closeNewTabsOnActivation } = await chrome.storage.sync.get({
    closeNewTabsOnActivation: false
  });
  if (!closeNewTabsOnActivation) return;

  const tabs = await chrome.tabs.query({});
  const tabIds = unfocusedNewTabIds(tabs);
  if (tabIds.length) await chrome.tabs.remove(tabIds);
}

async function findPromotionDestination(sourceWindowId) {
  if (previousFocusedWindowId !== undefined && previousFocusedWindowId !== sourceWindowId) {
    try {
      const previousWindow = await chrome.windows.get(previousFocusedWindowId);
      if (previousWindow.type === "normal") return previousWindow;
    } catch {
      previousFocusedWindowId = undefined;
    }
  }

  // Avoid populating every tab in every window on the hot path. The usual
  // case has one other Helium window; only query tab counts when there are
  // multiple fallback candidates.
  const candidates = (await chrome.windows.getAll()).filter((window) =>
    window.type === "normal" && window.id !== sourceWindowId
  );
  if (candidates.length <= 1) return candidates[0];

  const candidatesWithCounts = await Promise.all(candidates.map(async (window) => ({
    window,
    count: (await chrome.tabs.query({ windowId: window.id })).length
  })));
  candidatesWithCounts.sort((first, second) => second.count - first.count);
  return candidatesWithCounts[0]?.window;
}

async function promoteCurrentTabToMainWindow() {
  const [sourceTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!sourceTab?.id || !Number.isInteger(sourceTab.windowId)) return { ok: false };

  const destinationWindow = await findPromotionDestination(sourceTab.windowId);
  if (!destinationWindow?.id) return { ok: false };

  const moved = await chrome.tabs.move(sourceTab.id, {
    windowId: destinationWindow.id,
    index: -1
  });
  const movedTab = Array.isArray(moved) ? moved[0] : moved;
  if (!movedTab?.id) return { ok: false };

  // Focus the destination as soon as the move completes. Empty-window cleanup
  // is deliberately off the critical path because Chromium often closes the
  // source window itself when its only tab is moved.
  await Promise.all([
    chrome.tabs.update(movedTab.id, { active: true }),
    chrome.windows.update(destinationWindow.id, { focused: true })
  ]);
  void (async () => {
    try {
      const remainingTabs = await chrome.tabs.query({ windowId: sourceTab.windowId });
      if (!remainingTabs.length) await chrome.windows.remove(sourceTab.windowId);
    } catch {
      // The source window may already have been closed by Chromium.
    }
  })();

  return { ok: true };
}

async function openCommandBar(tab) {
  if (!tab?.id) return;

  try {
    await checkForExtensionUpdate();
    await closeDuplicateTabs(tab.id);
    await closeUnfocusedNewTabs();
  } catch (error) {
    // Duplicate cleanup is optional and should never prevent the command bar
    // from opening if tabs changed while the cleanup was in progress.
    console.info("Could not clean up tabs", error);
  }

  // Reassert the active browser window and tab before injecting. This gives
  // the page a chance to reclaim native focus from browser-owned controls such
  // as the find bar; the overlay follows up by focusing its query input.
  try {
    if (Number.isInteger(tab.windowId)) {
      await chrome.windows.update(tab.windowId, { focused: true });
    }
    await chrome.tabs.update(tab.id, { active: true });
  } catch {
    // The invocation can still succeed if the window or tab changed mid-flight.
  }

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

chrome.runtime.onStartup.addListener(() => {
  void checkForExtensionUpdate({ force: true }).catch((error) => {
    console.info("Could not check for an extension update at startup", error);
  });
});

chrome.action.onClicked.addListener(openCommandBar);
chrome.commands.onCommand.addListener(async (command) => {
  try {
    if (command === "promote-preview-tab") {
      await promoteCurrentTabToMainWindow();
      return;
    }
    if (command !== "open-command-bar") return;
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    await openCommandBar(tab);
  } catch (error) {
    console.error(`Could not handle command ${command}`, error);
  }
});

chrome.tabs.onCreated.addListener((tab) => {
  void enhanceNativeSplitPicker(tab);
  void syncInactiveSplitEffects();
});
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url) {
    // Navigation removes the injected DOM layer but keeps the tab in its split.
    // Preserve partner membership so an open command bar restores blur after load.
    inactiveEffectByTab.delete(tabId);
    blurredPartnersByOwner.delete(tabId);
  }
  if (tab.url?.startsWith(NATIVE_SPLIT_PICKER_URL)) void enhanceNativeSplitPicker(tab);
  if (changeInfo.url || changeInfo.status === "complete" || changeInfo.splitViewId !== undefined) {
    void syncInactiveSplitEffects();
  }
});
chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) return;
  if (lastFocusedWindowId !== windowId) {
    previousFocusedWindowId = lastFocusedWindowId;
    lastFocusedWindowId = windowId;
  }
});
void chrome.windows.getLastFocused().then((window) => {
  if (window?.id !== undefined) lastFocusedWindowId = window.id;
}).catch(() => {});

chrome.tabs.onActivated.addListener(({ tabId }) => {
  for (const ownerTabId of blurredPartnersByOwner.keys()) {
    if (ownerTabId !== tabId) blurredPartnersByOwner.delete(ownerTabId);
  }
  void syncInactiveSplitEffects();
});
chrome.tabs.onRemoved.addListener((tabId) => {
  interceptingSplitTabs.delete(tabId);
  forgetBlurredTab(tabId);
  void syncInactiveSplitEffects();
});
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "sync") return;
  if (changes.blurInactiveSplitPane) void syncInactiveSplitEffects();
  if (changes.commandBarColor) {
    void refreshActionIcon(changes.commandBarColor.newValue);
  }
});
chrome.permissions.onAdded.addListener((permissions) => {
  if (permissions.origins?.some((origin) => origin === "<all_urls>" || origin === "*://*/*")) {
    void syncInactiveSplitEffects();
  }
});
chrome.permissions.onRemoved.addListener((permissions) => {
  if (!permissions.origins?.some((origin) => origin === "<all_urls>" || origin === "*://*/*")) return;
  void chrome.storage.sync.set({ blurInactiveSplitPane: false });
  void syncInactiveSplitEffects();
});
if (chrome.bookmarks) {
  for (const event of [
    chrome.bookmarks.onCreated,
    chrome.bookmarks.onRemoved,
    chrome.bookmarks.onChanged,
    chrome.bookmarks.onMoved,
    chrome.bookmarks.onChildrenReordered,
    chrome.bookmarks.onImportEnded
  ].filter(Boolean)) {
    event.addListener(invalidateBookmarks);
  }
}
chrome.runtime.onInstalled.addListener(() => {
  void refreshActionIcon();
  void scanForNativeSplitPickers();
  void (async () => {
    const tabs = await chrome.tabs.query({});
    blurredPartnersByOwner.clear();
    inactiveEffectByTab.clear();
    await Promise.allSettled(tabs.map((tab) => removeInactiveEffectFromTab(tab.id)));
    await syncInactiveSplitEffects(tabs);
  })();
});
chrome.runtime.onStartup.addListener(() => {
  void refreshActionIcon();
  void scanForNativeSplitPickers();
  void syncInactiveSplitEffects();
});
